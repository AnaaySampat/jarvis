package com.jarvis.phone

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AutonomyTaskDaoTest {
    private lateinit var database: AutonomyTaskDatabase
    private lateinit var dao: AutonomyTaskDao

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AutonomyTaskDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.tasks()
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun beginDeduplicatesByUniqueKeyAndRejectsChangedSpec() = runBlocking {
        val now = System.currentTimeMillis()
        val original = task("first-id", "planning", now).copy(
            idempotencyKey = "submission-1",
            sourceDeviceId = "phone-native",
        )
        val accepted = dao.begin(original)
        val duplicate = dao.begin(
            original.copy(
                taskId = "retry-id",
                deadlineAtMs = original.deadlineAtMs + 5_000,
                createdAtMs = now + 1,
                updatedAtMs = now + 1,
            ),
        )
        val conflict = dao.begin(original.copy(taskId = "changed-id", goal = "changed goal"))

        assertTrue(accepted.created)
        assertFalse(duplicate.created)
        assertEquals("first-id", duplicate.task?.taskId)
        assertEquals("", duplicate.conflict)
        assertEquals("idempotency_conflict", conflict.conflict)
        assertEquals(1, dao.count())
        assertEquals(listOf(1L), dao.events("first-id", 0L, 20).map { it.seq })
    }

    @Test
    fun orderedEventsShareTheCommittedTaskSequenceAndExactRetryIsNoOp() = runBlocking {
        val now = System.currentTimeMillis()
        val accepted = dao.begin(
            task("ordered", "planning", now).copy(
                idempotencyKey = "ordered-key",
                sourceDeviceId = "phone-native",
            ),
        )
        assertTrue(accepted.created)
        assertEquals(1, dao.checkpoint("ordered", "policy_check", 0, "R1:tap", now + 1))
        assertEquals(1, dao.checkpoint("ordered", "policy_check", 0, "R1:tap", now + 2))
        assertEquals(
            1,
            dao.checkpoint(
                "ordered",
                "executing",
                0,
                "tap:ok",
                now + 3,
                "{\"version\":1,\"kind\":\"native_action_receipt\",\"action\":\"tap\"}",
            ),
        )
        assertEquals(1, dao.checkpoint("ordered", "verifying", 1, "claim:pending", now + 4))
        assertEquals(
            1,
            dao.finishSucceeded(
                "ordered", "saved", VALID_RECEIPT, VALID_DIGEST, now + 5,
            ),
        )

        val row = requireNotNull(dao.get("ordered"))
        val events = dao.events("ordered", 0L, 20)
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), events.map { it.seq })
        assertEquals(row.eventSeq, events.last().seq)
        assertEquals("task.succeeded", events.last().eventType)
        assertEquals(VALID_DIGEST, events.last().evidenceDigest)
        assertTrue(row.lastVerifiedCheckpoint.contains("native_action_receipt"))
    }

    @Test
    fun exactTerminalIdempotencyReplayReturnsReceiptWithoutAnotherEvent() = runBlocking {
        val now = System.currentTimeMillis()
        val spec = task("terminal-replay", "planning", now).copy(
            idempotencyKey = "terminal-key",
            sourceDeviceId = "phone-native",
        )
        dao.begin(spec)
        dao.checkpoint("terminal-replay", "policy_check", 0, "R1:tap", now + 1)
        dao.checkpoint("terminal-replay", "executing", 0, "tap:ok", now + 2)
        dao.checkpoint("terminal-replay", "verifying", 1, "claim:pending", now + 3)
        dao.finishSucceeded(
            "terminal-replay", "saved once", VALID_RECEIPT, VALID_DIGEST, now + 4,
        )
        val before = dao.events("terminal-replay", 0L, 20)

        val replay = dao.begin(spec.copy(taskId = "new-candidate", updatedAtMs = now + 5))

        assertFalse(replay.created)
        assertEquals("", replay.conflict)
        assertEquals("terminal-replay", replay.task?.taskId)
        assertEquals("succeeded", replay.task?.state)
        assertEquals(VALID_DIGEST, replay.task?.verificationDigest)
        assertEquals(before, dao.events("terminal-replay", 0L, 20))
    }

    @Test
    fun journalPayloadPolicyRejectsMalformedRiskSecretsAndScreenshots() {
        assertEquals("R0", TaskJournalPayloadPolicy.safeRisk("R0"))
        assertNull(TaskJournalPayloadPolicy.safeRisk("R9"))
        assertNull(TaskJournalPayloadPolicy.safeRisk(""))
        assertNull(
            TaskJournalPayloadPolicy.capabilityProfile(
                "{\"version\":1,\"capabilities\":[],\"access_token\":\"hidden\"}",
            ),
        )
        assertNull(
            TaskJournalPayloadPolicy.typedPlan(
                "{\"version\":1,\"steps\":[],\"screenshot\":\"data:image/png;base64,AAAA\"}",
            ),
        )
        assertNull(TaskJournalPayloadPolicy.safeText("password=hunter2", 200, false))
    }

    @Test
    fun cancellationWinsAgainstLateSuccess() = runBlocking {
        val now = System.currentTimeMillis()
        dao.insert(task("race", "verifying", now))

        assertEquals(1, dao.cancel("race", now + 1))
        assertEquals(
            0,
            dao.finishSucceeded(
                "race",
                "late success",
                VALID_RECEIPT,
                VALID_DIGEST,
                now + 2,
            ),
        )

        val row = requireNotNull(dao.get("race"))
        assertEquals("cancelled", row.state)
        assertTrue(row.cancelRequested)
        assertEquals("", row.verificationReceipt)
        assertEquals("", row.verificationDigest)
        assertEquals(0L, row.verifiedAtMs)
    }

    @Test
    fun successRequiresVerifyingStateAndNonEmptyProof() = runBlocking {
        val now = System.currentTimeMillis()
        dao.insert(task("planning", "planning", now))
        dao.insert(task("no-proof", "verifying", now))
        dao.insert(task("proved", "verifying", now))

        assertEquals(
            0,
            dao.finishSucceeded("planning", "claim", VALID_RECEIPT, VALID_DIGEST, now + 1),
        )
        assertEquals(0, dao.finishSucceeded("no-proof", "claim", "", "", now + 1))
        assertEquals(
            1,
            dao.finishSucceeded("proved", "claim", VALID_RECEIPT, VALID_DIGEST, now + 1),
        )

        val row = requireNotNull(dao.get("proved"))
        assertEquals("succeeded", row.state)
        assertFalse(row.cancelRequested)
        assertEquals(VALID_RECEIPT, row.verificationReceipt)
        assertEquals(VALID_DIGEST, row.verificationDigest)
        assertEquals(now + 1, row.verifiedAtMs)
    }

    @Test
    fun terminalSuccessCannotBeCancelledOrRewritten() = runBlocking {
        val now = System.currentTimeMillis()
        dao.insert(task("terminal", "verifying", now))
        assertEquals(
            1,
            dao.finishSucceeded("terminal", "proved", VALID_RECEIPT, VALID_DIGEST, now + 1),
        )

        assertEquals(0, dao.cancel("terminal", now + 2))
        assertEquals(0, dao.finishWithoutSuccess("terminal", "failed", "late failure", now + 3))

        val row = requireNotNull(dao.get("terminal"))
        assertEquals("succeeded", row.state)
        assertEquals("proved", row.result)
        assertEquals(VALID_DIGEST, row.verificationDigest)
    }

    @Test
    fun checkpointCannotReviveCancelledTask() = runBlocking {
        val now = System.currentTimeMillis()
        dao.insert(task("stopped", "executing", now))
        assertEquals(1, dao.cancel("stopped", now + 1))

        assertEquals(
            0,
            dao.checkpoint("stopped", "verifying", 9, "late checkpoint", now + 2),
        )
        assertEquals("cancelled", dao.get("stopped")?.state)
    }

    @Test
    fun bulkPauseSuspendsOnlySnapshottedActiveTasks() = runBlocking {
        val now = System.currentTimeMillis()
        dao.insert(task("planning", "planning", now))
        dao.insert(task("executing", "executing", now))
        dao.insert(task("terminal", "verifying", now))
        assertEquals(
            1,
            dao.finishSucceeded("terminal", "proved", VALID_RECEIPT, VALID_DIGEST, now + 1),
        )

        assertEquals(
            2,
            dao.suspendActiveTasks(
                listOf("planning", "executing", "terminal", "missing"),
                "Paused; re-observation required.",
                now + 2,
            ),
        )

        val planning = requireNotNull(dao.get("planning"))
        val executing = requireNotNull(dao.get("executing"))
        val terminal = requireNotNull(dao.get("terminal"))
        assertEquals("suspended", planning.state)
        assertEquals("suspended", executing.state)
        assertEquals(1L, planning.eventSeq)
        assertEquals(1L, executing.eventSeq)
        assertEquals("succeeded", terminal.state)
        assertEquals(1L, terminal.eventSeq)
        assertEquals(VALID_DIGEST, terminal.verificationDigest)
    }

    private fun task(taskId: String, state: String, now: Long) = AutonomyTaskEntity(
        taskId = taskId,
        goal = "test goal",
        state = state,
        risk = "R1",
        deadlineAtMs = now + 60_000,
        createdAtMs = now,
        updatedAtMs = now,
    )

    companion object {
        private const val VALID_RECEIPT =
            "aura.verify.v1:model:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        private const val VALID_DIGEST =
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
}

package com.jarvis.phone

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AutonomyTaskMigrationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val databaseNames = mutableListOf<String>()

    @After
    fun tearDown() {
        databaseNames.forEach(context::deleteDatabase)
    }

    @Test
    fun migrationPreservesRowsAddsUniqueSpecAndBindsLegacySourceOnce() = runBlocking {
        val name = databaseName("migration")
        createVersion2Database(name)

        val database = open(name)
        val dao = database.tasks()
        val migrated = requireNotNull(dao.get("legacy-task"))
        assertEquals("legacy goal", migrated.goal)
        assertEquals("legacy-task", migrated.idempotencyKey)
        assertEquals("legacy-local", migrated.sourceDeviceId)
        assertEquals(3, migrated.retryBudget)
        assertEquals(DEFAULT_CAPABILITY_PROFILE_JSON, migrated.capabilityProfileJson)
        assertEquals(DEFAULT_TYPED_PLAN_JSON, migrated.typedPlanJson)
        assertEquals(listOf(7L), dao.events("legacy-task", 0L, 20).map { it.seq })

        val rebound = dao.begin(
            migrated.copy(
                taskId = "retry-after-upgrade",
                sourceDeviceId = "phone-native-identity",
                updatedAtMs = migrated.updatedAtMs + 1,
            ),
        )
        assertFalse(rebound.created)
        assertEquals("", rebound.conflict)
        assertEquals("legacy-task", rebound.task?.taskId)
        assertEquals("phone-native-identity", rebound.task?.sourceDeviceId)
        assertEquals(
            listOf("migration.snapshot", "task.source_bound"),
            dao.events("legacy-task", 0L, 20).map { it.eventType },
        )

        val second = dao.begin(
            requireNotNull(rebound.task).copy(
                taskId = "another-retry",
                sourceDeviceId = "different-device",
            ),
        )
        assertEquals("idempotency_conflict", second.conflict)
        assertEquals("phone-native-identity", dao.get("legacy-task")?.sourceDeviceId)
        database.close()
    }

    @Test
    fun restartContinuesThePerTaskSequenceWithoutLosingCheckpoint() = runBlocking {
        val name = databaseName("restart")
        var database = open(name)
        var dao = database.tasks()
        val now = System.currentTimeMillis()
        val spec = AutonomyTaskEntity(
            taskId = "restart-task",
            idempotencyKey = "restart-key",
            goal = "restart goal",
            state = "planning",
            risk = "R1",
            deadlineAtMs = now + 60_000,
            sourceDeviceId = "phone-native",
            createdAtMs = now,
            updatedAtMs = now,
        )
        assertTrue(dao.begin(spec).created)
        assertEquals(1, dao.checkpoint("restart-task", "policy_check", 0, "R1:tap", now + 1))
        assertEquals(
            1,
            dao.checkpoint(
                "restart-task",
                "executing",
                0,
                "tap:ok",
                now + 2,
                "{\"version\":1,\"kind\":\"native_action_receipt\",\"action\":\"tap\"}",
            ),
        )
        database.close()

        database = open(name)
        dao = database.tasks()
        val restored = requireNotNull(dao.get("restart-task"))
        assertTrue(restored.lastVerifiedCheckpoint.contains("native_action_receipt"))
        assertEquals(3L, restored.eventSeq)
        assertEquals(1, dao.checkpoint("restart-task", "verifying", 1, "claim:pending", now + 3))
        assertEquals(listOf(1L, 2L, 3L, 4L), dao.events("restart-task", 0L, 20).map { it.seq })
        database.close()
    }

    private fun open(name: String): AutonomyTaskDatabase = Room.databaseBuilder(
        context,
        AutonomyTaskDatabase::class.java,
        name,
    ).addMigrations(
        AutonomyTaskDatabase.MIGRATION_1_2,
        AutonomyTaskDatabase.MIGRATION_2_3,
    ).allowMainThreadQueries().build()

    private fun createVersion2Database(name: String) {
        val helper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context)
                .name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(2) {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        db.execSQL(
                            """CREATE TABLE IF NOT EXISTS `autonomy_tasks` (
                                `taskId` TEXT NOT NULL,
                                `goal` TEXT NOT NULL,
                                `state` TEXT NOT NULL,
                                `risk` TEXT NOT NULL,
                                `deadlineAtMs` INTEGER NOT NULL,
                                `step` INTEGER NOT NULL,
                                `receipt` TEXT NOT NULL,
                                `result` TEXT NOT NULL,
                                `verificationReceipt` TEXT NOT NULL,
                                `verificationDigest` TEXT NOT NULL,
                                `verifiedAtMs` INTEGER NOT NULL,
                                `eventSeq` INTEGER NOT NULL,
                                `cancelRequested` INTEGER NOT NULL,
                                `createdAtMs` INTEGER NOT NULL,
                                `updatedAtMs` INTEGER NOT NULL,
                                PRIMARY KEY(`taskId`)
                            )""",
                        )
                    }

                    override fun onUpgrade(
                        db: SupportSQLiteDatabase,
                        oldVersion: Int,
                        newVersion: Int,
                    ) = Unit
                })
                .build(),
        )
        val db = helper.writableDatabase
        val now = System.currentTimeMillis()
        db.execSQL(
            """INSERT INTO autonomy_tasks (
                taskId, goal, state, risk, deadlineAtMs, step, receipt, result,
                verificationReceipt, verificationDigest, verifiedAtMs, eventSeq,
                cancelRequested, createdAtMs, updatedAtMs
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            arrayOf(
                "legacy-task", "legacy goal", "suspended", "R1", now + 60_000,
                2, "restart:required", "", "", "", 0L, 7L, 0, now, now,
            ),
        )
        helper.close()
    }

    private fun databaseName(label: String): String =
        "aura-$label-${System.nanoTime()}.db".also(databaseNames::add)
}

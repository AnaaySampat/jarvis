package com.jarvis.phone

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

const val DEFAULT_CAPABILITY_PROFILE_JSON =
    "{\"version\":1,\"capabilities\":[\"android.accessibility\",\"android.intents\"]}"
const val DEFAULT_TYPED_PLAN_JSON =
    "{\"version\":1,\"strategy\":\"observe-plan-act-verify\",\"steps\":[]}"

/** Durable native TaskSpec. Secrets, screenshots and raw visual evidence are never stored here. */
@Entity(
    tableName = "autonomy_tasks",
    indices = [Index(value = ["idempotencyKey"], unique = true)],
)
data class AutonomyTaskEntity(
    @androidx.room.PrimaryKey val taskId: String,
    val goal: String,
    val state: String,
    val risk: String,
    val deadlineAtMs: Long,
    val step: Int = 0,
    val receipt: String = "",
    val result: String = "",
    /** Privacy-safe verifier receipt. It contains only a schema/verifier label and
     * a digest of the evidence evaluated by the completion checker. */
    val verificationReceipt: String = "",
    /** Native SHA-256 of [verificationReceipt], binding the terminal row to the
     * exact proof token supplied at the verifying -> succeeded transition. */
    val verificationDigest: String = "",
    val verifiedAtMs: Long = 0L,
    /** Last sequence committed to [task_events]. It changes in the same transaction. */
    val eventSeq: Long = 0L,
    val cancelRequested: Boolean = false,
    val createdAtMs: Long = System.currentTimeMillis(),
    val updatedAtMs: Long = System.currentTimeMillis(),
    /** Submission-level exactly-once key. A repeated key resolves to the original task. */
    val idempotencyKey: String = taskId,
    /** Native-verified phone identity. A claimed WebView value is never trusted. */
    val sourceDeviceId: String = "legacy-local",
    /** Validated, bounded JSON containing capability names only. */
    val capabilityProfileJson: String = DEFAULT_CAPABILITY_PROFILE_JSON,
    val retryBudget: Int = 3,
    val retryCount: Int = 0,
    /** Typed plan metadata only; captured text, secrets and screenshots are forbidden. */
    val typedPlanJson: String = DEFAULT_TYPED_PLAN_JSON,
    /** Latest typed, privacy-safe checkpoint. Empty means no verified checkpoint yet. */
    val lastVerifiedCheckpoint: String = "",
)

/** Immutable ordered journal entry. It deliberately has no arbitrary payload/blob column. */
@Entity(
    tableName = "task_events",
    primaryKeys = ["taskId", "seq"],
    foreignKeys = [
        ForeignKey(
            entity = AutonomyTaskEntity::class,
            parentColumns = ["taskId"],
            childColumns = ["taskId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index(value = ["taskId"])],
)
data class AutonomyTaskEventEntity(
    val taskId: String,
    val seq: Long,
    val eventType: String,
    val state: String,
    val step: Int,
    /** Typed checkpoint JSON only. Never raw UI text or image evidence. */
    val checkpointJson: String = "",
    /** Optional SHA-256 proof digest; never the underlying evidence. */
    val evidenceDigest: String = "",
    val createdAtMs: Long,
)

data class TaskBeginOutcome(
    val task: AutonomyTaskEntity?,
    val created: Boolean,
    val conflict: String = "",
)

private val TERMINAL_STATES = setOf("succeeded", "failed", "cancelled")

private fun sameImmutableSpecExceptSource(
    existing: AutonomyTaskEntity,
    candidate: AutonomyTaskEntity,
): Boolean =
    existing.goal == candidate.goal &&
        existing.risk == candidate.risk &&
        existing.capabilityProfileJson == candidate.capabilityProfileJson &&
        existing.typedPlanJson == candidate.typedPlanJson &&
        existing.retryBudget == candidate.retryBudget

private fun sameImmutableSpec(existing: AutonomyTaskEntity, candidate: AutonomyTaskEntity): Boolean =
    sameImmutableSpecExceptSource(existing, candidate) &&
        existing.sourceDeviceId == candidate.sourceDeviceId

private fun canCheckpoint(from: String, to: String): Boolean = when (to) {
    "planning" -> from in setOf("planning", "suspended")
    "policy_check" -> from in setOf(
        "planning", "policy_check", "executing", "verifying", "suspended",
    )
    "executing" -> from in setOf("policy_check", "executing", "verifying")
    "verifying" -> from in setOf("executing", "verifying")
    "suspended" -> from in setOf(
        "planning", "policy_check", "executing", "verifying", "suspended",
    )
    else -> false
}

@Dao
abstract class AutonomyTaskDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insert(task: AutonomyTaskEntity): Long

    @Update
    protected abstract suspend fun updateTask(task: AutonomyTaskEntity): Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    protected abstract suspend fun insertEvent(event: AutonomyTaskEventEntity)

    @Query("SELECT * FROM autonomy_tasks WHERE taskId = :taskId LIMIT 1")
    abstract suspend fun get(taskId: String): AutonomyTaskEntity?

    @Query("SELECT * FROM autonomy_tasks WHERE idempotencyKey = :key LIMIT 1")
    abstract suspend fun getByIdempotencyKey(key: String): AutonomyTaskEntity?

    @Query("SELECT COUNT(*) FROM autonomy_tasks")
    abstract suspend fun count(): Int

    @Query(
        """SELECT * FROM task_events WHERE taskId = :taskId AND seq > :afterSeq
        ORDER BY seq ASC LIMIT :limit""",
    )
    abstract suspend fun events(
        taskId: String,
        afterSeq: Long,
        limit: Int,
    ): List<AutonomyTaskEventEntity>

    /** Atomically deduplicate task submission and append its first ordered event. */
    @Transaction
    open suspend fun begin(candidate: AutonomyTaskEntity): TaskBeginOutcome {
        val byKey = getByIdempotencyKey(candidate.idempotencyKey)?.let {
            bindLegacySource(it, candidate)
        }
        if (byKey != null) {
            val conflict = if (sameImmutableSpec(byKey, candidate)) "" else "idempotency_conflict"
            return TaskBeginOutcome(byKey, created = false, conflict = conflict)
        }
        val byId = get(candidate.taskId)?.let { bindLegacySource(it, candidate) }
        if (byId != null) {
            val conflict = if (
                byId.idempotencyKey == candidate.idempotencyKey &&
                sameImmutableSpec(byId, candidate)
            ) "" else "task_id_conflict"
            return TaskBeginOutcome(byId, created = false, conflict = conflict)
        }

        val accepted = candidate.copy(eventSeq = 1L)
        if (insert(accepted) == -1L) {
            val raced = getByIdempotencyKey(candidate.idempotencyKey) ?: get(candidate.taskId)
            return TaskBeginOutcome(raced, created = false, conflict = "concurrent_conflict")
        }
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = accepted.taskId,
                seq = 1L,
                eventType = "task.begin",
                state = accepted.state,
                step = accepted.step,
                createdAtMs = accepted.createdAtMs,
            ),
        )
        return TaskBeginOutcome(accepted, created = true)
    }

    /** A v2 row predates native source identity. Bind it exactly once, and only when
     * every other immutable field matches the native-constructed candidate. */
    private suspend fun bindLegacySource(
        existing: AutonomyTaskEntity,
        candidate: AutonomyTaskEntity,
    ): AutonomyTaskEntity {
        if (
            existing.sourceDeviceId != "legacy-local" ||
            existing.idempotencyKey != candidate.idempotencyKey ||
            !sameImmutableSpecExceptSource(existing, candidate)
        ) return existing
        val nextSeq = existing.eventSeq + 1L
        val rebound = existing.copy(
            sourceDeviceId = candidate.sourceDeviceId,
            eventSeq = nextSeq,
            updatedAtMs = maxOf(existing.updatedAtMs, candidate.updatedAtMs),
        )
        if (updateTask(rebound) != 1) return existing
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = existing.taskId,
                seq = nextSeq,
                eventType = "task.source_bound",
                state = existing.state,
                step = existing.step,
                checkpointJson = existing.lastVerifiedCheckpoint,
                createdAtMs = rebound.updatedAtMs,
            ),
        )
        return rebound
    }

    /** Compare, update and append are one transaction; exact retries are no-ops. */
    @Transaction
    open suspend fun checkpoint(
        taskId: String,
        state: String,
        step: Int,
        receipt: String,
        now: Long,
        verifiedCheckpoint: String = "",
    ): Int {
        val row = get(taskId) ?: return 0
        if (
            row.cancelRequested || row.deadlineAtMs < now || row.state in TERMINAL_STATES ||
            !canCheckpoint(row.state, state)
        ) return 0

        val nextCheckpoint = verifiedCheckpoint.ifBlank { row.lastVerifiedCheckpoint }
        if (
            row.state == state && row.step == step && row.receipt == receipt &&
            nextCheckpoint == row.lastVerifiedCheckpoint
        ) return 1

        var retries = row.retryCount
        if (row.state == "suspended" && state == "planning") {
            if (retries >= row.retryBudget) return 0
            retries += 1
        }
        val nextSeq = row.eventSeq + 1L
        val updated = row.copy(
            state = state,
            step = step,
            receipt = receipt,
            verificationReceipt = "",
            verificationDigest = "",
            verifiedAtMs = 0L,
            eventSeq = nextSeq,
            retryCount = retries,
            lastVerifiedCheckpoint = nextCheckpoint,
            updatedAtMs = now,
        )
        if (updateTask(updated) != 1) return 0
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = taskId,
                seq = nextSeq,
                eventType = "task.checkpoint",
                state = state,
                step = step,
                checkpointJson = verifiedCheckpoint,
                createdAtMs = now,
            ),
        )
        return 1
    }

    @Transaction
    open suspend fun finishSucceeded(
        taskId: String,
        result: String,
        verificationReceipt: String,
        verificationDigest: String,
        now: Long,
    ): Int {
        val row = get(taskId) ?: return 0
        if (row.state == "succeeded") {
            return if (
                row.result == result && row.verificationReceipt == verificationReceipt &&
                row.verificationDigest == verificationDigest
            ) 1 else 0
        }
        if (
            row.state != "verifying" || row.cancelRequested || row.deadlineAtMs < now ||
            verificationReceipt.isBlank() || verificationDigest.isBlank()
        ) return 0
        val nextSeq = row.eventSeq + 1L
        val updated = row.copy(
            state = "succeeded",
            result = result,
            verificationReceipt = verificationReceipt,
            verificationDigest = verificationDigest,
            verifiedAtMs = now,
            eventSeq = nextSeq,
            updatedAtMs = now,
        )
        if (updateTask(updated) != 1) return 0
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = taskId,
                seq = nextSeq,
                eventType = "task.succeeded",
                state = "succeeded",
                step = row.step,
                checkpointJson = row.lastVerifiedCheckpoint,
                evidenceDigest = verificationDigest,
                createdAtMs = now,
            ),
        )
        return 1
    }

    @Transaction
    open suspend fun finishWithoutSuccess(
        taskId: String,
        state: String,
        result: String,
        now: Long,
    ): Int {
        if (state !in setOf("failed", "suspended")) return 0
        val row = get(taskId) ?: return 0
        if (row.state == state && row.result == result) return 1
        if (row.cancelRequested || row.state in TERMINAL_STATES) return 0
        val nextSeq = row.eventSeq + 1L
        val updated = row.copy(
            state = state,
            result = result,
            verificationReceipt = "",
            verificationDigest = "",
            verifiedAtMs = 0L,
            eventSeq = nextSeq,
            updatedAtMs = now,
        )
        if (updateTask(updated) != 1) return 0
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = taskId,
                seq = nextSeq,
                eventType = "task.$state",
                state = state,
                step = row.step,
                checkpointJson = row.lastVerifiedCheckpoint,
                createdAtMs = now,
            ),
        )
        return 1
    }

    @Transaction
    open suspend fun cancel(taskId: String, now: Long): Int {
        val row = get(taskId) ?: return 0
        return cancelRow(row, now)
    }

    /** Global STOP uses one transaction so process death cannot leave a half-cancelled set. */
    @Transaction
    open suspend fun cancelTasks(taskIds: List<String>, now: Long): Int {
        var changed = 0
        for (taskId in taskIds.distinct()) {
            val row = get(taskId) ?: continue
            changed += cancelRow(row, now)
        }
        return changed
    }

    private suspend fun cancelRow(row: AutonomyTaskEntity, now: Long): Int {
        if (row.state == "cancelled" && row.cancelRequested) return 1
        if (row.state in TERMINAL_STATES) return 0
        val nextSeq = row.eventSeq + 1L
        val updated = row.copy(
            cancelRequested = true,
            state = "cancelled",
            verificationReceipt = "",
            verificationDigest = "",
            verifiedAtMs = 0L,
            eventSeq = nextSeq,
            updatedAtMs = now,
        )
        if (updateTask(updated) != 1) return 0
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = row.taskId,
                seq = nextSeq,
                eventType = "task.cancelled",
                state = "cancelled",
                step = row.step,
                checkpointJson = row.lastVerifiedCheckpoint,
                createdAtMs = now,
            ),
        )
        return 1
    }

    @Query("SELECT * FROM autonomy_tasks WHERE state IN ('planning','policy_check','executing','verifying')")
    abstract suspend fun recoverable(): List<AutonomyTaskEntity>

    @Transaction
    open suspend fun suspendInterrupted(receipt: String, now: Long): Int {
        var changed = 0
        for (row in recoverable()) changed += suspendRow(row, receipt, now)
        return changed
    }

    @Transaction
    open suspend fun suspendActive(taskId: String, receipt: String, now: Long): Int {
        val row = get(taskId) ?: return 0
        return suspendRow(row, receipt, now)
    }

    @Transaction
    open suspend fun suspendActiveTasks(
        taskIds: List<String>,
        receipt: String,
        now: Long,
    ): Int {
        var changed = 0
        for (taskId in taskIds.distinct()) {
            val row = get(taskId) ?: continue
            changed += suspendRow(row, receipt, now)
        }
        return changed
    }

    private suspend fun suspendRow(row: AutonomyTaskEntity, receipt: String, now: Long): Int {
        if (row.cancelRequested || row.state !in setOf(
                "planning", "policy_check", "executing", "verifying",
            )
        ) return 0
        val nextSeq = row.eventSeq + 1L
        val updated = row.copy(
            state = "suspended",
            receipt = receipt,
            verificationReceipt = "",
            verificationDigest = "",
            verifiedAtMs = 0L,
            eventSeq = nextSeq,
            updatedAtMs = now,
        )
        if (updateTask(updated) != 1) return 0
        insertEvent(
            AutonomyTaskEventEntity(
                taskId = row.taskId,
                seq = nextSeq,
                eventType = "task.suspended",
                state = "suspended",
                step = row.step,
                checkpointJson = row.lastVerifiedCheckpoint,
                createdAtMs = now,
            ),
        )
        return 1
    }

    @Query("DELETE FROM autonomy_tasks WHERE updatedAtMs < :before AND state IN ('succeeded','failed','cancelled')")
    abstract suspend fun prune(before: Long): Int
}

@Database(
    entities = [AutonomyTaskEntity::class, AutonomyTaskEventEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class AutonomyTaskDatabase : RoomDatabase() {
    abstract fun tasks(): AutonomyTaskDao

    companion object {
        @Volatile private var instance: AutonomyTaskDatabase? = null

        /** Preserve all in-flight tasks while adding the fail-closed completion proof columns. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE autonomy_tasks ADD COLUMN verificationReceipt TEXT NOT NULL DEFAULT ''",
                )
                db.execSQL(
                    "ALTER TABLE autonomy_tasks ADD COLUMN verificationDigest TEXT NOT NULL DEFAULT ''",
                )
                db.execSQL(
                    "ALTER TABLE autonomy_tasks ADD COLUMN verifiedAtMs INTEGER NOT NULL DEFAULT 0",
                )
            }
        }

        /** Data-preserving v2 -> v3 migration. Existing task IDs become their unique
         * idempotency keys and their latest event sequence is retained as a snapshot. */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `autonomy_tasks_v3` (
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
                        `idempotencyKey` TEXT NOT NULL,
                        `sourceDeviceId` TEXT NOT NULL,
                        `capabilityProfileJson` TEXT NOT NULL,
                        `retryBudget` INTEGER NOT NULL,
                        `retryCount` INTEGER NOT NULL,
                        `typedPlanJson` TEXT NOT NULL,
                        `lastVerifiedCheckpoint` TEXT NOT NULL,
                        PRIMARY KEY(`taskId`)
                    )""",
                )
                db.execSQL(
                    """INSERT INTO `autonomy_tasks_v3` (
                        taskId, goal, state, risk, deadlineAtMs, step, receipt, result,
                        verificationReceipt, verificationDigest, verifiedAtMs, eventSeq,
                        cancelRequested, createdAtMs, updatedAtMs, idempotencyKey,
                        sourceDeviceId, capabilityProfileJson, retryBudget, retryCount,
                        typedPlanJson, lastVerifiedCheckpoint
                    ) SELECT
                        taskId, goal, state, risk, deadlineAtMs, step, receipt, result,
                        verificationReceipt, verificationDigest, verifiedAtMs, eventSeq,
                        cancelRequested, createdAtMs, updatedAtMs, taskId,
                        'legacy-local',
                        '{"version":1,"capabilities":["android.accessibility","android.intents"]}',
                        3, 0,
                        '{"version":1,"strategy":"observe-plan-act-verify","steps":[]}', ''
                    FROM `autonomy_tasks`""",
                )
                db.execSQL("DROP TABLE `autonomy_tasks`")
                db.execSQL("ALTER TABLE `autonomy_tasks_v3` RENAME TO `autonomy_tasks`")
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_autonomy_tasks_idempotencyKey` " +
                        "ON `autonomy_tasks` (`idempotencyKey`)",
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `task_events` (
                        `taskId` TEXT NOT NULL,
                        `seq` INTEGER NOT NULL,
                        `eventType` TEXT NOT NULL,
                        `state` TEXT NOT NULL,
                        `step` INTEGER NOT NULL,
                        `checkpointJson` TEXT NOT NULL,
                        `evidenceDigest` TEXT NOT NULL,
                        `createdAtMs` INTEGER NOT NULL,
                        PRIMARY KEY(`taskId`, `seq`),
                        FOREIGN KEY(`taskId`) REFERENCES `autonomy_tasks`(`taskId`)
                            ON UPDATE NO ACTION ON DELETE CASCADE
                    )""",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_task_events_taskId` " +
                        "ON `task_events` (`taskId`)",
                )
                db.execSQL(
                    """INSERT INTO `task_events` (
                        taskId, seq, eventType, state, step, checkpointJson,
                        evidenceDigest, createdAtMs
                    ) SELECT taskId, eventSeq, 'migration.snapshot', state, step, '',
                        verificationDigest, updatedAtMs
                    FROM `autonomy_tasks` WHERE eventSeq > 0""",
                )
            }
        }

        fun get(context: Context): AutonomyTaskDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                AutonomyTaskDatabase::class.java,
                "jarvis_autonomy_v2.db",
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build().also { instance = it }
        }
    }
}

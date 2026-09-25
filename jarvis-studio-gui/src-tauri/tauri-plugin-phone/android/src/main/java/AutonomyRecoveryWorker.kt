package com.jarvis.phone

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Process/reboot recovery is conservative: uncertain work is suspended, never replayed. */
class AutonomyRecoveryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val dao = AutonomyTaskDatabase.get(applicationContext).tasks()
        val recoverable = dao.recoverable()
        if (recoverable.isNotEmpty()) {
            dao.suspendInterrupted(
                "Android restarted the executor; re-observe before resuming.",
                System.currentTimeMillis(),
            )
        }
        dao.prune(System.currentTimeMillis() - TimeUnit.DAYS.toMillis(30))
        return Result.success()
    }

    companion object {
        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                "jarvis-autonomy-recovery",
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<AutonomyRecoveryWorker>().build(),
            )
        }
    }
}

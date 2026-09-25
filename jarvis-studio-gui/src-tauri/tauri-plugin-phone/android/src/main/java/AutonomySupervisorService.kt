package com.jarvis.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

/**
 * Native lifecycle boundary for user-requested autonomy. Planning remains in the TS
 * brain for now, but task identity, checkpoints, cancellation, and process-death state
 * do not. If the WebView disappears, recovery marks the task suspended; it never
 * blindly repeats the last action.
 */
class AutonomySupervisorService : Service() {
    companion object {
        const val CHANNEL_ID = "jarvis_autonomy"
        const val ACTION_START = "com.jarvis.phone.autonomy.START"
        const val ACTION_CANCEL = "com.jarvis.phone.autonomy.CANCEL"
        const val ACTION_CANCEL_ALL = "com.jarvis.phone.autonomy.CANCEL_ALL"
        const val ACTION_SUSPEND = "com.jarvis.phone.autonomy.SUSPEND"
        const val ACTION_SUSPEND_ALL = "com.jarvis.phone.autonomy.SUSPEND_ALL"
        const val ACTION_COMPLETE = "com.jarvis.phone.autonomy.COMPLETE"
        const val EXTRA_TASK_ID = "task_id"
        private const val PREFS = "jarvis_autonomy_supervisor"
        private const val ACTIVE_TASKS = "active_tasks"
        /** Version-one preference, read once so an upgrade cannot lose supervision. */
        private const val ACTIVE_TASK = "active_task"
        private const val NOTIFICATION_ID = 42021

        fun start(context: Context, taskId: String) {
            val intent = Intent(context, AutonomySupervisorService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TASK_ID, taskId)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun cancelActiveTask(context: Context) {
            context.startService(Intent(context, AutonomySupervisorService::class.java).apply {
                action = ACTION_CANCEL_ALL
            })
        }

        fun cancel(context: Context, taskId: String) {
            val intent = Intent(context, AutonomySupervisorService::class.java).apply {
                action = ACTION_CANCEL
                putExtra(EXTRA_TASK_ID, taskId)
            }
            context.startService(intent)
        }

        fun suspend(context: Context, taskId: String) {
            context.startService(Intent(context, AutonomySupervisorService::class.java).apply {
                action = ACTION_SUSPEND
                putExtra(EXTRA_TASK_ID, taskId)
            })
        }

        fun finish(context: Context, taskId: String) {
            context.startService(Intent(context, AutonomySupervisorService::class.java).apply {
                action = ACTION_COMPLETE
                putExtra(EXTRA_TASK_ID, taskId)
            })
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dao by lazy { AutonomyTaskDatabase.get(this).tasks() }
    private val activeTasks = ActiveTaskRegistry()

    override fun onCreate() {
        super.onCreate()
        createChannel()
        loadPersistedTaskIds().forEach(activeTasks::add)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val taskId = intent?.getStringExtra(EXTRA_TASK_ID)
        when (intent?.action) {
            ACTION_CANCEL -> if (taskId != null) cancel(taskId)
            ACTION_CANCEL_ALL -> cancelAll()
            ACTION_SUSPEND -> if (taskId != null) suspend(taskId, "Paused from the native notification.")
            ACTION_SUSPEND_ALL -> suspendAll(
                "Paused from the native notification; re-observation required before resume.",
            )
            ACTION_COMPLETE -> if (taskId != null) clearActive(taskId)
            ACTION_START -> if (taskId != null) showActive(taskId)
            else -> refreshForeground()
        }
        return if (activeTasks.isEmpty()) START_NOT_STICKY else START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        suspendAll("JARVIS UI closed; re-observation required before resume.")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        val interrupted = activeTasks.snapshot()
        if (interrupted.isNotEmpty()) {
            JarvisAccessibilityService.instance?.cancelAllActions()
            // onDestroy is the last reliable callback before this process boundary.
            // Persist synchronously so cancelling this service scope cannot discard it.
            runBlocking(Dispatchers.IO) {
                dao.suspendActiveTasks(
                    interrupted.toList(),
                    "Native supervisor stopped; safe re-observation required.",
                    System.currentTimeMillis(),
                )
            }
            interrupted.forEach(activeTasks::remove)
            persistActiveTasks()
        }
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun showActive(taskId: String) {
        activeTasks.add(taskId)
        persistActiveTasks()
        refreshForeground()
    }

    private fun cancel(taskId: String) {
        JarvisAccessibilityService.instance?.cancelAllActions()
        scope.launch {
            dao.cancel(taskId, System.currentTimeMillis())
            withContext(Dispatchers.Main.immediate) { clearActive(taskId) }
        }
    }

    private fun cancelAll() {
        val taskIds = activeTasks.snapshot()
        JarvisAccessibilityService.instance?.cancelAllActions()
        scope.launch {
            val now = System.currentTimeMillis()
            dao.cancelTasks(taskIds.toList(), now)
            withContext(Dispatchers.Main.immediate) {
                activeTasks.removeAll(taskIds)
                persistActiveTasks()
                stopIfIdleOrRefresh()
            }
        }
    }

    private fun suspend(taskId: String, receipt: String) {
        JarvisAccessibilityService.instance?.cancelAllActions()
        scope.launch {
            dao.suspendActive(taskId, receipt, System.currentTimeMillis())
            withContext(Dispatchers.Main.immediate) { clearActive(taskId) }
        }
    }

    private fun suspendAll(receipt: String) {
        val taskIds = activeTasks.snapshot()
        if (taskIds.isEmpty()) return
        JarvisAccessibilityService.instance?.cancelAllActions()
        scope.launch {
            val now = System.currentTimeMillis()
            dao.suspendActiveTasks(taskIds.toList(), receipt, now)
            withContext(Dispatchers.Main.immediate) {
                activeTasks.removeAll(taskIds)
                persistActiveTasks()
                stopIfIdleOrRefresh()
            }
        }
    }

    private fun clearActive(taskId: String) {
        activeTasks.remove(taskId)
        persistActiveTasks()
        stopIfIdleOrRefresh()
    }

    private fun stopIfIdleOrRefresh() {
        if (activeTasks.isEmpty()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        } else {
            refreshForeground()
        }
    }

    private fun refreshForeground() {
        val count = activeTasks.size()
        if (count == 0) return
        val text = if (count == 1) "1 task running safely in the background"
        else "$count tasks running safely in the background"
        startForeground(NOTIFICATION_ID, notification(text))
    }

    private fun loadPersistedTaskIds(): Set<String> {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val stored = prefs.getStringSet(ACTIVE_TASKS, emptySet()).orEmpty().toMutableSet()
        prefs.getString(ACTIVE_TASK, null)?.takeIf { it.isNotBlank() }?.let(stored::add)
        return stored
    }

    private fun persistActiveTasks() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putStringSet(ACTIVE_TASKS, activeTasks.snapshot())
            .remove(ACTIVE_TASK)
            .commit()
    }

    private fun notification(text: String): android.app.Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val contentIntent = launch?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val pauseIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, AutonomySupervisorService::class.java).apply {
                action = ACTION_SUSPEND_ALL
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, AutonomySupervisorService::class.java).apply {
                action = ACTION_CANCEL_ALL
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_pause)
            .setContentTitle("JARVIS is controlling this phone")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contentIntent)
            .addAction(android.R.drawable.ic_media_pause, "PAUSE", pauseIntent)
            .addAction(android.R.drawable.ic_delete, "STOP", stopIntent)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "JARVIS autonomous tasks",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "Progress with persistent Pause and Stop controls." },
            )
        }
    }
}

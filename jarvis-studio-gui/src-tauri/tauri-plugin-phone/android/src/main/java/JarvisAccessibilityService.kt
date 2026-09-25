package com.jarvis.phone

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Accessibility world-model and actuator for unattended phone tasks.
 *
 * A transient list index is never sufficient authority to act. Every snapshot has a
 * monotonic generation and each node has a selector tied to its window, resource id,
 * role and hierarchy path. Actions echo that receipt; stale/ambiguous receipts are
 * rejected before touching the UI. Gesture commands resolve only after Android calls
 * onCompleted and the accessibility event stream has become quiet.
 */
class JarvisAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile var instance: JarvisAccessibilityService? = null
        const val MAX_NODES = 180
        private const val SCREENSHOT_MAX_DIM = 1080
        private const val SCREENSHOT_JPEG_QUALITY = 60
        private const val QUIET_MS = 220L
        private const val QUIESCENCE_TIMEOUT_MS = 1_800L

        // Android does not guarantee a GestureResultCallback: if the service loses
        // window focus or a system dialog steals input, NEITHER onCompleted nor
        // onCancelled arrives. The Invoke is only resolved from that callback, and
        // neither the Rust bridge nor the JS `phoneInvoke` applies a timeout, so the
        // whole phone_task loop wedged until the app was restarted (shouldAbort is
        // polled between steps, not during an awaited invoke, so STOP could not clear
        // it either). Comfortably longer than any real gesture plus its settle time.
        private const val GESTURE_CALLBACK_TIMEOUT_MS = 5_000L

        val stopTapSeq = AtomicInteger(0)
    }

    data class NodeRef(
        val index: Int,
        val handle: AccessibilityNodeInfo,
        val text: String,
        val description: String,
        val id: String,
        val role: String,
        val enabled: Boolean,
        val focused: Boolean,
        val clickable: Boolean,
        val editable: Boolean,
        val scrollable: Boolean,
        val checkable: Boolean,
        val checked: Boolean,
        val selected: Boolean,
        val password: Boolean,
        val actions: List<Int>,
        val bounds: Rect,
        val windowId: Int,
        val path: String,
        val collectionIndex: Int,
        val selector: String,
    )

    data class Snapshot(
        val app: String,
        val nodes: List<NodeRef>,
        val generation: Long,
        val windowId: Int,
        val observedAtMs: Long,
    )

    data class TargetReceipt(
        val index: Int,
        val generation: Long = -1L,
        val selector: String = "",
        val expectedApp: String = "",
        val windowId: Int = -1,
    )

    data class ActionReceipt(
        val ok: Boolean,
        val summary: String,
        val code: String = if (ok) "ok" else "action_failed",
        val generation: Long = -1L,
    )

    private data class Resolved(val snapshot: Snapshot, val node: NodeRef)

    private val screenGeneration = AtomicLong(1L)
    private val actionEpoch = AtomicInteger(1)
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var lastEventAtMs = SystemClock.elapsedRealtime()
    private var stopOverlayView: TextView? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        markScreenChanged()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        cancelAllActions()
        hideStopOverlay()
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        cancelAllActions()
        hideStopOverlay()
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        markScreenChanged()
    }

    override fun onInterrupt() {
        cancelAllActions()
    }

    private fun markScreenChanged() {
        lastEventAtMs = SystemClock.elapsedRealtime()
        screenGeneration.incrementAndGet()
    }

    /** Invalidates callbacks from every gesture already in flight. */
    fun cancelAllActions() {
        actionEpoch.incrementAndGet()
    }

    // ── Cross-app hard STOP ──────────────────────────────────────────────────

    private fun windowManager(): WindowManager = getSystemService(WINDOW_SERVICE) as WindowManager

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    fun showStopOverlay() {
        if (stopOverlayView != null) return
        try {
            val size = dp(48)
            val view = TextView(this).apply {
                text = "STOP"
                setTextColor(Color.WHITE)
                textSize = 10f
                gravity = Gravity.CENTER
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor("#E5384D"))
                }
                elevation = dp(6).toFloat()
                setOnClickListener {
                    stopTapSeq.incrementAndGet()
                    cancelAllActions()
                    AutonomySupervisorService.cancelActiveTask(applicationContext)
                    isEnabled = false
                    alpha = 0.5f
                }
            }
            val params = WindowManager.LayoutParams(
                size,
                size,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = dp(8)
                y = dp(160)
            }
            windowManager().addView(view, params)
            stopOverlayView = view
        } catch (e: Exception) {
            android.util.Log.w("JarvisA11y", "showStopOverlay failed: ${e.message}")
        }
    }

    fun hideStopOverlay() {
        val view = stopOverlayView ?: return
        stopOverlayView = null
        try { windowManager().removeView(view) } catch (_: Exception) {}
    }

    // ── Event-driven world model ─────────────────────────────────────────────

    fun snapshot(): Snapshot {
        // If an event lands while walking, take one fresh retry so all selectors and
        // the returned generation describe one coherent revision.
        var snap = snapshotOnce()
        if (snap.generation != screenGeneration.get()) snap = snapshotOnce()
        return snap
    }

    private fun snapshotOnce(): Snapshot {
        val generation = screenGeneration.get()
        val activeRoot = rootInActiveWindow
        val activeWindowId = activeRoot?.windowId ?: -1
        val app = activeRoot?.packageName?.toString() ?: ""
        val out = ArrayList<NodeRef>()

        val roots = try {
            windows
                .sortedWith(compareByDescending<android.view.accessibility.AccessibilityWindowInfo> { it.isActive }
                    .thenByDescending { it.isFocused })
                .mapNotNull { it.root }
        } catch (_: Exception) {
            emptyList()
        }
        if (roots.isEmpty()) {
            walk(activeRoot, out, activeWindowId, "0")
        } else {
            for ((rootIndex, root) in roots.withIndex()) {
                if (out.size >= MAX_NODES) break
                walk(root, out, root.windowId, rootIndex.toString())
            }
        }
        return Snapshot(app, out, generation, activeWindowId, SystemClock.elapsedRealtime())
    }

    private fun walk(
        node: AccessibilityNodeInfo?,
        out: ArrayList<NodeRef>,
        windowId: Int,
        path: String,
    ) {
        if (node == null || out.size >= MAX_NODES) return
        val text = node.text?.toString()?.trim()?.take(160) ?: ""
        val description = node.contentDescription?.toString()?.trim()?.take(160) ?: ""
        val id = node.viewIdResourceName?.take(160) ?: ""
        val role = node.className?.toString()?.substringAfterLast('.') ?: ""
        val actionable = node.isClickable || node.isEditable || node.isScrollable ||
            node.isLongClickable || text.isNotEmpty() || description.isNotEmpty()
        if (actionable) {
            val bounds = Rect().also(node::getBoundsInScreen)
            val collectionIndex = node.collectionItemInfo?.let {
                if (it.rowIndex >= 0) it.rowIndex else it.columnIndex
            } ?: -1
            val selector = selectorFor(windowId, id, role, path, collectionIndex, text, description)
            out.add(
                NodeRef(
                    index = out.size,
                    handle = node,
                    text = text,
                    description = description,
                    id = id,
                    role = role,
                    enabled = node.isEnabled,
                    focused = node.isFocused,
                    clickable = node.isClickable,
                    // Some apps' text fields accept SET_TEXT without flagging isEditable.
                    editable = node.isEditable ||
                        node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT },
                    scrollable = node.isScrollable,
                    checkable = node.isCheckable,
                    checked = node.isChecked,
                    selected = node.isSelected,
                    password = node.isPassword,
                    actions = node.actionList.map { it.id },
                    bounds = bounds,
                    windowId = windowId,
                    path = path,
                    collectionIndex = collectionIndex,
                    selector = selector,
                ),
            )
        }
        for (i in 0 until node.childCount) {
            walk(node.getChild(i), out, windowId, "$path.$i")
            if (out.size >= MAX_NODES) return
        }
    }

    private fun selectorFor(
        windowId: Int,
        id: String,
        role: String,
        path: String,
        collectionIndex: Int,
        text: String,
        description: String,
    ): String {
        val fallbackText = if (id.isBlank()) (text.ifBlank { description }).lowercase().take(80) else ""
        val raw = "$windowId|$id|$role|$path|$collectionIndex|$fallbackText"
        val bytes = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8)).copyOf(12)
        return Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE).trimEnd('=')
    }

    private fun resolve(receipt: TargetReceipt): Pair<Resolved?, ActionReceipt?> {
        if (isDeviceLocked()) {
            return Pair(null, ActionReceipt(false, "The phone is locked; task suspended until unlock.", "device_locked", screenGeneration.get()))
        }
        val snap = snapshot()
        if (receipt.generation >= 0 && receipt.generation != snap.generation) {
            return Pair(null, ActionReceipt(false, "The screen changed before the action.", "stale_observation", snap.generation))
        }
        if (receipt.expectedApp.isNotBlank() && receipt.expectedApp != snap.app) {
            return Pair(null, ActionReceipt(false, "The foreground app changed before the action.", "stale_observation", snap.generation))
        }
        val matches = if (receipt.selector.isNotBlank()) {
            snap.nodes.filter { it.selector == receipt.selector }
        } else {
            snap.nodes.filter { it.index == receipt.index }
        }
        if (matches.size != 1) {
            return Pair(null, ActionReceipt(false, "The target is missing or ambiguous.", "stale_observation", snap.generation))
        }
        val node = matches.single()
        if (receipt.windowId >= 0 && node.windowId != receipt.windowId) {
            return Pair(null, ActionReceipt(false, "The target moved to another window.", "stale_observation", snap.generation))
        }
        if (receipt.selector.isNotBlank() && snap.nodes.getOrNull(receipt.index)?.selector != receipt.selector) {
            return Pair(null, ActionReceipt(false, "The observed index now identifies another control.", "stale_observation", snap.generation))
        }
        if (!node.enabled) {
            return Pair(null, ActionReceipt(false, "The target is disabled.", "target_disabled", snap.generation))
        }
        return Pair(Resolved(snap, node), null)
    }

    // ── Receipt-bound actions ────────────────────────────────────────────────

    fun tapIndex(receipt: TargetReceipt, done: (ActionReceipt) -> Unit) {
        val (resolved, error) = resolve(receipt)
        if (resolved == null) return done(error!!)
        var node: AccessibilityNodeInfo? = resolved.node.handle
        var accepted = false
        while (node != null) {
            if (node.isClickable && node.isEnabled) {
                accepted = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                break
            }
            node = node.parent
        }
        if (accepted) return awaitQuiescence(actionEpoch.get(), done)
        val b = resolved.node.bounds
        if (b.width() <= 0 || b.height() <= 0) {
            return done(ActionReceipt(false, "The target has no tappable bounds.", "action_failed", screenGeneration.get()))
        }
        dispatchTap(b.centerX(), b.centerY(), actionEpoch.get(), done)
    }

    fun longPressIndex(receipt: TargetReceipt, done: (ActionReceipt) -> Unit) {
        val (resolved, error) = resolve(receipt)
        if (resolved == null) return done(error!!)
        var node: AccessibilityNodeInfo? = resolved.node.handle
        while (node != null) {
            if (node.isLongClickable && node.isEnabled && node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) {
                return awaitQuiescence(actionEpoch.get(), done)
            }
            node = node.parent
        }
        val b = resolved.node.bounds
        if (b.width() <= 0 || b.height() <= 0) return done(ActionReceipt(false, "Target has no bounds."))
        val path = Path().apply { moveTo(b.centerX().toFloat(), b.centerY().toFloat()) }
        dispatchSingle(path, 600L, actionEpoch.get(), done)
    }

    fun doubleTapIndex(receipt: TargetReceipt, done: (ActionReceipt) -> Unit) {
        val (resolved, error) = resolve(receipt)
        if (resolved == null) return done(error!!)
        val b = resolved.node.bounds
        if (b.width() <= 0 || b.height() <= 0) return done(ActionReceipt(false, "Target has no bounds."))
        val path = Path().apply { moveTo(b.centerX().toFloat(), b.centerY().toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .addStroke(GestureDescription.StrokeDescription(path, 170, 50))
            .build()
        dispatchAndAwait(gesture, actionEpoch.get(), done)
    }

    fun setTextIndex(receipt: TargetReceipt, text: String, done: (ActionReceipt) -> Unit) {
        val (resolved, error) = resolve(receipt)
        if (resolved == null) return done(error!!)
        if (!resolved.node.editable || resolved.node.password) {
            return done(ActionReceipt(false, "Target is not a non-password editable field.", "policy_blocked", screenGeneration.get()))
        }
        resolved.node.handle.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        if (!resolved.node.handle.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            return done(ActionReceipt(false, "Android rejected the text action.", "action_failed", screenGeneration.get()))
        }
        awaitQuiescence(actionEpoch.get(), done)
    }

    fun typeFocused(receipt: TargetReceipt, text: String, done: (ActionReceipt) -> Unit) {
        val (resolved, error) = resolve(receipt)
        if (resolved == null) return done(error!!)
        val focused = resolved.node.handle
        if (!resolved.node.focused || !resolved.node.editable || resolved.node.password) {
            return done(ActionReceipt(false, "The observed field is no longer a safe focused input.", "stale_observation", screenGeneration.get()))
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        if (!focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            return done(ActionReceipt(false, "Android rejected the text action.", "action_failed", screenGeneration.get()))
        }
        awaitQuiescence(actionEpoch.get(), done)
    }

    fun tapXY(x: Int, y: Int, expectedGeneration: Long, expectedApp: String, done: (ActionReceipt) -> Unit) {
        val stale = validateScreen(expectedGeneration, expectedApp)
        if (stale != null) return done(stale)
        if (x < 0 || y < 0) return done(ActionReceipt(false, "Coordinates are invalid."))
        dispatchTap(x, y, actionEpoch.get(), done)
    }

    fun dispatchSwipe(
        startX: Int,
        startY: Int,
        endX: Int,
        endY: Int,
        duration: Long,
        expectedGeneration: Long,
        expectedApp: String,
        done: (ActionReceipt) -> Unit,
    ) {
        val stale = validateScreen(expectedGeneration, expectedApp)
        if (stale != null) return done(stale)
        val path = Path().apply {
            moveTo(startX.toFloat(), startY.toFloat())
            lineTo(endX.toFloat(), endY.toFloat())
        }
        dispatchSingle(path, duration.coerceIn(80L, 2_000L), actionEpoch.get(), done)
    }

    private fun validateScreen(expectedGeneration: Long, expectedApp: String): ActionReceipt? {
        if (isDeviceLocked()) {
            return ActionReceipt(false, "The phone is locked; task suspended until unlock.", "device_locked", screenGeneration.get())
        }
        val snap = snapshot()
        if (expectedGeneration >= 0 && expectedGeneration != snap.generation) {
            return ActionReceipt(false, "The screen changed before the gesture.", "stale_observation", snap.generation)
        }
        if (expectedApp.isNotBlank() && expectedApp != snap.app) {
            return ActionReceipt(false, "The foreground app changed before the gesture.", "stale_observation", snap.generation)
        }
        return null
    }

    fun scrollDir(direction: String, done: (ActionReceipt) -> Unit) {
        if (isDeviceLocked()) {
            return done(ActionReceipt(false, "The phone is locked; task suspended until unlock.", "device_locked", screenGeneration.get()))
        }
        val epoch = actionEpoch.get()
        val snap = snapshot()
        val before = navigationStateDigest(snap)
        fun moved() = navigationStateDigest(snapshot()) != before
        // Largest first, but a scroll only counts if the screen actually MOVED. An
        // outer container can accept ACTION_SCROLL and move nothing — Samsung
        // Settings' full-screen `coordinator` does exactly that around its real
        // RecyclerView — and reporting that as success sent the operator scrolling
        // the same dead container until its cycle guard stopped the task.
        val candidates = snap.nodes
            .filter { it.scrollable && it.bounds.width() > 0 && it.bounds.height() > 0 }
            .sortedByDescending { it.bounds.width() * it.bounds.height() }
        val action = if (direction == "up") AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD

        fun swipe() {
            val dm = resources.displayMetrics
            val cx = dm.widthPixels / 2
            val (y1, y2) = if (direction == "up") Pair(dm.heightPixels / 4, dm.heightPixels * 3 / 4)
                else Pair(dm.heightPixels * 3 / 4, dm.heightPixels / 4)
            val path = Path().apply {
                moveTo(cx.toFloat(), y1.toFloat())
                lineTo(cx.toFloat(), y2.toFloat())
            }
            dispatchAndAwait(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
                    .build(),
                epoch,
            ) { r ->
                when {
                    r.code == "cancelled" -> done(r)
                    moved() -> done(ActionReceipt(true, "Scrolled $direction.", "ok", screenGeneration.get()))
                    else -> done(
                        ActionReceipt(
                            false,
                            "Nothing on screen scrolled — the list may already be at its end.",
                            "no_effect",
                            screenGeneration.get(),
                        ),
                    )
                }
            }
        }

        fun attempt(i: Int) {
            if (i >= candidates.size) return swipe()
            if (!candidates[i].handle.performAction(action)) return attempt(i + 1)
            awaitQuiescence(epoch) { r ->
                when {
                    r.code == "cancelled" -> done(r)
                    moved() -> done(ActionReceipt(true, "Scrolled $direction.", "ok", screenGeneration.get()))
                    else -> attempt(i + 1)
                }
            }
        }
        attempt(0)
    }

    fun goBack(done: (ActionReceipt) -> Unit) =
        performGlobalNavigation(GLOBAL_ACTION_BACK, "Back", done)

    fun goHome(done: (ActionReceipt) -> Unit) =
        performGlobalNavigation(GLOBAL_ACTION_HOME, "Home", done)

    private fun performGlobalNavigation(
        globalAction: Int,
        label: String,
        done: (ActionReceipt) -> Unit,
    ) {
        if (isDeviceLocked()) {
            return done(ActionReceipt(false, "The phone is locked; task suspended until unlock.", "device_locked", screenGeneration.get()))
        }
        val beforeState = navigationStateDigest(snapshot())
        val epoch = actionEpoch.get()
        if (!performGlobalAction(globalAction)) {
            return done(ActionReceipt(false, "Android rejected the $label action.", "action_failed", screenGeneration.get()))
        }
        awaitNavigationPostcondition(beforeState, epoch, label, done)
    }

    fun isDeviceLocked(): Boolean =
        (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceLocked

    private fun dispatchTap(x: Int, y: Int, epoch: Int, done: (ActionReceipt) -> Unit) {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        dispatchSingle(path, 60L, epoch, done)
    }

    private fun dispatchSingle(path: Path, duration: Long, epoch: Int, done: (ActionReceipt) -> Unit) {
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()
        dispatchAndAwait(gesture, epoch, done)
    }

    private fun dispatchAndAwait(gesture: GestureDescription, epoch: Int, done: (ActionReceipt) -> Unit) {
        val once = AtomicBoolean(false)
        // Watchdog for a callback that never arrives at all. `once` only guards
        // against being called TWICE; nothing guaranteed it was called even once, and
        // an unresolved Invoke hangs the JS side forever.
        val watchdog = Runnable {
            if (once.compareAndSet(false, true)) {
                done(
                    ActionReceipt(
                        false,
                        "Android never reported the gesture finishing.",
                        "gesture_timeout",
                        screenGeneration.get(),
                    ),
                )
            }
        }
        val callback = object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                if (once.compareAndSet(false, true)) {
                    handler.removeCallbacks(watchdog)
                    awaitQuiescence(epoch, done)
                }
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                if (once.compareAndSet(false, true)) {
                    handler.removeCallbacks(watchdog)
                    done(ActionReceipt(false, "Android cancelled the gesture.", "cancelled", screenGeneration.get()))
                }
            }
        }
        handler.postDelayed(watchdog, GESTURE_CALLBACK_TIMEOUT_MS)
        if (!dispatchGesture(gesture, callback, handler) && once.compareAndSet(false, true)) {
            handler.removeCallbacks(watchdog)
            done(ActionReceipt(false, "Android rejected the gesture.", "action_failed", screenGeneration.get()))
        }
    }

    private fun awaitQuiescence(epoch: Int, done: (ActionReceipt) -> Unit) {
        val started = SystemClock.elapsedRealtime()
        fun poll() {
            if (epoch != actionEpoch.get()) {
                done(ActionReceipt(false, "Action cancelled by STOP.", "cancelled", screenGeneration.get()))
                return
            }
            val now = SystemClock.elapsedRealtime()
            if (now - lastEventAtMs >= QUIET_MS) {
                done(ActionReceipt(true, "Action completed and the UI settled.", "ok", screenGeneration.get()))
                return
            }
            if (now - started >= QUIESCENCE_TIMEOUT_MS) {
                done(ActionReceipt(false, "The UI did not settle after the action.", "quiescence_timeout", screenGeneration.get()))
                return
            }
            handler.postDelayed(::poll, 50L)
        }
        handler.postDelayed(::poll, QUIET_MS)
    }

    // ── Screenshot evidence ──────────────────────────────────────────────────

    private fun awaitNavigationPostcondition(
        beforeState: String,
        epoch: Int,
        label: String,
        done: (ActionReceipt) -> Unit,
    ) {
        val started = SystemClock.elapsedRealtime()
        fun poll() {
            val now = SystemClock.elapsedRealtime()
            val after = snapshot()
            when (
                navigationWaitDecision(
                    expectedEpoch = epoch,
                    currentEpoch = actionEpoch.get(),
                    startedAtMs = started,
                    nowMs = now,
                    lastEventAtMs = lastEventAtMs,
                    beforeState = beforeState,
                    afterState = navigationStateDigest(after),
                    quietMs = QUIET_MS,
                    timeoutMs = QUIESCENCE_TIMEOUT_MS,
                )
            ) {
                NavigationWaitDecision.SUCCEEDED -> done(
                    ActionReceipt(true, "$label completed and the UI settled.", "ok", after.generation),
                )
                NavigationWaitDecision.CANCELLED -> done(
                    ActionReceipt(false, "$label cancelled by STOP.", "cancelled", after.generation),
                )
                NavigationWaitDecision.TIMED_OUT -> done(
                    ActionReceipt(
                        false,
                        "$label was accepted but no resulting screen change was verified.",
                        "postcondition_failed",
                        after.generation,
                    ),
                )
                NavigationWaitDecision.WAIT -> handler.postDelayed(::poll, 50L)
            }
        }
        handler.postDelayed(::poll, QUIET_MS)
    }

    private fun navigationStateDigest(snapshot: Snapshot): String {
        val raw = buildString {
            append(snapshot.app).append('|').append(snapshot.windowId)
            snapshot.nodes.forEach { node ->
                append('\n').append(node.selector)
                    .append('|').append(node.role)
                    .append('|').append(node.text)
                    .append('|').append(node.description)
                    .append('|').append(node.enabled)
                    .append('|').append(node.focused)
                    .append('|').append(node.checked)
                    .append('|').append(node.selected)
            }
        }
        return Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP or Base64.URL_SAFE,
        )
    }

    @RequiresApi(Build.VERSION_CODES.R)
    fun captureScreenshotBase64(callback: (String?) -> Unit) {
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(screenshot: ScreenshotResult) {
                try {
                    val hwBuffer = screenshot.hardwareBuffer
                    val bitmap = Bitmap.wrapHardwareBuffer(hwBuffer, screenshot.colorSpace)
                    if (bitmap == null) {
                        hwBuffer.close()
                        callback(null)
                        return
                    }
                    try {
                        val stream = ByteArrayOutputStream()
                        val bounded = boundedScreenshotBitmap(bitmap)
                        bounded.compress(Bitmap.CompressFormat.JPEG, SCREENSHOT_JPEG_QUALITY, stream)
                        callback(Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))
                        if (bounded !== bitmap) bounded.recycle()
                    } finally {
                        bitmap.recycle()
                        hwBuffer.close()
                    }
                } catch (_: Exception) {
                    callback(null)
                }
            }

            override fun onFailure(errorCode: Int) = callback(null)
        })
    }

    private fun boundedScreenshotBitmap(bitmap: Bitmap): Bitmap {
        val maxSide = maxOf(bitmap.width, bitmap.height)
        if (maxSide <= SCREENSHOT_MAX_DIM) return bitmap
        val scale = SCREENSHOT_MAX_DIM.toFloat() / maxSide.toFloat()
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).toInt().coerceAtLeast(1),
            (bitmap.height * scale).toInt().coerceAtLeast(1),
            true,
        )
    }
}

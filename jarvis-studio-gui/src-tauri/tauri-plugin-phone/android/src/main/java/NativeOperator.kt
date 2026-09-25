package com.jarvis.phone

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android glue for the native operator (OperatorCore.kt): the accessibility device,
 * the HTTP model ladder, the Room journal, and a start/status registry the WebView
 * polls. The WebView only STARTS a task and reads its progress — nothing here waits
 * on JavaScript, which is the whole point (a hidden WebView is paused after ~60s).
 */
object NativeOperator {
    private const val TAG = "JarvisOperator"
    private const val RESULT_NOTIFICATION_ID = 42022
    private const val ACTION_TIMEOUT_MS = 15_000L
    private const val SCREENSHOT_TIMEOUT_MS = 5_000L
    private const val LAUNCH_SETTLE_MS = 4_000L
    private val ACTIVE_STATES = setOf("planning", "policy_check", "executing", "verifying")

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val runs = ConcurrentHashMap<String, Run>()

    private class Run(val taskId: String) {
        val steps = CopyOnWriteArrayList<JSONObject>()
        val benched = CopyOnWriteArrayList<JSONObject>()
        @Volatile var outcome: OperatorOutcome? = null
    }

    /** One model route, fully resolved by the TS brain (which owns endpoints and auth):
     *  native only shapes the request body. Keys live in memory only — never journaled. */
    data class RouteSpec(
        val provider: String,
        val model: String,
        val keyIndex: Int,
        val url: String,
        val headers: Map<String, String>,
        /** "gemini" (generateContent) or "openai" (chat/completions). */
        val format: String,
        /** openai format: the body field that caps output — providers disagree. */
        val maxTokensField: String = "max_completion_tokens",
        /** openai format: a reasoning_effort value, only where the provider takes it. */
        val reasoningEffort: String = "",
    )

    fun parseRoutes(json: String): List<RouteSpec> = runCatching {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { i ->
            val o = arr.getJSONObject(i)
            val headers = o.optJSONObject("headers")
            val url = o.optString("url")
            val format = o.optString("format")
            if (!url.startsWith("https://") || format !in setOf("gemini", "openai")) return@mapNotNull null
            RouteSpec(
                o.optString("provider"),
                o.optString("model"),
                o.optInt("keyIndex"),
                url,
                headers?.keys()?.asSequence()?.associateWith { headers.optString(it) } ?: emptyMap(),
                format,
                o.optString("maxTokensField").takeIf { it in setOf("max_tokens", "max_completion_tokens") }
                    ?: "max_completion_tokens",
                o.optString("reasoningEffort"),
            )
        }
    }.getOrDefault(emptyList())

    /** Starts the task; returns null on success or the reason it could not start. */
    fun start(
        context: Context,
        dao: AutonomyTaskDao,
        taskId: String,
        goal: String,
        preAuthorizedR2: Boolean,
        routes: List<RouteSpec>,
        stayInApp: Boolean = false,
    ): String? {
        if (runs.values.any { it.outcome == null }) return "Another phone task is already running."
        val run = Run(taskId)
        runs[taskId] = run
        // Keep the registry small: finished runs only matter until the WebView reads them.
        runs.keys.filter { it != taskId && runs[it]?.outcome != null }.drop(4).forEach(runs::remove)
        val app = context.applicationContext
        // Ids only — never the URL or headers (they carry keys).
        Log.i(TAG, "task $taskId routes: " + routes.joinToString { "${it.provider}/${it.model}#${it.keyIndex}" })
        scope.launch {
            val journal = DaoJournal(dao, taskId)
            val model = HttpLadderModel(
                routes,
                onBench = { run.benched += it },
                onWait = { line ->
                    run.steps += JSONObject().put("line", line).put("ok", true)
                    Log.i(TAG, line)
                },
                shouldStop = { journal.isStopped() },
            )
            val loop = OperatorLoop(
                AccessibilityDevice(app),
                model,
                journal,
                OperatorOptions(
                    taskId = taskId,
                    goal = goal,
                    preAuthorizedR2 = preAuthorizedR2,
                    selfPackage = app.packageName,
                    onStep = { line, ok ->
                        run.steps += JSONObject().put("line", line).put("ok", ok)
                        // The step feed is also logcat's only surviving record of a run.
                        if (ok) Log.i(TAG, line) else Log.w(TAG, line)
                    },
                ),
            )
            val outcome = try {
                loop.run()
            } catch (e: Exception) {
                OperatorOutcome(false, "The phone task stopped unexpectedly: ${e.message}", "phone_task_crashed")
            }
            val final = commitTerminal(app, dao, taskId, outcome)
            Log.i(TAG, "task $taskId finished ok=${final.ok} error=${final.error}: ${final.summary}")
            run.outcome = final
            // The WebView that would normally hide the STOP overlay may be paused
            // right now; don't leave it floating over the app the task just drove.
            withContext(Dispatchers.Main) { JarvisAccessibilityService.instance?.hideStopOverlay() }
            notifyResult(app, final)
            // The spoken summary is produced by the (by now paused) WebView, so until the
            // user reopens JARVIS they hear nothing — measured 2026-09-23: the answer came
            // 0.5s after foregrounding, and never before. Bring it back unless the user
            // wanted to end up in the app (media, an open chat) or stopped the task.
            if (final.error != "cancelled" && !(final.ok && stayInApp)) bringToFront(app)
        }
        return null
    }

    private fun launchIntent(context: Context): Intent? =
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

    /** Allowed from the background: a bound AccessibilityService exempts the app from
     *  Android's background-activity-launch limits (the same reason open_app works). */
    private suspend fun bringToFront(context: Context) = withContext(Dispatchers.Main) {
        try {
            launchIntent(context)?.let(context::startActivity)
        } catch (e: RuntimeException) {
            Log.w(TAG, "couldn't bring JARVIS back: ${e.message}")
        }
    }

    fun status(taskId: String, since: Int): JSONObject {
        val run = runs[taskId] ?: return JSONObject().put("ok", false).put("summary", "No such phone task.")
        val steps = run.steps.toList()
        val out = JSONObject()
            .put("ok", true)
            .put("taskId", taskId)
            .put("stepCount", steps.size)
            .put("steps", JSONArray(steps.drop(since.coerceIn(0, steps.size))))
            .put("benched", JSONArray(run.benched.toList()))
        val o = run.outcome ?: return out.put("done", false)
        return out.put("done", true).put(
            "result",
            JSONObject()
                .put("ok", o.ok)
                .put("summary", o.summary)
                .put("error", o.error ?: JSONObject.NULL)
                .put("needsApproval", o.needsApproval)
                .put("findings", JSONArray(o.findings))
                .put("verificationReceipt", o.verificationReceipt),
        )
    }

    /** Port of runPhoneTask's terminal bookkeeping: success must carry a well-formed
     *  receipt AND be accepted by the journal's compare-and-set, or it isn't reported. */
    private suspend fun commitTerminal(
        context: Context,
        dao: AutonomyTaskDao,
        taskId: String,
        outcome: OperatorOutcome,
    ): OperatorOutcome {
        var r = outcome
        if (r.ok && !OperatorLoop.VERIFICATION_RECEIPT_RE.matches(r.verificationReceipt)) {
            r = r.copy(
                ok = false,
                summary = "The outcome looked complete, but Aura could not create durable verification evidence.",
                error = "verification_unavailable",
            )
        }
        val state = when {
            r.ok -> "succeeded"
            r.error == "cancelled" -> "cancelled"
            r.needsApproval || r.error == "verification_unavailable" -> "suspended"
            else -> "failed"
        }
        val committed = finishJournalTask(context, dao, taskId, state, r.summary, if (r.ok) r.verificationReceipt else "")
        if (r.ok && !committed) {
            finishJournalTask(context, dao, taskId, "suspended", "Verified outcome could not be committed; re-observation is required.", "")
            return r.copy(
                ok = false,
                summary = "Aura verified the screen, but the durable task journal rejected completion, so success was not reported.",
                error = "verification_commit_failed",
            )
        }
        return r
    }

    /** The user is usually in another app when a task ends — tell them there. */
    private fun notifyResult(context: Context, outcome: OperatorOutcome) {
        try {
            val content = launchIntent(context)?.let {
                PendingIntent.getActivity(context, 3, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }
            val n = NotificationCompat.Builder(context, PhonePlugin.REMINDER_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(if (outcome.ok) "JARVIS finished" else "JARVIS stopped")
                .setContentText(outcome.summary)
                .setStyle(NotificationCompat.BigTextStyle().bigText(outcome.summary))
                .setAutoCancel(true)
                .setContentIntent(content)
                .build()
            NotificationManagerCompat.from(context).notify(RESULT_NOTIFICATION_ID, n)
        } catch (e: SecurityException) {
            Log.w(TAG, "result notification not permitted: ${e.message}")
        }
    }

    // ── Journal ──

    private class DaoJournal(private val dao: AutonomyTaskDao, private val taskId: String) : OperatorJournal {
        private val stopSeqAtStart = JarvisAccessibilityService.stopTapSeq.get()

        override suspend fun checkpoint(state: String, step: Int, receipt: String, verifiedCheckpoint: String): Boolean {
            val safeReceipt = TaskJournalPayloadPolicy.safeText(receipt, 800) ?: return false
            val safeCheckpoint = TaskJournalPayloadPolicy.verifiedCheckpoint(verifiedCheckpoint) ?: return false
            return dao.checkpoint(taskId, state, step.coerceAtLeast(0), safeReceipt, System.currentTimeMillis(), safeCheckpoint) == 1
        }

        override suspend fun isStopped(): Boolean {
            // The overlay STOP also cancels through the supervisor → journal; the seq is
            // a belt-and-braces check that doesn't depend on that intent being delivered.
            if (JarvisAccessibilityService.stopTapSeq.get() != stopSeqAtStart) return true
            val row = dao.get(taskId) ?: return true
            return row.cancelRequested || row.state !in ACTIVE_STATES
        }
    }

    // ── Device ──

    private class AccessibilityDevice(private val context: Context) : OperatorDevice {
        private fun svc() = JarvisAccessibilityService.instance

        override suspend fun observe(): OpObservation {
            val s = svc() ?: return OpObservation("", emptyList(), ready = false)
            val snap = s.snapshot()
            return OpObservation(
                app = snap.app,
                generation = snap.generation,
                windowId = snap.windowId,
                nodes = snap.nodes.map { n ->
                    OpNode(
                        index = n.index,
                        text = n.text,
                        role = n.role,
                        description = n.description,
                        id = n.id,
                        selector = n.selector,
                        windowId = n.windowId,
                        enabled = n.enabled,
                        focused = n.focused,
                        clickable = n.clickable,
                        editable = n.editable,
                        scrollable = n.scrollable,
                        checked = if (n.checkable) n.checked else null,
                        selected = n.selected,
                        password = n.password,
                        bounds = OpBounds(n.bounds.left, n.bounds.top, n.bounds.width(), n.bounds.height()),
                    )
                },
            )
        }

        override suspend fun screenshot(): String? {
            val s = svc() ?: return null
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
            return withTimeoutOrNull(SCREENSHOT_TIMEOUT_MS) {
                suspendCancellableCoroutine { cont ->
                    s.captureScreenshotBase64 { b64 -> if (cont.isActive) cont.resume(b64) }
                }
            }
        }

        override suspend fun openApp(name: String): OpResult {
            val s = svc()
            if (s?.isDeviceLocked() == true) {
                return OpResult(false, "The phone is locked; task suspended until unlock.", "device_locked")
            }
            val before = s?.snapshot()?.app.orEmpty()
            if (!withContext(Dispatchers.Main) { launchApp(context, name) }) {
                return OpResult(false, "Couldn't find an app called $name.")
            }
            // An accepted launch intent is not a launched app. Wait (briefly) for the
            // foreground to actually change, so the next step sees the app — on-device
            // the operator re-opened WhatsApp because it observed the launcher instead.
            val until = SystemClock.elapsedRealtime() + LAUNCH_SETTLE_MS
            while (SystemClock.elapsedRealtime() < until) {
                val now = svc()?.snapshot()?.app.orEmpty()
                if (now.isNotEmpty() && now != before) break
                delay(150)
            }
            return OpResult(true, "Opened $name.")
        }

        private fun receipt(t: OpTarget) = JarvisAccessibilityService.TargetReceipt(
            index = t.index,
            generation = t.generation,
            selector = t.selector,
            expectedApp = t.expectedApp,
            windowId = t.windowId,
        )

        private suspend fun act(
            block: (JarvisAccessibilityService, (JarvisAccessibilityService.ActionReceipt) -> Unit) -> Unit,
        ): OpResult {
            val s = svc() ?: return OpResult(false, "The JARVIS accessibility service isn't enabled.", "service_off")
            val r = withTimeoutOrNull(ACTION_TIMEOUT_MS) {
                suspendCancellableCoroutine<JarvisAccessibilityService.ActionReceipt> { cont ->
                    block(s) { rec -> if (cont.isActive) cont.resume(rec) }
                }
            } ?: return OpResult(false, "The phone never reported the action finishing.", "native_timeout")
            return OpResult(r.ok, r.summary, r.code)
        }

        override suspend fun tap(target: OpTarget) = act { s, done -> s.tapIndex(receipt(target), done) }
        override suspend fun longPress(target: OpTarget) = act { s, done -> s.longPressIndex(receipt(target), done) }
        override suspend fun doubleTap(target: OpTarget) = act { s, done -> s.doubleTapIndex(receipt(target), done) }
        override suspend fun setText(target: OpTarget, text: String) =
            act { s, done -> s.setTextIndex(receipt(target), text, done) }
        override suspend fun typeText(target: OpTarget, text: String) =
            act { s, done -> s.typeFocused(receipt(target), text, done) }
        override suspend fun tapXY(x: Int, y: Int, generation: Long, expectedApp: String) =
            act { s, done -> s.tapXY(x, y, generation, expectedApp, done) }
        override suspend fun drag(fromX: Int, fromY: Int, toX: Int, toY: Int, generation: Long, expectedApp: String) =
            act { s, done -> s.dispatchSwipe(fromX, fromY, toX, toY, 300L, generation, expectedApp, done) }
        override suspend fun scroll(direction: String) = act { s, done -> s.scrollDir(direction, done) }
        override suspend fun back() = act { s, done -> s.goBack(done) }
        override suspend fun home() = act { s, done -> s.goHome(done) }
    }

    // ── Model ladder ──

    /**
     * Walks the routes in the brain's order until one answers, paced by [RoutePacer]:
     * a route that is briefly rate-limited (or that Groq's own headers say is out of
     * tokens) is skipped until it's ready, and when EVERY route is only briefly out
     * the ladder waits — in 1s slices that honour STOP — instead of reporting the
     * quota spent. Failures are reported back through [onBench] so the brain's
     * persistent quota table learns them too.
     */
    private class HttpLadderModel(
        private val routes: List<RouteSpec>,
        private val onBench: (JSONObject) -> Unit,
        private val onWait: (String) -> Unit,
        private val shouldStop: suspend () -> Boolean,
    ) : OperatorModelClient {
        companion object {
            /** Wait for a route only when one returns within this long — a full
             *  per-minute window, since that's what a TPM/RPM bucket can take to refill. */
            private const val MAX_SINGLE_WAIT_MS = 65_000L
            /** …and never spend more than this waiting inside one model call. */
            private const val MAX_TOTAL_WAIT_MS = 90_000L
            /** Rough output allowance added to the prompt estimate (maxOutputTokens). */
            private const val OUTPUT_TOKENS = 800
        }

        override val wantsImages = routes.firstOrNull()?.format == "gemini"
        private val pacer = RoutePacer(routes.size) { SystemClock.elapsedRealtime() }

        private class HttpFail(
            val status: Int,
            val detail: String,
            val retryAfterMs: Long?,
            val timedOut: Boolean = false,
        ) : Exception(detail)

        override suspend fun next(system: String, user: String, images: List<String>, timeoutMs: Long): String =
            withContext(Dispatchers.IO) {
                // ~4 chars a token, plus the output allowance: enough to skip a route
                // whose remaining-token header says this request won't fit.
                val estTokens = (system.length + user.length) / 4 + OUTPUT_TOKENS
                var waited = 0L
                var last = ""
                while (true) {
                    val ready = routes.indices.firstOrNull { pacer.readyIn(it, estTokens) == 0L }
                    if (ready == null) {
                        val (soonest, wait) = routes.indices
                            .map { it to pacer.readyIn(it, estTokens) }
                            .minBy { it.second }
                        if (wait > MAX_SINGLE_WAIT_MS || waited + wait > MAX_TOTAL_WAIT_MS) {
                            Log.w(
                                TAG,
                                "no route ready (waited ${waited}ms): " + routes.indices.joinToString { i ->
                                    "${routes[i].provider}/${routes[i].model}=${pacer.readyIn(i, estTokens)}ms"
                                },
                            )
                            break
                        }
                        val r = routes[soonest]
                        onWait("(rate limited — waiting ${(wait + 999) / 1000}s for ${r.provider}/${r.model})")
                        if (!sleepUnlessStopped(wait + 250)) {
                            // STOP during the wait: hand back no command. The loop treats
                            // it as an unclear reply and its own STOP check ends the task.
                            return@withContext ""
                        }
                        waited += wait + 250
                        continue
                    }
                    val r = routes[ready]
                    try {
                        return@withContext post(ready, r, system, user, images, timeoutMs)
                    } catch (e: HttpFail) {
                        // Optional work on a shortened clock: a timeout says nothing about
                        // the route, so neither bench it nor spend more routes on it.
                        if (e.timedOut && timeoutMs < OperatorLoop.MODEL_TIMEOUT_MS) {
                            throw ModelException("${r.provider} timed out after ${timeoutMs}ms")
                        }
                        if (!retryable(e.status)) {
                            throw ModelException("${r.provider} ${e.status}: ${e.detail.take(160)}")
                        }
                        bench(ready, r, e)
                        last = "${r.provider}/${r.model} ${if (e.status == 0) "unreachable" else e.status}"
                    }
                }
                throw ModelException(
                    "I've used up the free quota on every model I can reach" + if (last.isNotEmpty()) " ($last)." else ".",
                    rateLimited = true,
                    transient = true,
                )
            }

        /** False if STOP arrived during the wait. */
        private suspend fun sleepUnlessStopped(ms: Long): Boolean {
            var left = ms
            while (left > 0) {
                if (shouldStop()) return false
                val slice = minOf(1_000L, left)
                delay(slice)
                left -= slice
            }
            return !shouldStop()
        }

        /** errorClass.isRetryable plus 400: a native body is model-specific, and a 400
         *  from the first route used to end the whole task (2026-09-25, thinkingBudget). */
        private fun retryable(status: Int) =
            status == 0 || status >= 500 || status in setOf(400, 401, 403, 404, 408, 409, 410, 413, 422, 429)

        private fun bench(i: Int, r: RouteSpec, e: HttpFail) {
            val sameModel = routes.indices.filter { routes[it].model == r.model }
            val forMs = pacer.noteFailure(i, e.status, e.detail, e.retryAfterMs, sameModel)
            val shown = if (forMs >= RoutePacer.GONE) "for this task" else "${forMs / 1000}s"
            Log.w(
                TAG,
                "route ${r.provider}/${r.model}#${r.keyIndex} benched $shown: ${e.status} " +
                    "window=${RoutePacer.limitWindow(e.detail)} retryAfter=${e.retryAfterMs} " +
                    e.detail.replace(Regex("\\s+"), " ").take(240),
            )
            onBench(
                JSONObject()
                    .put("provider", r.provider)
                    .put("model", r.model)
                    .put("keyIndex", r.keyIndex)
                    .put("status", e.status)
                    // Long enough for the brain to see the quota window (limitWindow).
                    .put("detail", e.detail.take(2_000))
                    .put("retryAfterMs", e.retryAfterMs ?: JSONObject.NULL),
            )
        }

        private fun post(i: Int, r: RouteSpec, system: String, user: String, images: List<String>, timeoutMs: Long): String {
            val body = if (r.format == "gemini") geminiBody(r.model, system, user, images) else openAiBody(r, system, user)
            val conn = try {
                (URL(r.url).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15_000
                    readTimeout = timeoutMs.toInt()
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    r.headers.forEach { (k, v) -> setRequestProperty(k, v) }
                }
            } catch (e: IOException) {
                throw HttpFail(0, "connection failed: ${e.message}", null)
            }
            try {
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val tokensLeft = conn.getHeaderField("x-ratelimit-remaining-tokens")
                val tokensReset = conn.getHeaderField("x-ratelimit-reset-tokens")
                pacer.noteHeaders(i, tokensLeft, tokensReset)
                // Every response, not just Groq's: which route answered is the first
                // thing a failed run's log needs to say.
                Log.d(
                    TAG,
                    "${r.provider}/${r.model}#${r.keyIndex} HTTP $code" +
                        if (tokensLeft != null) " tokens left=$tokensLeft reset=$tokensReset" else "",
                )
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                if (code !in 200..299) {
                    val retryAfter = RoutePacer.retryAfterMs(conn.getHeaderField("Retry-After"), text)
                    throw HttpFail(code, text.take(2_000), retryAfter)
                }
                val json = JSONObject(text)
                val reply = if (r.format == "gemini") {
                    val parts = json.optJSONArray("candidates")?.optJSONObject(0)
                        ?.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
                    // Skip thought parts: Gemma 4 returns them regardless of includeThoughts.
                    (0 until parts.length()).mapNotNull { parts.optJSONObject(it) }
                        .filterNot { it.optBoolean("thought") }
                        .joinToString("") { it.optString("text") }.trim()
                } else {
                    // optString, not getString: a JSON null content must read as "", not "null".
                    val msg = json.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")
                    if (msg == null || msg.isNull("content")) "" else msg.optString("content").trim()
                }
                // An empty 200 is a failed call, not an answer — OpenRouter's free nemotron
                // returned three in a row (2026-09-23) and each one burned a step as an
                // "unclear reply" until the task gave up with four routes still untried.
                if (reply.isEmpty()) throw HttpFail(502, "empty reply: $text", null)
                return reply
            } catch (e: HttpFail) {
                throw e
            } catch (e: java.net.SocketTimeoutException) {
                throw HttpFail(0, "timed out after ${timeoutMs}ms", null, timedOut = true)
            } catch (e: IOException) {
                throw HttpFail(0, "network: ${e.message}", null)
            } finally {
                conn.disconnect()
            }
        }

        private fun geminiBody(model: String, system: String, user: String, images: List<String>): JSONObject {
            val parts = JSONArray().put(JSONObject().put("text", user))
            images.forEach { parts.put(JSONObject().put("inlineData", JSONObject().put("mimeType", "image/jpeg").put("data", it))) }
            val gen = JSONObject().put("maxOutputTokens", 800)
            // One small JSON command per step is mechanical — thinking is pure latency.
            thinkingOff(model)?.let { gen.put("thinkingConfig", it) }
            return JSONObject()
                .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
                .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
                .put("generationConfig", gen)
        }

        private fun openAiBody(r: RouteSpec, system: String, user: String): JSONObject {
            val body = JSONObject()
                .put("model", r.model)
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "system").put("content", system))
                        .put(JSONObject().put("role", "user").put("content", user)),
                )
                .put(r.maxTokensField, 800)
            // Only where the brain says the provider takes it — a plain llama 400s on it.
            if (r.reasoningEffort.isNotEmpty()) body.put("reasoning_effort", r.reasoningEffort)
            return body
        }
    }
}

/** The least-thinking config each Gemini generation accepts (measured 2026-09-25):
 *  2.5 takes thinkingBudget=0 and 400s on thinkingLevel; 3.x 400s on budget 0
 *  (3.5-flash-lite) and takes thinkingLevel="minimal". Gemma 4 takes minimal|high
 *  only (400s on a budget). Older models take neither. */
internal fun thinkingOff(model: String): JSONObject? = when {
    Regex("gemma-4", RegexOption.IGNORE_CASE).containsMatchIn(model) ->
        JSONObject().put("thinkingLevel", "minimal")
    Regex("gemini-2\\.5", RegexOption.IGNORE_CASE).containsMatchIn(model) ->
        JSONObject().put("thinkingBudget", 0)
    Regex("gemini-[3-9]", RegexOption.IGNORE_CASE).containsMatchIn(model) ->
        JSONObject().put("thinkingLevel", "minimal")
    else -> null
}

/** Resolve a user-facing app name (or package) to its launcher activity and start it. */
internal fun launchApp(context: Context, name: String): Boolean {
    val pm = context.packageManager
    val target = name.trim().lowercase()
    if (target.isEmpty()) return false
    val launcher = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
    val apps = pm.queryIntentActivities(launcher, 0)
    val match = apps.firstOrNull { it.loadLabel(pm).toString().lowercase().contains(target) }
        ?: apps.firstOrNull {
            val pkg = it.activityInfo?.packageName.orEmpty().lowercase()
            val cls = it.activityInfo?.name.orEmpty().lowercase()
            pkg.contains(target) || cls.contains(target)
        }
    val info = match?.activityInfo ?: return false
    context.startActivity(
        Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            setClassName(info.packageName, info.name)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        },
    )
    return true
}

/** The one terminal-transition path for the journal, shared by the task_finish
 *  command and the native operator. Returns whether the journal accepted it. */
internal suspend fun finishJournalTask(
    context: Context,
    dao: AutonomyTaskDao,
    taskId: String,
    state: String,
    result: String,
    verificationReceipt: String,
): Boolean {
    val safeResult = TaskJournalPayloadPolicy.safeText(result, 2_000)
        ?: "Sensitive result omitted from the durable journal."
    val now = System.currentTimeMillis()
    val changed = when (state) {
        "succeeded" -> dao.finishSucceeded(taskId, safeResult, verificationReceipt, sha256Hex(verificationReceipt), now)
        "cancelled" -> dao.cancel(taskId, now)
        else -> dao.finishWithoutSuccess(taskId, state, safeResult, now)
    }
    if (changed == 1) {
        if (state == "cancelled") {
            JarvisAccessibilityService.instance?.cancelAllActions()
            AutonomySupervisorService.cancel(context, taskId)
        } else {
            AutonomySupervisorService.finish(context, taskId)
        }
    }
    return changed == 1
}

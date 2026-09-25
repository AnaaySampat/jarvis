package com.jarvis.phone

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ports of the TS operator tests (phone/parity/approval/rankNodes/renderObs.test.ts)
 *  that still apply now the loop is native. */
class OperatorCoreTest {

    // ── Fakes ──

    private class FakeDevice(private val screens: List<OpObservation>) : OperatorDevice {
        val actions = mutableListOf<String>()
        val targets = mutableListOf<OpTarget>()
        /** Codes the next taps fail with, in order (then they succeed). */
        val tapFailures = ArrayDeque<String>()
        var shot: String? = null
        var audio: Boolean? = null
        override suspend fun musicActive() = audio
        var namedApp: String? = null
        override suspend fun appNamedIn(goal: String) = namedApp
        private var observed = 0
        override suspend fun observe(): OpObservation = screens[minOf(observed++, screens.size - 1)]
        override suspend fun screenshot(): String? = shot
        override suspend fun openApp(name: String) = rec("openApp:$name")
        override suspend fun tap(target: OpTarget): OpResult {
            tapFailures.removeFirstOrNull()?.let { code ->
                actions += "tapFailed:${target.index}:$code"
                return OpResult(false, "The screen changed before the action.", code)
            }
            return rec("tap:${target.index}", target)
        }
        override suspend fun longPress(target: OpTarget) = rec("longPress:${target.index}", target)
        override suspend fun doubleTap(target: OpTarget) = rec("doubleTap:${target.index}", target)
        override suspend fun setText(target: OpTarget, text: String) = rec("setText:${target.index}:$text", target)
        override suspend fun typeText(target: OpTarget, text: String) = rec("type:$text", target)
        override suspend fun pressEnter(target: OpTarget) = rec("enter:${target.index}", target)
        override suspend fun tapXY(x: Int, y: Int, generation: Long, expectedApp: String) = rec("tapXY:$x,$y")
        override suspend fun drag(fromX: Int, fromY: Int, toX: Int, toY: Int, generation: Long, expectedApp: String) =
            rec("drag:$fromX,$fromY->$toX,$toY")
        override suspend fun scroll(direction: String) = rec("scroll:$direction")
        override suspend fun back() = rec("back")
        override suspend fun home() = rec("home")
        private fun rec(a: String, t: OpTarget? = null): OpResult {
            actions += a
            t?.let(targets::add)
            return OpResult(true, "did $a")
        }
    }

    private class ScriptedModel(vararg replies: String) : OperatorModelClient {
        var vision = false
        override val wantsImages get() = vision
        private val queue = ArrayDeque(replies.toList())
        val prompts = mutableListOf<String>()
        val imageCounts = mutableListOf<Int>()
        var error: Exception? = null
        override suspend fun next(system: String, user: String, images: List<String>, timeoutMs: Long): String {
            prompts += user
            imageCounts += images.size
            error?.let { throw it }
            return queue.removeFirstOrNull() ?: throw ModelException("script exhausted")
        }
    }

    private class FakeJournal : OperatorJournal {
        val states = mutableListOf<String>()
        var reject: String? = null
        var stopped = false
        override suspend fun checkpoint(state: String, step: Int, receipt: String, verifiedCheckpoint: String): Boolean {
            states += state
            return state != reject
        }
        override suspend fun isStopped() = stopped
    }

    private fun screen(vararg nodes: OpNode, app: String = "com.test", gen: Long = 7) =
        OpObservation(app, nodes.toList(), generation = gen, windowId = 3)

    private fun node(i: Int, text: String, role: String = "Button", clickable: Boolean = true, editable: Boolean = false,
                     focused: Boolean = false, desc: String = "", checked: Boolean? = null, selector: String = "sel$i") =
        OpNode(i, text, role, description = desc, clickable = clickable, editable = editable, focused = focused,
            checked = checked, selector = selector, windowId = 3, bounds = OpBounds(0, i * 100, 200, 90))

    private val pass = """{"verdict":"pass"}"""

    private fun run(
        goal: String,
        device: OperatorDevice,
        model: OperatorModelClient,
        journal: FakeJournal = FakeJournal(),
        verifier: OperatorModelClient = ScriptedModel(pass),
        preAuthorizedR2: Boolean = false,
        plan: Boolean = false,
        maxSteps: Int = OperatorLoop.DEFAULT_MAX_STEPS,
        lines: MutableList<String> = mutableListOf(),
    ) = runBlocking {
        OperatorLoop(
            device, model, journal,
            OperatorOptions(
                taskId = "t1", goal = goal, preAuthorizedR2 = preAuthorizedR2, plan = plan, maxSteps = maxSteps,
                sleep = {}, onStep = { l, _ -> lines += l },
            ),
            verifier,
        ).run()
    }

    // ── Gesture primitives + receipts ──

    @Test fun dispatchesGesturesAndBindsTargetsToTheObservation() {
        val dev = FakeDevice(listOf(screen(node(0, "Photo"), node(1, "List"))))
        val out = run(
            "zoom the photo", dev,
            ScriptedModel(
                """{"do":"long_press","target":0}""", """{"do":"double_tap","target":1}""",
                """{"do":"drag","from_x":10,"from_y":20,"to_x":30,"to_y":40}""", """{"do":"done","summary":"Zoomed."}""",
            ),
            preAuthorizedR2 = true,
        )
        // drag is ungrounded geometry → R2 → allowed only because of pre-authorisation
        assertEquals(listOf("longPress:0", "doubleTap:1", "drag:10,20->30,40"), dev.actions)
        assertTrue(out.ok)
        val t = dev.targets.first()
        assertEquals(7L, t.generation); assertEquals(3, t.windowId); assertEquals("sel0", t.selector)
        assertEquals("com.test", t.expectedApp)
    }

    // ── Truthful completion ──

    @Test fun rejectsAFalseDoneOnceThenAcceptsWhenTheCheckerPasses() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val out = run(
            "press go", dev,
            ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed."}""",
                """{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed it."}"""),
            verifier = ScriptedModel("""{"verdict":"fail","reason":"not yet"}""", pass),
        )
        assertTrue(out.ok)
        assertTrue(out.steps.any { it.contains("done REJECTED") && it.contains("not yet") })
        assertTrue(OperatorLoop.VERIFICATION_RECEIPT_RE.matches(out.verificationReceipt))
    }

    @Test fun failsClosedWhenTheCheckerReturnsGarbage() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val out = run(
            "press go", dev,
            ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed."}""",
                """{"do":"fail","summary":"gave up honestly"}"""),
            verifier = ScriptedModel("sure, looks fine"),
        )
        assertFalse(out.ok)
        assertEquals("", out.verificationReceipt)
    }

    @Test fun anUnavailableCheckerSuspendsInsteadOfClaimingSuccess() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val verifier = ScriptedModel().apply { error = ModelException("503 overloaded", transient = true) }
        val out = run("press go", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed."}"""),
            verifier = verifier)
        assertFalse(out.ok)
        assertEquals("verification_unavailable", out.error)
        assertEquals(OperatorLoop.VERIFY_ATTEMPTS, verifier.prompts.size) // transient → retried
    }

    @Test fun aDoneWithNoActuationIsNotBelieved() {
        val out = run("press go", FakeDevice(listOf(screen(node(0, "Go")))),
            ScriptedModel("""{"do":"note","text":"price is 5"}""", """{"do":"done","summary":"Did it."}"""))
        assertFalse(out.ok)
        assertTrue(out.summary.contains("didn't actually"))
    }

    @Test fun doesNotActuateAfterTheJournalRejectsThePolicyCheckpoint() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val out = run("press go", dev, ScriptedModel("""{"do":"tap","target":0}"""),
            journal = FakeJournal().apply { reject = "policy_check" })
        assertEquals("task_journal_rejected", out.error)
        assertTrue(dev.actions.isEmpty())
    }

    // ── JARVIS's own screen ──

    @Test fun neverActsOnJarvisItselfButMayLeaveIt() {
        val self = screen(node(5, "STOP"), app = "com.jarvis.app")
        val target = screen(node(0, "About phone"), app = "com.android.settings")
        val dev = FakeDevice(listOf(self, self, target, target))
        val out = runBlocking {
            OperatorLoop(
                dev,
                ScriptedModel(
                    """{"do":"tap","target":5}""",
                    """{"do":"open_app","name":"Settings"}""",
                    """{"do":"tap","target":0}""",
                    """{"do":"done","summary":"Opened About phone."}""",
                ),
                FakeJournal(),
                OperatorOptions(taskId = "t", goal = "open about phone", plan = false, sleep = {}, selfPackage = "com.jarvis.app"),
                ScriptedModel(pass),
            ).run()
        }
        assertEquals(listOf("openApp:Settings", "tap:0"), dev.actions)
        assertTrue(out.steps[0].contains("JARVIS's own screen"))
        assertTrue(out.summary, out.ok)
    }

    // ── Stale observations ──

    @Test fun aStaleTapIsRetriedOnceOnAFreshObservationOfTheSameControl() {
        // The control moved from index 0 to index 2 between observations (a banner
        // appeared above it); its selector is what proves it's the same control.
        val first = screen(node(0, "Go", selector = "go"))
        val fresh = screen(node(0, "Banner", selector = "banner"), node(1, "x", selector = "x"), node(2, "Go", selector = "go"), gen = 9)
        val dev = FakeDevice(listOf(first, fresh, fresh)).apply { tapFailures += "stale_observation" }
        val out = run("press go", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed."}"""))
        assertTrue(out.summary, out.ok)
        assertEquals(listOf("tapFailed:0:stale_observation", "tap:2"), dev.actions)
        assertEquals(9L, dev.targets.single().generation)
        assertTrue(out.steps.any { it.contains("re-observed once") })
    }

    @Test fun aStaleTapIsNotRetriedWhenTheControlIsGone() {
        val first = screen(node(0, "Go", selector = "go"))
        val fresh = screen(node(0, "Other", selector = "other"), gen = 9)
        val dev = FakeDevice(listOf(first, fresh)).apply { tapFailures += "stale_observation" }
        run("press go", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"fail","summary":"gone"}"""))
        assertEquals(listOf("tapFailed:0:stale_observation"), dev.actions)
    }

    @Test fun thePlanRidesOnTheFirstCommandWithoutAnExtraModelCall() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val m = ScriptedModel("""{"do":"tap","target":0,"plan":["Tap Go","Check it went"]}""", """{"do":"done","summary":"Went."}""")
        val out = run("press go", dev, m, plan = true)
        assertTrue(out.summary, out.ok)
        assertEquals(2, m.prompts.size) // no separate planning call
        assertTrue(m.prompts[0].contains("FIRST STEP"))
        assertFalse(m.prompts[1].contains("FIRST STEP"))
        assertTrue(m.prompts[1].contains("1. Tap Go") && m.prompts[1].contains("2. Check it went"))
        assertEquals(listOf("tap:0"), dev.actions)
    }

    // ── Speed: steps that need no model call ──

    @Test fun theAppTheGoalNamesOpensWithoutAModelCall() {
        val self = screen(app = "com.jarvis.app")
        val clock = screen(*(0 until 12).map { node(it, "Tab $it") }.toTypedArray(), app = "com.clock")
        val dev = FakeDevice(listOf(self, clock, clock)).apply { namedApp = "Clock" }
        val m = ScriptedModel("""{"do":"tap","target":3,"plan":["Open Stopwatch","Start"]}""", """{"do":"done","summary":"Started."}""")
        val out = runBlocking {
            OperatorLoop(dev, m, FakeJournal(),
                OperatorOptions(taskId = "t", goal = "open the Clock app and start the stopwatch", sleep = {}, selfPackage = "com.jarvis.app"),
                ScriptedModel(pass)).run()
        }
        assertTrue(out.summary, out.ok)
        assertEquals(listOf("openApp:Clock", "tap:3"), dev.actions)
        assertEquals(2, m.prompts.size) // no call spent deciding open_app on JARVIS's own screen
        assertTrue(m.prompts[0].contains("FIRST STEP")) // the plan is asked on the app's screen instead
    }

    @Test fun aChainedFollowUpRunsWithoutAModelCall() {
        val field = node(4, "", role = "EditText", editable = true, selector = "search")
        val before = screen(node(0, "Settings"), field)
        val after = screen(node(0, "Settings"), node(1, "Suggestion"), field.copy(index = 2, text = "alarms", focused = true), gen = 8)
        val dev = FakeDevice(listOf(before, after, after))
        val m = ScriptedModel(
            """{"do":"set_text","target":4,"text":"alarms","then":{"do":"enter","target":4}}""",
            """{"do":"done","summary":"Searched."}""",
        )
        val out = run("search settings for alarms", dev, m)
        assertTrue(out.summary, out.ok)
        assertEquals(listOf("setText:4:alarms", "enter:2"), dev.actions) // re-aimed by selector: 4 → 2
        assertEquals(2, m.prompts.size)
    }

    @Test fun aChainedFollowUpIsDroppedWhenItsControlIsGone() {
        val before = screen(node(0, "Next", selector = "next"), node(1, "", role = "EditText", editable = true, selector = "name"))
        val after = screen(node(0, "Other page", selector = "other"), gen = 8)
        val dev = FakeDevice(listOf(before, after, after))
        val m = ScriptedModel("""{"do":"tap","target":0,"then":{"do":"set_text","target":1,"text":"Bob"}}""", """{"do":"fail","summary":"x"}""")
        val out = run("press next then type the name", dev, m)
        assertEquals(listOf("tap:0"), dev.actions)
        assertTrue(out.steps.any { it.contains("chained set_text skipped") })
    }

    @Test fun aChainedEnterFallsBackToTheFocusedFieldWhenTypingChangedItsIdentity() {
        // Spotify's search box has no resource id, so its selector includes its text.
        val before = screen(node(5, "Search", role = "EditText", editable = true, selector = "box-empty"))
        val after = screen(node(5, "back in black", role = "EditText", editable = true, focused = true, selector = "box-typed"),
            node(6, "Back In Black · AC/DC"), gen = 8)
        val dev = FakeDevice(listOf(before, after, after))
        val m = ScriptedModel("""{"do":"set_text","target":5,"text":"back in black","then":{"do":"enter","target":5}}""",
            """{"do":"done","summary":"Searched."}""")
        run("search back in black", dev, m)
        assertEquals(listOf("setText:5:back in black", "enter:5"), dev.actions)
    }

    @Test fun tapsAndCoordinatesAreNeverChained() {
        // A tap changes state; the same control can then mean something else (Stop → Resume).
        for (then in listOf("""{"do":"tap","target":1}""", """{"do":"tap_point","x":5,"y":5,"label":"x"}""")) {
            val dev = FakeDevice(listOf(screen(node(0, "Stop"), node(1, "Lap")), screen(node(0, "Resume"), node(1, "Reset"), gen = 8)))
            val m = ScriptedModel("""{"do":"tap","target":0,"then":$then}""", """{"do":"fail","summary":"x"}""")
            run("stop and reset", dev, m)
            assertEquals(listOf("tap:0"), dev.actions)
            assertEquals(2, m.prompts.size)
        }
    }

    @Test fun aSplashScreenAfterALaunchIsLookedAtAgainNotAskedAbout() {
        val splash = screen(node(0, "Spotify"), app = "com.spotify")
        val home = screen(*(0 until 12).map { node(it, "Row $it") }.toTypedArray(), app = "com.spotify", gen = 9)
        val dev = FakeDevice(listOf(screen(node(0, "Home"), app = "launcher"), splash, splash, home))
        val sleeps = mutableListOf<Long>()
        val m = ScriptedModel("""{"do":"open_app","name":"Spotify"}""", """{"do":"fail","summary":"x"}""")
        runBlocking {
            OperatorLoop(dev, m, FakeJournal(),
                OperatorOptions(taskId = "t", goal = "open spotify", plan = false, sleep = { sleeps += it }), ScriptedModel(pass)).run()
        }
        assertEquals(listOf(OperatorLoop.LAUNCH_SPARSE_WAIT_MS, OperatorLoop.LAUNCH_SPARSE_WAIT_MS), sleeps)
        assertTrue(m.prompts[1].contains("Row 11")) // the model saw the loaded screen, not the splash
    }

    @Test fun unlabelledControlsGetAScreenshotOnFirstLookAndAfterBeingTapped() {
        // Samsung Clock: Start is a bare #stopwatch_startButton; its state is only in pixels.
        val screens = (0..5).map { g ->
            screen(node(0, "", selector = "start"), *(1..11).map { node(it, "Row $it $g") }.toTypedArray(), app = "com.clock", gen = g.toLong())
        }
        val dev = FakeDevice(screens).apply { shot = "SHOT" }
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"tap","target":1}""", """{"do":"done","summary":"ok"}""")
            .apply { vision = true }
        run("start the stopwatch", dev, m)
        // first look at an app with a hidden control · right after tapping it · after a labelled tap: none
        assertEquals(listOf(1, 1, 0), m.imageCounts)
        assertEquals(1, unlabelledControls(screens[0]).size)
    }

    @Test fun aButtonWhoseWordsAreInAChildViewIsListedWithThem() {
        // Samsung Clock: a bare clickable #stopwatch_startButton, and its "Stop" text as a child.
        val button = OpNode(10, "", "View", id = "x:id/stopwatch_startButton", clickable = true, bounds = OpBounds(696, 1774, 276, 276))
        val word = OpNode(11, "Stop", "TextView", bounds = OpBounds(782, 1880, 105, 64))
        val icon = OpNode(12, "", "ImageButton", clickable = true, bounds = OpBounds(0, 0, 100, 100))
        val s = screen(button, word, icon)
        val r = renderObs(s)
        assertTrue(r, r.lines().first { it.startsWith("[10]") }.contains("\"Stop\" (inside)"))
        assertTrue(r.lines().first { it.startsWith("[12]") }.contains("(no text)"))
        assertEquals(listOf(12), unlabelledControls(s).map { it.index })
    }

    @Test fun setTextOnASearchButtonOpensTheFieldAndTypes() {
        // Samsung Settings: "Search" is a button that opens a separate search page.
        val home = screen(node(0, "Connections"), node(1, "Search"))
        val searchPage = screen(node(0, "", role = "EditText", editable = true, focused = true, selector = "q"), app = "com.search", gen = 9)
        val dev = FakeDevice(listOf(home, home, searchPage, searchPage))
        val m = ScriptedModel("""{"do":"set_text","target":1,"text":"dark mode","then":{"do":"enter"}}""", """{"do":"done","summary":"Searched."}""")
        val out = run("search settings for dark mode", dev, m)
        assertTrue(out.summary, out.ok)
        assertEquals(listOf("tap:1", "setText:0:dark mode", "enter:0"), dev.actions)
        assertTrue(opensSearch(node(0, "", desc = "Search settings"), home))
        assertFalse(opensSearch(node(0, "Send"), home))
        assertFalse(opensSearch(node(0, "Research papers"), home))
    }

    @Test fun theStepLogNamesWhatWasTappedAndTyped() {
        val start = OpNode(10, "", "View", clickable = true, selector = "b", windowId = 3, bounds = OpBounds(0, 0, 300, 300))
        val word = OpNode(11, "Start", "TextView", selector = "w", windowId = 3, bounds = OpBounds(50, 50, 100, 50))
        val field = node(12, "", role = "EditText", editable = true)
        val dev = FakeDevice(listOf(screen(start, word, field), screen(start, word.copy(text = "Stop"), field, gen = 8)))
        val m = ScriptedModel("""{"do":"tap","target":10}""", """{"do":"set_text","target":12,"text":"lap one"}""", """{"do":"fail","summary":"x"}""")
        val out = run("start it", dev, m)
        assertTrue(out.steps[0], out.steps[0].startsWith("tap[10] \"Start\" — ok"))
        assertTrue(out.steps[1], out.steps[1].contains("← \"lap one\""))
    }

    @Test fun renderDropsTheIdsPackagePrefix() {
        val r = renderObs(screen(OpNode(0, "", "Button", id = "com.sec.android.app.clockpackage:id/stopwatch_startButton", clickable = true)))
        assertTrue(r, r.contains("#stopwatch_startButton") && !r.contains("clockpackage"))
    }

    @Test fun theCheckerSkipsTheScreenshotWhenTheListIsRich() {
        val rich = screen(*(0 until 12).map { node(it, "Row $it") }.toTypedArray())
        val dev = FakeDevice(listOf(rich)).apply { shot = "SHOT" }
        val verifier = ScriptedModel(pass).apply { vision = true }
        assertTrue(run("tap row", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"ok"}"""), verifier = verifier).ok)
        assertEquals(listOf(0), verifier.imageCounts)
    }

    // ── Completion checking ──

    @Test fun aSecondRejectionWithNothingDoneInBetweenEndsHonestly() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed."}""", """{"do":"done","summary":"Pressed."}""")
        val out = run("press go", dev, m,
            verifier = ScriptedModel("""{"verdict":"fail","reason":"no sign of it"}""", """{"verdict":"fail","reason":"still no sign"}"""))
        assertFalse(out.ok)
        assertEquals("unverified", out.error)
        assertTrue(out.summary, out.summary.contains("Pressed.") && out.summary.contains("still no sign"))
        assertEquals(3, m.prompts.size) // stopped, instead of burning steps re-claiming
    }

    @Test fun anUnfinishedSoundingDoneGoesBackToWorkInsteadOfEnding() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val verifier = ScriptedModel(pass)
        val out = run("press go", dev,
            ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"I will wait for it to load"}""",
                """{"do":"tap","target":0}""", """{"do":"done"}"""),
            verifier = verifier)
        assertTrue(out.summary, out.ok)
        assertEquals(1, verifier.prompts.size) // the unfinished claim never reached the checker
    }

    @Test fun aStuckTaskWhoseGoalIsAlreadyMetSucceeds() {
        // The Spotify case: the song is playing, the operator doesn't see it and keeps
        // tapping — the screen never changes. Before giving up, the checker looks.
        val dev = FakeDevice(listOf(screen(node(0, "Pause", role = "ImageButton"))))
        val out = run("play the song", dev, ScriptedModel(*Array(4) { """{"do":"tap","target":0}""" }),
            verifier = ScriptedModel("""{"verdict":"pass","summary":"The song is playing."}"""))
        assertTrue(out.summary, out.ok)
        assertEquals("The song is playing.", out.summary)
        assertTrue(OperatorLoop.VERIFICATION_RECEIPT_RE.matches(out.verificationReceipt))
    }

    @Test fun aPlaybackGoalWithNothingPlayingIsNeverPassed() {
        // Live 2026-09-25: the checker passed off Spotify's paused mini-player title.
        val dev = FakeDevice(listOf(screen(node(0, "Back In Black")))).apply { audio = false }
        val verifier = ScriptedModel(pass, pass)
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Playing."}""",
            """{"do":"done","summary":"Playing."}""")
        val out = run("open Spotify and play Back in Black by AC/DC", dev, m, verifier = verifier)
        assertFalse(out.ok)
        assertTrue(out.summary, out.summary.contains("nothing is playing"))
        assertEquals(0, verifier.prompts.size) // ground truth decided it; no model call spent
        assertTrue(m.prompts[1].contains("AUDIO: nothing audible yet"))
    }

    @Test fun audioPlayingReachesTheCheckerAndTheExecutor() {
        val dev = FakeDevice(listOf(screen(node(0, "Play")))).apply { audio = true }
        val verifier = ScriptedModel(pass)
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Playing."}""")
        assertTrue(run("play some jazz on Spotify", dev, m, verifier = verifier).ok)
        assertTrue(verifier.prompts[0].contains("\"audio_playing_now\":true"))
        assertTrue(m.prompts[1].contains("AUDIO: something IS playing"))
        assertTrue(wantsPlayback("resume my podcast"))
        assertFalse(wantsPlayback("open the Play Store"))
        assertFalse(wantsPlayback("play a chess game"))
    }

    @Test fun aStuckTaskStillFailsWhenTheCheckerSaysNo() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val out = run("press go", dev, ScriptedModel(*Array(4) { """{"do":"tap","target":0}""" }),
            verifier = ScriptedModel("""{"verdict":"fail","reason":"nope"}"""))
        assertFalse(out.ok)
        assertEquals("incomplete", out.error)
        assertEquals("", out.verificationReceipt)
    }

    @Test fun theCheckerSeesAFreshScreenAScreenshotAndTheNotedFacts() {
        val before = screen(node(0, "Loading"))
        val after = screen(node(0, "Android version 16"), gen = 9)
        val dev = FakeDevice(listOf(before, before, after)).apply { shot = "SHOT" }
        val verifier = ScriptedModel(pass).apply { vision = true }
        val out = run("find the android version", dev,
            ScriptedModel("""{"do":"tap","target":0}""", """{"do":"note","text":"build 16.0"}""", """{"do":"done","summary":"Android 16."}"""),
            verifier = verifier)
        assertTrue(out.summary, out.ok)
        assertTrue(verifier.prompts[0].contains("Android version 16"))
        assertTrue(verifier.prompts[0].contains("build 16.0"))
        assertEquals(listOf(1), verifier.imageCounts)
    }

    @Test fun parseVerdictAcceptsHowModelsActuallyAnswer() {
        assertEquals(true, parseVerdict("""{"verdict":"PASS"}""")?.pass)
        assertEquals(true, parseVerdict("```json\n{\"result\":\"passed\",\"summary\":\"Timer running.\"}\n```")?.pass)
        assertEquals("Timer running.", parseVerdict("""{"result":"passed","summary":"Timer running."}""")?.text)
        assertEquals(true, parseVerdict("""{"pass":true}""")?.pass)
        assertEquals(false, parseVerdict("""{"success":false,"reason":"x"}""")?.pass)
        assertEquals("no timer", parseVerdict("""{"verdict":"Fail","reason":"no timer"}""")?.text)
        assertEquals(true, parseVerdict("PASS.")?.pass)
        assertEquals(null, parseVerdict("sure, looks fine"))
        assertEquals(null, parseVerdict("""{"verdict":"maybe"}"""))
    }

    // ── Vision ──

    @Test fun lookAttachesAScreenshotToTheNextStepOnly() {
        val screens = (0..5).map { g -> screen(*(0 until 12).map { node(it, "Row $it $g") }.toTypedArray(), gen = g.toLong()) }
        val dev = FakeDevice(screens).apply { shot = "SHOT" }
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"look"}""", """{"do":"tap","target":1}""",
            """{"do":"done","summary":"ok"}""").apply { vision = true }
        run("tap rows", dev, m)
        // a rich list needs no picture · none · after `look` · none again
        assertEquals(listOf(0, 0, 1, 0), m.imageCounts)
        assertTrue(m.prompts[1].contains("SCREENSHOT: none"))
        assertTrue(m.prompts[2].contains("SCREENSHOT: attached"))
    }

    // ── Policy ──

    @Test fun unlabelledCoordinatesNeedApproval() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val out = run("open the menu", dev, ScriptedModel("""{"do":"tap_xy","x":5,"y":5}"""))
        assertTrue(out.needsApproval)
        assertTrue(dev.actions.isEmpty())
    }

    @Test fun labelledPixelTapsAndDragsRunInALowRiskTask() {
        val dev = FakeDevice(listOf(screen(node(0, "Keypad"), node(1, "Brightness"))))
        val out = run(
            "set a 5 minute timer", dev,
            ScriptedModel(
                """{"do":"tap_xy","x":150,"y":40,"label":"key 5"}""",
                """{"do":"drag","from_x":10,"from_y":150,"to_x":180,"to_y":150,"label":"brightness slider"}""",
                """{"do":"done","summary":"Set."}""",
            ),
        )
        assertEquals(listOf("tapXY:150,40", "drag:10,150->180,150"), dev.actions)
        assertTrue(out.summary, out.ok)
    }

    @Test fun pixelCommandsAreRefusedOnAStepThatHadAScreenshot() {
        // Live 2026-09-25: looking at a screenshot, the model sent tap_xy (500,940) meaning
        // thousandths; as pixels it hit Settings' Samsung-account row.
        val dev = FakeDevice(listOf(screen(node(0, "Settings")).copy(screenW = 1080, screenH = 2340))).apply { shot = "SHOT" }
        val m = ScriptedModel(
            """{"do":"tap_xy","x":500,"y":940,"label":"search bar"}""",
            """{"do":"tap_point","x":500,"y":40,"label":"search bar"}""",
            """{"do":"done","summary":"Searched."}""",
        ).apply { vision = true }
        val out = run("search settings", dev, m)
        assertEquals(listOf("tapXY:540,93"), dev.actions)
        assertTrue(out.steps[0], out.steps[0].contains("refused while a screenshot is attached"))
    }

    @Test fun pixelTapsAreRefusedOnRiskyTargetsAndInSideEffectTasks() {
        val s = screen(node(0, "Pay now"), node(1, "Photo"))
        fun c(json: String) = parseCommand(json)!!
        assertEquals("R3", classifyAction("open photos", c("""{"do":"tap_xy","x":50,"y":40,"label":"banner"}"""), s).risk)
        assertEquals("R1", classifyAction("open photos", c("""{"do":"tap_xy","x":50,"y":140,"label":"photo"}"""), s).risk)
        val galaxy = screen(node(0, "Sign in to your Galaxy"))
        assertEquals("R3", classifyAction("search settings", c("""{"do":"tap_point","x":50,"y":20,"label":"search bar"}"""),
            galaxy.copy(screenW = 1080, screenH = 2340)).risk) // lands on a sign-in card
        assertEquals("R2", classifyAction("message mom", c("""{"do":"tap_xy","x":50,"y":140,"label":"photo"}"""), s).risk)
        assertEquals(null, coordPoints(c("""{"do":"tap_xy","x":5000,"y":40}"""), s)) // off screen
        val dev = FakeDevice(listOf(s))
        val out = run("message mom hi", dev, ScriptedModel("""{"do":"tap_xy","x":50,"y":140,"label":"photo"}"""))
        assertTrue(out.needsApproval)
        assertTrue(dev.actions.isEmpty())
    }

    @Test fun enterSubmitsTheFieldAndNeedsConsentWhereItCouldSend() {
        val field = node(0, "", role = "EditText", editable = true, focused = true)
        val dev = FakeDevice(listOf(screen(field), screen(field.copy(text = "alarms"), gen = 8)))
        val out = run("search settings for alarms", dev,
            ScriptedModel("""{"do":"set_text","target":0,"text":"alarms"}""", """{"do":"enter","target":0}""", """{"do":"done","summary":"Searched."}"""))
        assertEquals(listOf("setText:0:alarms", "enter:0"), dev.actions)
        assertTrue(out.summary, out.ok)
        assertEquals("R2", classifyAction("draft a message to mom, don't send it", parseCommand("""{"do":"enter"}""")!!, screen(field)).risk)
    }

    @Test fun anExternalCommitPausesWithoutUpFrontConsent() {
        val dev = FakeDevice(listOf(screen(node(0, "Send"))))
        val out = run("tell mom I'm late on WhatsApp", dev, ScriptedModel("""{"do":"tap","target":0}"""))
        assertTrue(out.needsApproval)
        assertEquals("approval_required", out.error)
        assertTrue(dev.actions.isEmpty())
    }

    @Test fun upFrontConsentCoversR2ButNeverR3() {
        val dev = FakeDevice(listOf(screen(node(0, "Send"))))
        run("message mom I'm late", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Sent."}"""),
            preAuthorizedR2 = true)
        assertEquals(listOf("tap:0"), dev.actions)

        val pay = FakeDevice(listOf(screen(node(0, "Pay now"))))
        val out = run("pay the electricity bill", pay, ScriptedModel("""{"do":"tap","target":0}"""), preAuthorizedR2 = true)
        assertTrue(out.needsApproval)
        assertTrue(out.summary.startsWith("R3"))
        assertTrue(pay.actions.isEmpty())
    }

    @Test fun draftingAndNavigationStayBelowTheApprovalBoundary() {
        val obs = screen(node(0, "Done"), node(1, "Back"))
        fun cmd(s: String) = parseCommand(s)!!
        assertEquals("R1", classifyAction("draft a message to mom, don't send it", cmd("""{"do":"tap","target":0}"""), obs).risk)
        assertEquals("R0", classifyAction("message mom", cmd("""{"do":"back"}"""), obs).risk)
        assertEquals("R2", classifyAction("message mom", cmd("""{"do":"tap","target":0}"""), obs).risk)
    }

    @Test fun classifyGoalRiskMatchesTheTsClassifier() {
        assertEquals("R2", classifyGoalRisk("message Rahul that I'm running late"))
        assertEquals("R3", classifyGoalRisk("pay my phone bill"))
        assertEquals("R3", classifyGoalRisk("change my password"))
        assertEquals("R3", classifyGoalRisk("sign in to my Samsung account"))
        assertEquals("R1", classifyGoalRisk("set a timer for 2 minutes"))
        assertEquals("R1", classifyGoalRisk("draft an email to my boss but don't send it"))
    }

    // ── STOP ──

    @Test fun stopsBeforeTheNextStepWithoutActing() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val out = run("press go", dev, ScriptedModel("""{"do":"tap","target":0}"""),
            journal = FakeJournal().apply { stopped = true })
        assertEquals("cancelled", out.error)
        assertTrue(dev.actions.isEmpty())
    }

    // ── Guards ──

    @Test fun refusesToTypeTheSameMessageTwice() {
        val dev = FakeDevice(listOf(screen(node(0, "", role = "EditText", editable = true)), screen(node(0, "x", role = "EditText", editable = true))))
        val out = run("message mom hello there", dev,
            ScriptedModel("""{"do":"set_text","target":0,"text":"hello there"}""", """{"do":"set_text","target":0,"text":"hello there"}"""))
        assertEquals(1, dev.actions.size)
        assertTrue(out.summary.contains("already entered"))
    }

    @Test fun typingAtAPlaceholderGoesIntoTheFieldAroundIt() {
        // Spotify's search box: a text-less EditText with its placeholder as a separate node inside it.
        val field = OpNode(0, "", "EditText", clickable = true, editable = true, selector = "f", windowId = 3,
            bounds = OpBounds(135, 81, 900, 135))
        val hint = OpNode(1, "What do you want to listen to?", "TextView", selector = "h", windowId = 3,
            bounds = OpBounds(172, 117, 621, 62))
        val outside = OpNode(2, "Play what you love", "TextView", selector = "o", windowId = 3,
            bounds = OpBounds(310, 1182, 461, 67))
        val s = screen(field, hint, outside)
        assertEquals(0, fieldFor(hint, s).index)
        assertEquals(2, fieldFor(outside, s).index) // not inside a field: left alone (and still refused)
        val dev = FakeDevice(listOf(s, screen(field.copy(text = "back in black"), hint, outside, gen = 8)))
        run("search back in black", dev, ScriptedModel("""{"do":"set_text","target":1,"text":"back in black"}"""))
        assertEquals("setText:0:back in black", dev.actions.first())
    }

    // ── tap_point: apps that hide their UI from accessibility (Spotify's Search page) ──

    private fun spotifySearch(gen: Long = 7) = OpObservation(
        "com.spotify.music",
        listOf(
            OpNode(0, "", "View", clickable = true, selector = "t1", windowId = 3, bounds = OpBounds(0, 2163, 270, 135)),
            OpNode(1, "Search, Tab 2 of 4", "View", selector = "t2", windowId = 3, bounds = OpBounds(270, 2163, 270, 135)),
            OpNode(2, "Pay now", "Button", clickable = true, selector = "pay", windowId = 3, bounds = OpBounds(0, 1500, 1080, 150)),
        ),
        generation = gen, windowId = 3, screenW = 1080, screenH = 2340,
    )

    private fun point(x: Int, y: Int, label: String) =
        org.json.JSONObject("""{"do":"tap_point","x":$x,"y":$y,"label":"$label"}""")

    @Test fun tapPointConvertsThousandthsToScreenPixels() {
        assertEquals(540 to 234, pointPx(point(500, 100, "search bar"), spotifySearch()))
        assertEquals(null, pointPx(point(1200, 100, "x"), spotifySearch()))
        assertEquals(null, pointPx(point(500, 100, "x"), OpObservation("a", emptyList()))) // screen size unknown
    }

    @Test fun tapPointIsLowRiskOnlyForANamedHarmlessTargetInAHarmlessTask() {
        val s = spotifySearch()
        val play = "open Spotify and play Back in Black by AC/DC"
        assertEquals("R1", classifyAction(play, point(500, 50, "search bar"), s).risk)
        assertEquals("R2", classifyAction(play, point(500, 50, ""), s).risk)            // unnamed
        assertEquals("R2", classifyAction(play, point(500, 50, "Send button"), s).risk) // risky label
        assertEquals("R3", classifyAction(play, point(500, 50, "Buy premium"), s).risk)
        assertEquals("R3", classifyAction(play, point(500, 673, "banner"), s).risk)     // lands on "Pay now"
        assertEquals("R2", classifyAction("message mom on whatsapp", point(500, 50, "search bar"), s).risk)
    }

    @Test fun tapPointTapsTheConvertedSpotWithoutApproval() {
        val dev = FakeDevice(listOf(spotifySearch(), spotifySearch(8), spotifySearch(9)))
        run("open Spotify and play Back in Black by AC/DC", dev,
            ScriptedModel("""{"do":"tap_point","x":500,"y":50,"label":"search bar"}"""))
        assertEquals("tapXY:540,117", dev.actions.first())
    }

    @Test fun catchesACycle() {
        val a = screen(node(0, "A"), node(1, "B"))
        val b = screen(node(0, "A"), node(1, "B"), gen = 8)
        val dev = FakeDevice(listOf(a, b, a, b, a, b, a, b, a))
        val m = ScriptedModel(*Array(8) { if (it % 2 == 0) """{"do":"tap","target":0}""" else """{"do":"tap","target":1}""" })
        val out = run("toggle", dev, m, verifier = ScriptedModel("""{"verdict":"fail","reason":"nothing toggled"}"""))
        assertTrue(out.summary.contains("going in circles"))
    }

    @Test fun scrollingALongListIsNotACycle() {
        val dev = FakeDevice((0..6).map { screen(node(0, "Row $it")) })
        val m = ScriptedModel(*Array(5) { """{"do":"scroll","direction":"down"}""" }, """{"do":"done","summary":"Found it."}""")
        val out = run("find storage", dev, m)
        assertEquals(5, dev.actions.count { it == "scroll:down" })
        assertTrue(out.summary, out.ok)
    }

    @Test fun rateLimitAfterActingSaysWhatWasDone() {
        val dev = FakeDevice(listOf(screen(node(0, "Send"))))
        val model = object : OperatorModelClient {
            override val wantsImages = false
            var n = 0
            override suspend fun next(system: String, user: String, images: List<String>, timeoutMs: Long): String =
                if (n++ == 0) """{"do":"tap","target":0}""" else throw ModelException("spent", rateLimited = true)
        }
        val out = run("message mom hi", dev, model, preAuthorizedR2 = true)
        assertFalse(out.ok)
        assertTrue(out.summary, out.summary.contains("check the screen"))
        assertTrue(out.summary.contains("tap[0]"))
    }

    // ── Findings / ask / planner / focus / launch / budget ──

    @Test fun findingsPersistAndComeBackOnFailure() {
        val m = ScriptedModel("""{"do":"note","text":"Store A: 5"}""", """{"do":"note","text":"Store B: 7"}""",
            """{"do":"fail","summary":"couldn't reach store C"}""")
        val out = run("compare prices", FakeDevice(listOf(screen(node(0, "x")))), m)
        assertTrue(m.prompts[1].contains("Store A: 5"))
        assertFalse(out.ok)
    }

    @Test fun anAskIsSkippedAndTheTaskCarriesOn() {
        val dev = FakeDevice(listOf(screen(node(0, "Go"))))
        val m = ScriptedModel("""{"do":"ask","question":"Which one?"}""", """{"do":"tap","target":0}""", """{"do":"done","summary":"Went."}""")
        val out = run("press go", dev, m)
        assertTrue(out.ok)
        assertTrue(m.prompts[1].contains("no one to ask"))
    }

    @Test fun planFromAcceptsAListOrLines() {
        assertEquals("1. Open Clock\n2. Start", planFrom(org.json.JSONObject("""{"do":"x","plan":["Open Clock","Start"]}""")))
        assertEquals("1. Open Clock\n2. Start", planFrom(org.json.JSONObject("{\"do\":\"x\",\"plan\":\"1. Open Clock\\n2) Start\"}")))
        assertEquals("", planFrom(org.json.JSONObject("""{"do":"x"}""")))
    }

    @Test fun focusRefusesANonField_andTypeNeedsAFocusedField() {
        val dev = FakeDevice(listOf(screen(node(0, "Label", clickable = false))))
        val m = ScriptedModel("""{"do":"focus","target":0}""", """{"do":"type","text":"hi"}""", """{"do":"fail","summary":"no field"}""")
        val out = run("type hi", dev, m)
        assertTrue(out.steps[0].contains("isn't a text field"))
        assertTrue(out.steps[1].contains("No editable field is focused"))
        assertTrue(dev.actions.isEmpty())
    }

    @Test fun saysSoWhenALaunchedAppNeverReachesTheForeground() {
        val dev = FakeDevice(listOf(screen(node(0, "Home"), app = "launcher")))
        val out = run("open clock", dev, ScriptedModel("""{"do":"open_app","name":"Clock"}""", """{"do":"fail","summary":"stuck"}"""))
        assertTrue(out.steps.any { it.contains("not in the foreground yet") })
    }

    @Test fun aProgressingTaskRunsPastTheSoftStepBudget() {
        // 4 distinct taps with a soft budget of 3. Each screen genuinely differs, or the
        // no-progress guard stops the task before the budget is the thing under test.
        val screens = (0..4).map { s -> screen(*(0..3).map { i -> node(i, "Item $i${if (i == s) " (done)" else ""}") }.toTypedArray()) }
        val dev = FakeDevice(screens)
        val replies = (0..3).map { """{"do":"tap","target":$it}""" } + """{"do":"done","summary":"All four tapped."}"""
        val out = run("tap all four", dev, ScriptedModel(*replies.toTypedArray()), maxSteps = 3)
        assertTrue(out.summary, out.ok)
        assertEquals(4, dev.actions.count { it.startsWith("tap:") })
        assertTrue(out.steps.any { it.contains("extended to") })
    }

    // ── Rendering ──

    @Test fun renderNeverSendsSelectorsAndShowsIconDescriptionsAndRealToggles() {
        val obs = screen(
            node(0, "", desc = "Send", selector = "SECRETSEL"),
            node(1, "Wi-Fi", role = "Switch", checked = true),
            node(2, "Plain text", clickable = false),
        )
        val r = renderObs(obs)
        assertFalse(r.contains("SECRETSEL"))
        assertTrue(r.contains("\"Send\" (desc)"))
        assertTrue(r.contains("checked"))
        assertFalse(r.lines().first { it.startsWith("[2]") }.contains("unchecked"))
    }

    @Test fun rankingRescuesATargetBuriedPastTheCapWithoutChangingIndices() {
        val inert = (0 until 100).map { OpNode(it, "", "View") }
        val target = OpNode(100, "Send", "Button", clickable = true, bounds = OpBounds(0, 0, 10, 10))
        val ranked = rankNodes(inert + target)
        assertEquals(100, ranked.first().index)
        assertTrue(renderObs(OpObservation("a", inert + target)).contains("[100] Button"))
    }

    @Test fun aFullScreenStaysWithinAPerStepBudget() {
        val nodes = (0 until 80).map { OpNode(it, "Item number $it", "TextView", id = "com.app:id/row", clickable = true,
            selector = "x".repeat(16), bounds = OpBounds(0, it * 30, 1080, 30)) }
        val r = renderObs(OpObservation("com.app", nodes))
        assertTrue("render is ${r.length} chars", r.length < 7_000)
    }

    @Test fun parseCommandHandlesFencesAndRejectsJunk() {
        assertEquals("tap", parseCommand("```json\n{\"do\":\"tap\",\"target\":2}\n```")!!.getString("do"))
        assertEquals(null, parseCommand("I think we should tap"))
        assertEquals(null, parseCommand("{\"target\":2}"))
        assertNotNull(parseCommand("sure: {\"do\":\"type\",\"text\":\"a } b\"} ok"))
        assertEquals(null, asIndex(""))
        assertEquals(3, asIndex("3"))
    }
}

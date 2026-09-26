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
        override suspend fun quickSettings() = rec("quickSettings")
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
        // Bound to the control, not the generation: a live screen (a running stopwatch) moves
        // the generation on before any action lands — "Stop" went stale six times live.
        assertEquals(-1L, dev.targets.single().generation)
        assertEquals("go", dev.targets.single().selector)
        assertTrue(out.steps.any { it.contains("re-observed") })
    }

    @Test fun aStaleTapIsNotRetriedOnceItsWordsChanged() {
        // Same button, new meaning (Start became Stop): the model decided about another state.
        val first = screen(node(0, "Start", selector = "btn"))
        val fresh = screen(node(0, "Stop", selector = "btn"), gen = 9)
        val dev = FakeDevice(listOf(first, fresh)).apply { tapFailures += "stale_observation" }
        run("start the stopwatch", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"fail","summary":"x"}"""))
        assertEquals(listOf("tapFailed:0:stale_observation"), dev.actions)
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

    @Test fun aSearchTabThatOpensASearchBarButtonIsFollowedThrough() {
        // Play Store: the "Search" tab opens a page whose "Search apps & games" bar is a button.
        val home = screen(node(0, "Games"), node(1, "Search", selector = "tab"))
        val searchPage = screen(node(0, "Search apps & games", selector = "bar"), node(1, "Search", selector = "tab"), gen = 8)
        val field = screen(node(0, "", role = "EditText", editable = true, focused = true, selector = "q"), gen = 9)
        val dev = FakeDevice(listOf(home, home, searchPage, searchPage, searchPage, searchPage, field, field, field))
        val m = ScriptedModel("""{"do":"set_text","target":1,"text":"Duolingo"}""", """{"do":"done","summary":"Searched."}""")
        val out = run("search the play store for duolingo", dev, m)
        assertTrue(out.summary, out.ok)
        assertEquals(listOf("tap:1", "tap:0", "setText:0:Duolingo"), dev.actions)
    }

    @Test fun enterAimedAtANonFieldPressesEnterInTheFocusedField() {
        val field = node(0, "duolingo", role = "EditText", editable = true, focused = true)
        val dev = FakeDevice(listOf(screen(field, node(61, "Enter"))))
        run("search", dev, ScriptedModel("""{"do":"enter","target":61}""", """{"do":"fail","summary":"x"}"""))
        assertEquals(listOf("enter:0"), dev.actions)
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

    @Test fun aRowCarriesItsTitleAndSubtitleAndTheyArentListedTwice() {
        // Samsung Settings search results: the same title under different apps.
        val row = OpNode(3, "", "LinearLayout", clickable = true, bounds = OpBounds(0, 300, 1080, 200))
        val title = OpNode(4, "Dark mode", "TextView", bounds = OpBounds(40, 320, 400, 60))
        val crumb = OpNode(5, "Calendar style", "TextView", bounds = OpBounds(40, 390, 400, 50))
        val sw = OpNode(6, "", "Switch", clickable = true, checked = false, bounds = OpBounds(900, 340, 120, 80))
        val r = renderObs(screen(row, title, crumb, sw))
        assertTrue(r, r.contains("[3] LinearLayout \"Dark mode · Calendar style\" (inside)"))
        assertFalse(r, r.lines().any { it.startsWith("[4]") || it.startsWith("[5]") })
        assertTrue(r, r.lines().any { it.startsWith("[6]") }) // controls are never folded away
        assertFalse(r, r.contains("generation="))
    }

    @Test fun aFloatingBarDrawnOverARowDoesntBorrowItsLabel() {
        // Samsung Settings: the search bar floats over the "Display" row. The hierarchy says
        // "Display" is not its child, whatever the bounds say.
        val bar = OpNode(31, "", "LinearLayout", clickable = true, bounds = OpBounds(0, 2100, 1080, 150), path = "0.2")
        val search = OpNode(32, "Search", "TextView", bounds = OpBounds(100, 2140, 200, 60), path = "0.2.0")
        val display = OpNode(20, "Display", "TextView", bounds = OpBounds(100, 2150, 300, 60), path = "0.1.7.0")
        assertEquals("Search", innerLabel(bar, screen(bar, search, display)))
    }

    @Test fun aBareRadioTakesTheLabelBesideIt() {
        // Samsung Display settings: "Light"/"Dark" texts with bare RadioButtons under them.
        val light = OpNode(1, "Light", "TextView", bounds = OpBounds(150, 600, 200, 60), path = "0.4.0.1")
        val lightRadio = OpNode(2, "", "RadioButton", checked = false, bounds = OpBounds(200, 680, 80, 80), path = "0.4.0.2")
        val dark = OpNode(3, "Dark", "TextView", bounds = OpBounds(700, 600, 200, 60), path = "0.4.1.1")
        val darkRadio = OpNode(4, "", "RadioButton", checked = true, bounds = OpBounds(750, 680, 80, 80), path = "0.4.1.2")
        val s = screen(light, lightRadio, dark, darkRadio)
        val r = renderObs(s)
        assertTrue(r, r.lines().first { it.startsWith("[4]") }.contains("\"Dark\" (beside)") && r.contains("checked"))
        assertTrue(r, r.lines().first { it.startsWith("[2]") }.contains("\"Light\" (beside)"))
        assertEquals("Dark", controlLabel(darkRadio, s))
    }

    @Test fun anOptionPickerReadsAsOneLinePerOptionWithItsState() {
        // Samsung's screen-timeout list, as captured live: a clickable list, rows of a bare
        // (non-clickable) RadioButton + a label. The list must not borrow "15 seconds".
        val list = OpNode(4, "", "RecyclerView", clickable = true, selected = true, bounds = OpBounds(28, 283, 1024, 963), path = "0.3")
        fun row(i: Int, y: Int, label: String, on: Boolean) = listOf(
            OpNode(i, "", "LinearLayout", clickable = true, bounds = OpBounds(28, y, 1024, 158), path = "0.3.$i"),
            OpNode(i + 1, "", "RadioButton", checked = on, bounds = OpBounds(73, y + 30, 129, 90), path = "0.3.$i.0"),
            OpNode(i + 2, label, "TextView", bounds = OpBounds(202, y, 800, 144), path = "0.3.$i.1"),
        )
        val nodes = listOf(list) + row(10, 283, "15 seconds", false) + row(20, 444, "5 minutes", true)
        val r = renderObs(screen(*nodes.toTypedArray()))
        assertFalse(r, r.lines().first { it.startsWith("[4]") }.contains("15 seconds"))
        assertTrue(r, r.lines().first { it.startsWith("[20]") }.contains("\"5 minutes\" (inside) (clickable,checked)"))
        assertTrue(r, r.lines().first { it.startsWith("[10]") }.contains("unchecked"))
        assertFalse(r, r.lines().any { it.startsWith("[11]") || it.startsWith("[21]") }) // radios folded in
        // A wrapper around the list doesn't borrow a neighbour's label either.
        val wrapper = OpNode(3, "", "FrameLayout", clickable = true, bounds = OpBounds(28, 283, 1024, 963), path = "0")
        val neighbour = OpNode(30, "Keep screen on while viewing", "TextView", bounds = OpBounds(28, 1300, 800, 60), path = "1.0")
        assertEquals("", nearbyLabel(wrapper, screen(*(nodes + wrapper + neighbour).toTypedArray())))
    }

    @Test fun parseCommandForgivesCommonSchemaDrift() {
        assertEquals("tap", parseCommand("""{"action":"tap","target":3}""")!!.getString("do"))
        assertEquals("done", parseCommand("""{"done":"summary","summary":"Opened it."}""")!!.getString("do"))
        val bare = parseCommand("""{"done","summary":"Back In Black is already playing."}""")!!
        assertEquals("done", bare.getString("do"))
        assertEquals("Back In Black is already playing.", bare.getString("summary"))
        assertEquals(null, parseCommand("""{"target":2}"""))
        val note = parseCommand("""{"note":"Apia, Pago Pago"}""")!!
        assertEquals("note", note.getString("do")); assertEquals("Apia, Pago Pago", note.getString("text"))
        assertEquals(5, parseCommand("""{"tap":5}""")!!.getInt("target"))
        assertEquals("Clock", parseCommand("""{"open_app":"Clock"}""")!!.getString("name"))
    }

    @Test fun twoObjectsInOneReplyBecomeACommandAndItsFollowUp() {
        // Live: {"note":"Apia, Pago Pago"} {"do":"done",…} — thrown away three times as unclear.
        val dev = FakeDevice(listOf(screen(node(0, "World clock"))))
        val m = ScriptedModel("""{"do":"tap","target":0}""",
            """{"note":"Apia, Pago Pago"} {"do":"done","summary":"The cities are Apia and Pago Pago."}""")
        val out = run("list the world clock cities", dev, m)
        assertTrue(out.summary, out.ok)
        assertEquals(2, m.prompts.size)
        assertEquals(listOf("Apia, Pago Pago"), out.findings)
    }

    @Test fun aStaleTapIsRetriedUpToThreeTimes() {
        val first = screen(node(0, "Go", selector = "go"))
        val fresh = screen(node(0, "Go", selector = "go"), gen = 9)
        val dev = FakeDevice(listOf(first, fresh, fresh, fresh, fresh)).apply {
            repeat(3) { tapFailures += "stale_observation" }
        }
        val out = run("press go", dev, ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Pressed."}"""))
        assertTrue(out.summary, out.ok)
        assertEquals(4, dev.actions.size) // 3 stale + the one that landed
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
        assertTrue(wantsPlayback("open Spotify and play Back in Black by AC/DC"))
        assertFalse(wantsPlayback("resume the stopwatch in the Clock app")) // live false reject
        assertFalse(wantsPlayback("continue the download"))
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

    // ── Evidence the system records (2026-09-26 verifier pass) ──

    @Test fun screenChangeReportsFlipsWhatAppearedAndWhatWentAway() {
        val before = screen(node(0, "Wi-Fi", checked = false), node(1, "Turn on Wi-Fi?", clickable = false))
        val after = screen(node(0, "Wi-Fi", checked = true), node(2, "Connected", clickable = false))
        val c = screenChange(before, after)
        assertEquals(listOf("\"Wi-Fi\" unchecked→checked"), c.flips)
        assertEquals("\"Wi-Fi\" unchecked→checked; new: \"Connected\"; gone: \"Turn on Wi-Fi?\"", c.describe())
        assertEquals("now in com.other", screenChange(before, screen(app = "com.other")).describe())
        assertTrue(screenChange(before, before).isEmpty())
        // The status bar's clock (another window) ticking over is not the action's doing.
        val clock = { t: String -> OpNode(9, t, "TextView", windowId = 77, selector = "clock") }
        assertTrue(screenChange(screen(node(0, "Row"), clock("18:15")), screen(node(0, "Row"), clock("18:16"))).isEmpty())
    }

    @Test fun aRecycledRowOrAScrollIsNeverReportedAsAFlip() {
        // The same view at the same place now shows another row: not "the same switch".
        assertTrue(screenChange(screen(node(0, "Bluetooth", checked = false)), screen(node(0, "Wi-Fi calling", checked = true))).flips.isEmpty())
        // A real state difference seen across a scroll still isn't the scroll's doing.
        val off = screen(node(0, "Wi-Fi", checked = false))
        val on = screen(node(0, "Wi-Fi", checked = true))
        assertTrue(screenChange(off, on, flips = false).flips.isEmpty())
    }

    @Test fun aPressedControlThatRenamesItselfOrChangesStateIsAChange() {
        // Samsung's rotation tile reports its state in its label (live 2026-09-26); the id-less
        // tile's selector changes with it, so it is matched by place.
        fun tile(desc: String) = OpNode(0, "", "Button", description = desc, clickable = true, selector = desc,
            windowId = 3, path = "0.1", bounds = OpBounds(0, 0, 100, 100))
        val off = screen(tile("Portrait, Auto rotate"))
        val on = screen(tile("Auto rotate, Set to portrait"))
        assertEquals(listOf("\"Portrait, Auto rotate\" now reads \"Auto rotate, Set to portrait\""),
            screenChange(off, on, tapped = off.nodes[0]).flips)
        // A tile that says it in its state instead.
        val dark = screen(node(0, "Flashlight").copy(state = "Off"))
        val lit = screen(node(0, "Flashlight").copy(state = "On"))
        assertEquals(listOf("\"Flashlight\" Off→On"), screenChange(dark, lit).flips)
        assertTrue(renderObs(lit), renderObs(lit).contains("state: On"))
        // The pressed control counts even with no words of its own (Samsung's DND switch, live);
        // an unlabelled switch it didn't press does not.
        val sw = OpNode(7, "", "Switch", clickable = true, checked = false, selector = "sw", windowId = 3)
        val flipped = screen(sw.copy(checked = true))
        assertEquals(listOf("\"the tapped Switch\" unchecked→checked"), screenChange(screen(sw), flipped, tapped = sw).flips)
        assertTrue(screenChange(screen(sw), flipped).flips.isEmpty())
        // A tap that navigates: whatever now sits in the tapped row's place is another page's row.
        val row = OpNode(0, "Display", "LinearLayout", clickable = true, selector = "r", windowId = 3, path = "0.2")
        val page = screen(row.copy(text = "Brightness", selector = "b"), node(1, "A"), node(2, "B"), node(3, "C"))
        assertTrue(screenChange(screen(row), page, tapped = row).flips.isEmpty())
    }

    @Test fun eachStepSaysWhatItChangedAndTheCheckerGetsEveryFlip() {
        val off = screen(node(0, "Dark mode", role = "Switch", checked = false))
        val on = screen(node(0, "Dark mode", role = "Switch", checked = true), gen = 9)
        val verifier = ScriptedModel(pass)
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Dark mode is on."}""")
        val out = run("turn on dark mode", FakeDevice(listOf(off, on, on)), m, verifier = verifier)
        assertTrue(out.summary, out.ok)
        assertTrue(m.prompts[1], m.prompts[1].contains("tap[0] \"Dark mode\" — ok → \"Dark mode\" unchecked→checked"))
        assertTrue(verifier.prompts[0], verifier.prompts[0].contains("\"changes_made\":[\"step 1: \\\"Dark mode\\\" unchecked→checked\"]"))
    }

    @Test fun anOperatorThatGivesUpOnAMetGoalIsCheckedFirst() {
        val off = screen(node(0, "Portrait, Auto rotate"))
        val on = screen(node(0, "Auto rotate, Set to portrait"), gen = 9)
        val m = ScriptedModel("""{"do":"tap","target":0}""", """{"do":"fail","summary":"It still says portrait."}""")
        val met = run("turn on auto rotate", FakeDevice(listOf(off, on, on)), m,
            verifier = ScriptedModel("""{"verdict":"pass","summary":"Auto-rotate is on."}"""))
        assertTrue(met.summary, met.ok)
        assertEquals("Auto-rotate is on.", met.summary)
        val notMet = run("turn on auto rotate", FakeDevice(listOf(off, off, off)),
            ScriptedModel("""{"do":"tap","target":0}""", """{"do":"fail","summary":"It still says portrait."}"""),
            verifier = ScriptedModel("""{"verdict":"fail","reason":"still portrait"}"""))
        assertFalse(notMet.ok)
        assertEquals("It still says portrait.", notMet.summary)
    }

    @Test fun theUserHearsTheCheckersAccountNotTheOperatorsClaim() {
        // Live: the operator switched Bluetooth on, then reported it "already turned on".
        val off = screen(node(0, "Bluetooth", role = "Switch", checked = false))
        val on = screen(node(0, "Bluetooth", role = "Switch", checked = true), gen = 9)
        val out = run("turn on Bluetooth", FakeDevice(listOf(off, on, on)),
            ScriptedModel("""{"do":"tap","target":0}""", """{"do":"done","summary":"Bluetooth is already turned on."}"""),
            verifier = ScriptedModel("""{"verdict":"pass","summary":"Bluetooth was turned on."}"""))
        assertTrue(out.ok)
        assertEquals("Bluetooth was turned on.", out.summary)
    }

    @Test fun claimEvidenceSaysWhereEachAnsweredValueWasSeen() {
        val seen = linkedMapOf(
            "2016" to "after step 1: 2016",
            "16" to "after step 2: Android version · 16",
            "Galaxy Bells" to "after step 4: Ringtone · Galaxy Bells",
            "8,848.86 m" to "after step 3: Mount Everest · 8,848.86 m",
            "Ringtone" to "after step 4: Ringtone",
        )
        val ev = claimEvidence(
            "Android 16, the ringtone is Galaxy Bells, Everest is 8848.86 m, battery 85%",
            "check the android version and the ringtone",
            seen,
        )
        val where = (0 until ev.length()).associate { ev.getJSONObject(it).getString("value") to ev.getJSONObject(it).getString("seen") }
        assertEquals("after step 2: Android version · 16", where["16"]) // not inside "2016"
        assertEquals("after step 3: Mount Everest · 8,848.86 m", where["8848.86"])
        assertEquals("nowhere", where["85"])
        assertEquals("after step 4: Ringtone · Galaxy Bells", where["Galaxy Bells"])
        assertFalse(where.containsKey("Ringtone")) // the goal's own word is the question, not an answer
        // A timer's "01:30" is the goal's "1 minute 30 seconds", part by part.
        val timer = claimEvidence("Timer is set to 01:30.", "set the timer to 1 minute 30 seconds", emptyMap())
        assertEquals(listOf("in the goal itself", "in the goal itself"), (0 until timer.length()).map { timer.getJSONObject(it).getString("seen") })
    }

    @Test fun anAnswerReadOnAnEarlierScreenReachesTheChecker() {
        val about = screen(node(0, "Android version", clickable = false), node(1, "16", clickable = false), node(2, "Back"))
        val home = screen(node(0, "Settings home", clickable = false), node(3, "Back"), gen = 9)
        val verifier = ScriptedModel(pass)
        run("what android version is this", FakeDevice(listOf(about, home, home)),
            ScriptedModel("""{"do":"tap","target":2}""", """{"do":"done","summary":"Android 16."}"""), verifier = verifier)
        // (the JVM's org.json doesn't keep key order, so each half separately)
        assertTrue(verifier.prompts[0], verifier.prompts[0].contains("\"value\":\"16\""))
        assertTrue(verifier.prompts[0], verifier.prompts[0].contains("\"seen\":\"after step 0: Android version · 16\""))
    }

    @Test fun aPassThatListsAnUnmetCheckIsAFail() {
        val v = parseVerdict(
            """{"checks":[{"need":"Android version","evidence":"16 on screen","met":true},""" +
                """{"need":"model name","evidence":"not shown anywhere","met":false}],"verdict":"pass","summary":"Done"}""",
        )
        assertEquals(false, v?.pass)
        assertEquals("model name — not shown anywhere", v?.text)
        assertEquals(true, parseVerdict("""{"checks":[{"need":"timer running","evidence":"04:59 counting","met":true}]}""")?.pass)
        assertEquals(false, parseVerdict("""{"checks":[{"need":"x","evidence":"y","met":"no"}]}""")?.pass)
        assertEquals(null, parseVerdict("""{"checks":[{"need":"x"}]}""")) // nothing ruled
    }

    @Test fun aNoFromTheListAfterAFlipGetsASecondLookWithAScreenshot() {
        // Samsung's theme radios once read "Light" while the screen showed Dark (live).
        val rows = (0 until 11).map { node(it, "Row $it") }
        val before = screen(*rows.toTypedArray(), node(11, "Dark", role = "RadioButton", checked = false))
        val after = screen(*rows.toTypedArray(), node(11, "Dark", role = "RadioButton", checked = true), gen = 9)
        val dev = FakeDevice(listOf(before, after, after)).apply { shot = "SHOT" }
        val verifier = ScriptedModel("""{"verdict":"fail","reason":"Light is still selected"}""", pass).apply { vision = true }
        val lines = mutableListOf<String>()
        val out = run("turn on dark mode", dev,
            ScriptedModel("""{"do":"tap","target":11}""", """{"do":"done","summary":"Dark mode is on."}"""),
            verifier = verifier, lines = lines)
        assertTrue(out.summary, out.ok)
        assertEquals(listOf(0, 1), verifier.imageCounts) // the list first, then the pixels
        assertTrue(lines.any { it.contains("second look") })
    }

    @Test fun aNoWithNothingChangedIsNotPaidForTwice() {
        val rich = screen(*(0 until 12).map { node(it, "Row $it") }.toTypedArray())
        val dev = FakeDevice(listOf(rich)).apply { shot = "SHOT" }
        val verifier = ScriptedModel("""{"verdict":"fail","reason":"not there"}""", """{"verdict":"fail","reason":"still not"}""")
            .apply { vision = true }
        val out = run("open row 3", dev,
            ScriptedModel("""{"do":"tap","target":3}""", """{"do":"done","summary":"Opened."}""", """{"do":"done","summary":"Opened."}"""),
            verifier = verifier)
        assertFalse(out.ok)
        assertEquals(listOf(0, 0), verifier.imageCounts) // one plain check per claim, no second look
    }

    // ── Unfamiliar apps ──

    @Test fun aLookupMayWalkThroughASensitiveAreaButNeverActOnACriticalControl() {
        // 2026-09-26: "what the security patch level is" was refused at its first tap.
        val lookup = "on my phone, check in Settings what the security patch level is"
        assertEquals("R1", classifyGoalRisk(lookup))
        assertEquals("R1", classifyGoalRisk("which apps have camera permission?"))
        assertEquals("R3", classifyGoalRisk("turn off the security updates"))
        assertEquals("R3", classifyGoalRisk("what's my Wi-Fi password"))
        assertEquals("R3", classifyGoalRisk("check my bank balance"))
        val obs = screen(node(0, "Security and privacy"), node(1, "Delete account"), node(2, "Search", role = "EditText", editable = true))
        fun cmd(s: String) = parseCommand(s)!!
        assertEquals("R1", classifyAction(lookup, cmd("""{"do":"tap","target":0}"""), obs).risk)
        assertEquals("R1", classifyAction(lookup, cmd("""{"do":"set_text","target":2,"text":"security patch"}"""), obs).risk)
        assertEquals("R3", classifyAction(lookup, cmd("""{"do":"tap","target":1}"""), obs).risk)
        assertEquals("R3", classifyAction("turn on dark mode", cmd("""{"do":"tap","target":0}"""), obs).risk)
        assertFalse(isLookupGoal("find the Wi-Fi settings and turn Wi-Fi off"))
    }

    @Test fun scrollingBackAndForthIsRedirectedOnceBeforeItStops() {
        // Live: "turn on auto rotate" scrolled Display settings up and down until the cycle
        // guard ended the task — twice — without ever trying search.
        val screens = (0..20).map { g -> screen(node(0, "Row $g"), gen = g.toLong()) }
        val moves = arrayOf("""{"do":"scroll","direction":"down"}""", """{"do":"scroll","direction":"up"}""")
        val m = ScriptedModel(*Array(12) { moves[it % 2] })
        val out = run("turn on auto rotate", FakeDevice(screens), m, plan = true,
            verifier = ScriptedModel("""{"verdict":"fail","reason":"auto rotate is off"}"""))
        assertFalse(out.ok)
        assertTrue(out.steps.any { it.contains("scrolling back and forth") })
        assertTrue(out.steps.any { it.contains("3 scrolls and still looking") })
        assertTrue(m.prompts.any { it.contains("REPLAN") })
        assertTrue(out.summary, out.summary.contains("circles"))
        assertEquals(8, m.prompts.size) // redirected once, stopped at the second cycle
    }

    @Test fun goingOverOldGroundIsNudgedThenStopped() {
        // Live: a lookup for a setting this phone doesn't have went Display → search → back three
        // times over, each move "changing the screen", for 171s. Two pages, every move a different
        // control (so no cycle), nothing new after the first visit to each.
        val a = screen(*(0 until 12).map { node(it, "A$it") }.toTypedArray())
        val b = screen(*(0 until 12).map { node(it, "B$it") }.toTypedArray(), gen = 9)
        val m = ScriptedModel(*Array(14) { """{"do":"tap","target":$it}""" })
        val out = run("find the screen resolution", FakeDevice((0..40).map { if (it % 2 == 0) a else b }), m,
            verifier = ScriptedModel("""{"verdict":"fail","reason":"no resolution shown"}"""))
        assertFalse(out.ok)
        assertTrue(out.steps.any { it.contains("showed nothing you hadn't already seen") })
        assertTrue(out.summary, out.summary.contains("went over the same screens"))
        assertEquals(10, m.prompts.size) // the first visit to each page is new; nine stale moves after it
    }

    @Test fun reTypingTheSameSearchIsNotProgress() {
        // Live: the operator re-ran the same Settings search again and again; typing counted
        // as progress every time, so the stale count never climbed.
        fun field(t: String) = OpNode(20, t, "EditText", editable = true, selector = "field", windowId = 3,
            bounds = OpBounds(0, 2000, 200, 90))
        val a = screen(*(0 until 12).map { node(it, "A$it") }.toTypedArray(), field(""))
        val b = screen(*(0 until 12).map { node(it, "B$it") }.toTypedArray(), field("resolution"), gen = 9)
        val m = ScriptedModel(*Array(14) { """{"do":"tap","target":$it}""" })
        val out = run("find the screen resolution", FakeDevice((0..40).map { if (it % 2 == 0) a else b }), m,
            verifier = ScriptedModel("""{"verdict":"fail","reason":"no resolution shown"}"""))
        assertTrue(out.summary, out.summary.contains("went over the same screens"))
        assertEquals(11, m.prompts.size) // each text counted once, then nine stale moves
    }

    @Test fun quickSettingsOpensThePanelEvenFromJarvisItself() {
        val self = screen(app = "com.jarvis.app")
        val off = screen(node(0, "Auto rotate", role = "Switch", checked = false), app = "com.android.systemui")
        val on = screen(node(0, "Auto rotate", role = "Switch", checked = true), app = "com.android.systemui", gen = 9)
        val dev = FakeDevice(listOf(self, off, on, on))
        val out = runBlocking {
            OperatorLoop(
                dev,
                ScriptedModel("""{"do":"quick_settings"}""", """{"do":"tap","target":0}""", """{"do":"done","summary":"Auto rotate is on."}"""),
                FakeJournal(),
                OperatorOptions(taskId = "t", goal = "turn on auto rotate", plan = false, sleep = {}, selfPackage = "com.jarvis.app"),
                ScriptedModel(pass),
            ).run()
        }
        assertTrue(out.summary, out.ok)
        assertEquals(listOf("quickSettings", "tap:0"), dev.actions)
        assertTrue(out.steps[0], out.steps[0].contains("now in com.android.systemui"))
        assertEquals("R0", classifyAction("turn on auto rotate", parseCommand("""{"do":"quick_settings"}""")!!, off).risk)
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

    @Test fun aSearchGoalMayRetypeItsQueryInAnotherBox() {
        // Live: typed into the wrong page's search box, then again into Chrome's — not a duplicate message.
        val box = node(0, "", role = "EditText", editable = true)
        val dev = FakeDevice(listOf(screen(box), screen(box.copy(text = "x"), gen = 8), screen(box, gen = 9)))
        run("search google for the height of mount everest", dev,
            ScriptedModel("""{"do":"set_text","target":0,"text":"height of Mount Everest"}""",
                """{"do":"set_text","target":0,"text":"height of Mount Everest"}""", """{"do":"fail","summary":"x"}"""))
        assertEquals(2, dev.actions.size)
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

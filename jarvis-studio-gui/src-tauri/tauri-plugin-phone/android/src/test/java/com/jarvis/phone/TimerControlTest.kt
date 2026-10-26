package com.jarvis.phone

import org.junit.Assert.*
import org.junit.Test

class TimerControlTest {
    private val timer = TimerNotice("timer-1", "clock", "notification_channel_timer", false, listOf("Cancel", "Pause"))
    @Test fun stopsOnlyOneClockTimer() {
        assertEquals("timer-1" to 0, timerCancelAction(listOf(timer, timer.copy(key = "group", summary = true)), "clock"))
    }
    @Test fun refusesAmbiguousTimersAndUnrelatedNotifications() {
        assertNull(timerCancelAction(listOf(timer, timer.copy(key = "timer-2")), "clock"))
        assertNull(timerCancelAction(listOf(timer.copy(pkg = "messages")), "clock"))
        assertNull(timerCancelAction(listOf(timer.copy(channel = "alarm")), "clock"))
        assertNull(timerCancelAction(listOf(timer.copy(actions = listOf("Pause"))), "clock"))
    }
    @Test fun renamedDeviceCannotPassModelVerification() {
        val facts = mapOf("model" to "SM-E156B", "android_version" to "16")
        assertNotNull(hardwareClaimProblem("Tell me my phone model", "Anaay's S27 Ultra", facts))
        assertNull(hardwareClaimProblem("Tell me my phone model", "Samsung SM-E156B, Android 16", facts))
        assertNull(hardwareClaimProblem("Read the device name", "Anaay's S27 Ultra", facts))
        assertTrue(renderObs(OpObservation("settings", emptyList(), hardwareFacts = facts)).contains("SM-E156B"))
    }
}

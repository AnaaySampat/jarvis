package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class RoutineAlarmsTest {
    private val ist = TimeZone.getTimeZone("Asia/Kolkata")
    private val all = (0..6).toSet()

    /** Local wall-clock time in [tz] as epoch ms. 2026-09-30 is a Wednesday. */
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int, tz: TimeZone = ist): Long =
        Calendar.getInstance(tz).apply {
            clear()
            set(y, mo - 1, d, h, mi, 0)
        }.timeInMillis

    private fun next(now: Long, h: Int, m: Int, days: Set<Int> = all, lastRun: String = "", tz: TimeZone = ist) =
        RoutineAlarms.nextDue(now, h, m, days, lastRun, tz)

    @Test fun laterTodayFiresToday() {
        assertEquals(at(2026, 9, 30, 19, 21), next(at(2026, 9, 30, 8, 0), 19, 21))
    }

    @Test fun aPassedTimeWaitsForTomorrow() {
        assertEquals(at(2026, 10, 1, 19, 21), next(at(2026, 9, 30, 19, 21), 19, 21))
        assertEquals(at(2026, 10, 1, 19, 21), next(at(2026, 9, 30, 22, 0), 19, 21))
    }

    @Test fun aRoutineThatRanTodaySkipsToday() {
        assertEquals(at(2026, 10, 1, 19, 21), next(at(2026, 9, 30, 8, 0), 19, 21, lastRun = "2026-09-30"))
    }

    @Test fun weekdaysJumpTheWeekend() {
        // Friday 2026-10-02 after the time → Monday 2026-10-05.
        assertEquals(at(2026, 10, 5, 7, 0), next(at(2026, 10, 2, 9, 0), 7, 0, setOf(1, 2, 3, 4, 5)))
    }

    @Test fun onceAWeekThatRanTodayIsNextWeek() {
        // Wednesday only, ran this Wednesday morning → next Wednesday.
        assertEquals(at(2026, 10, 7, 20, 0), next(at(2026, 9, 30, 9, 0), 20, 0, setOf(3), "2026-09-30"))
    }

    @Test fun noDaysOrABadTimeNeverFires() {
        assertEquals(-1L, next(at(2026, 9, 30, 8, 0), 19, 21, emptySet()))
        assertEquals(-1L, next(at(2026, 9, 30, 8, 0), 24, 0))
        assertEquals(-1L, next(at(2026, 9, 30, 8, 0), -1, -1))
    }

    @Test fun keepsTheWallClockTimeAcrossDst() {
        val ny = TimeZone.getTimeZone("America/New_York")
        // Clocks go forward on 2026-03-08; 08:00 is still 08:00 local, 23 hours later.
        val due = next(at(2026, 3, 7, 9, 0, ny), 8, 0, tz = ny)
        assertEquals(at(2026, 3, 8, 8, 0, ny), due)
        assertEquals(8, Calendar.getInstance(ny).apply { timeInMillis = due }.get(Calendar.HOUR_OF_DAY))
        assertEquals("2026-03-08", RoutineAlarms.isoDate(due, ny))
    }

    @Test fun aTimeZoneChangeKeepsTheWallClockTime() {
        val now = at(2026, 9, 30, 8, 0)
        val inIst = RoutineAlarms.scheduled(listOf(RoutineAlarms.Entry("check", 19, 21, all, "")), now, ist)
        val dubai = TimeZone.getTimeZone("Asia/Dubai")
        val moved = RoutineAlarms.scheduled(inIst, now, dubai).single()
        assertEquals(at(2026, 9, 30, 19, 21, dubai), moved.at)
        assertEquals(90 * 60_000L, moved.at - inIst.single().at)
    }

    @Test fun fireAnnouncesWhatsDueAndRollsItForward() {
        val due = RoutineAlarms.Entry("time check", 19, 21, all, "", at(2026, 9, 30, 19, 21))
        val later = RoutineAlarms.Entry("bedtime", 22, 0, all, "", at(2026, 9, 30, 22, 0))
        val (announce, rolled) = RoutineAlarms.fire(listOf(due, later), at(2026, 9, 30, 19, 21), ist)
        assertEquals(listOf("time check"), announce.map { it.name })
        assertEquals(at(2026, 10, 1, 19, 21), rolled.first { it.name == "time check" }.at)
        assertEquals(later, rolled.first { it.name == "bedtime" })
    }

    @Test fun anAlarmMoreThanTwoHoursLateIsDroppedNotAnnounced() {
        val e = RoutineAlarms.Entry("time check", 19, 21, all, "", at(2026, 9, 30, 19, 21))
        val (announce, rolled) = RoutineAlarms.fire(listOf(e), at(2026, 10, 1, 8, 0), ist)
        assertTrue(announce.isEmpty())
        assertEquals(at(2026, 10, 1, 19, 21), rolled.single().at)
        // Within the window it's still announced.
        val (soon, _) = RoutineAlarms.fire(listOf(e), at(2026, 9, 30, 21, 21), ist)
        assertEquals(1, soon.size)
    }

    @Test fun jsonRoundTripsAndDropsBadRows() {
        val list = RoutineAlarms.fromJson(
            """[{"name":"time check","hour":19,"minute":21,"days":[0,1,9,6],"lastRun":"2026-09-29"},
               {"name":"  ","hour":8,"minute":0,"days":[1]}, 5]""",
        )
        assertEquals(1, list.size)
        assertEquals(setOf(0, 1, 6), list[0].days)
        assertEquals(-1L, list[0].at)
        val scheduled = RoutineAlarms.scheduled(list, at(2026, 9, 30, 8, 0), ist)
        assertEquals(scheduled, RoutineAlarms.fromJson(RoutineAlarms.toJson(scheduled)))
        assertEquals(emptyList<RoutineAlarms.Entry>(), RoutineAlarms.fromJson("not json"))
    }
}

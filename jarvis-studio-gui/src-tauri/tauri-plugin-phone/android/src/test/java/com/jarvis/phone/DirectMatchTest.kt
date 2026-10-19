package com.jarvis.phone

import com.jarvis.phone.DirectMatch.PhoneRow
import com.jarvis.phone.DirectMatch.Pick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DirectMatchTest {

    private fun row(id: Long, name: String, number: String, primary: Boolean = false, mobile: Boolean = false) =
        PhoneRow(id, name, number, primary, mobile)

    @Test
    fun exactNameBeatsLongerMatches() {
        val rows = listOf(row(1, "Mom Office", "111"), row(2, "Mom", "222"), row(3, "Mommy Sharma", "333"))
        assertEquals(Pick.One("Mom", "222"), DirectMatch.pickContact("mom", rows))
    }

    @Test
    fun twoPeopleAtTheSameRankIsAQuestionNotAGuess() {
        val rows = listOf(row(1, "Rahul Mehta", "111"), row(2, "Rahul Shah", "222"))
        assertEquals(Pick.Ambiguous(listOf("Rahul Mehta", "Rahul Shah")), DirectMatch.pickContact("rahul", rows))
    }

    @Test
    fun oneContactWithSeveralNumbersPrefersPrimaryThenMobile() {
        val rows = listOf(row(1, "Dad", "home"), row(1, "Dad", "mob", mobile = true), row(1, "Dad", "pri", primary = true))
        assertEquals(Pick.One("Dad", "pri"), DirectMatch.pickContact("Dad", rows))
        assertEquals(Pick.One("Dad", "mob"), DirectMatch.pickContact("Dad", rows.dropLast(1)))
    }

    @Test
    fun surnameMatchesAsAWordPrefix() {
        val rows = listOf(row(1, "Priya Kapoor", "111"))
        assertEquals(Pick.One("Priya Kapoor", "111"), DirectMatch.pickContact("kapoor", rows))
        assertEquals(Pick.None, DirectMatch.pickContact("zed", rows))
    }

    @Test
    fun numbersAreRecognised() {
        assertTrue(DirectMatch.looksLikeNumber("+91 98200 12345"))
        assertTrue(DirectMatch.looksLikeNumber("(022) 555-0100"))
        assertFalse(DirectMatch.looksLikeNumber("Mom"))
        assertFalse(DirectMatch.looksLikeNumber("123"))
    }

    @Test
    fun notificationTitlesMatchThePersonExactly() {
        assertTrue(DirectMatch.titleMatches("Mom", "mom"))
        assertTrue(DirectMatch.titleMatches("Mom (2 messages)", "Mom"))
        assertTrue(DirectMatch.titleMatches("Mom:", "Mom"))
        // A group message from Mom is the group, not a chat with her.
        assertFalse(DirectMatch.titleMatches("Mom @ Family", "Mom"))
        assertFalse(DirectMatch.titleMatches("Alice", "Al"))
        assertFalse(DirectMatch.titleMatches("Mom", ""))
    }
}

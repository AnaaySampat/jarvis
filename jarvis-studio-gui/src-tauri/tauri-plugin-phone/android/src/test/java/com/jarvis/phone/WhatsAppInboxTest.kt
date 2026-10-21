package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppInboxTest {

    @Test
    fun aCommandStartsWithTheNameAndLosesIt() {
        assertEquals("set a timer for 10 minutes", WhatsAppInbox.addressed("Jarvis, set a timer for 10 minutes"))
        assertEquals("what's the weather?", WhatsAppInbox.addressed("hey JARVIS what's the weather?"))
        assertEquals("", WhatsAppInbox.addressed("Jarvis!"))
        assertNull(WhatsAppInbox.addressed("dinner at 8? ask jarvis"))
        assertNull(WhatsAppInbox.addressed("Jarvisa is my cat"))
        assertNull(WhatsAppInbox.addressed("🤖 Alarm set for 07:00."))       // JARVIS's own reply
    }

    @Test
    fun aListedNameMatchesExactlyAndANumberByItsDigits() {
        val allowed = WhatsAppInbox.parseAllowed("Asha, +91 98765 43210;\nDad")
        assertEquals(listOf("Asha", "+91 98765 43210", "Dad"), allowed)
        assertTrue(WhatsAppInbox.senderAllowed("Asha", allowed))
        assertTrue(WhatsAppInbox.senderAllowed("Asha (2 messages)", allowed))
        assertTrue(WhatsAppInbox.senderAllowed("+91 98765-43210", allowed))
        assertFalse(WhatsAppInbox.senderAllowed("Ash", allowed))
        assertFalse(WhatsAppInbox.senderAllowed("Asha Mehta", allowed))
        assertFalse(WhatsAppInbox.senderAllowed("+91 98765 43211", allowed))
        assertFalse(WhatsAppInbox.senderAllowed("Family @ Dad", allowed))
        assertFalse(WhatsAppInbox.senderAllowed("Asha", emptyList()))
    }
}

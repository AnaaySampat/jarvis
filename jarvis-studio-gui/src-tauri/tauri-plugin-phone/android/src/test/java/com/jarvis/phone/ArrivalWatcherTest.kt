package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArrivalWatcherTest {

    @Test
    fun aNetworkIsItsGatewayAndSubnet() {
        assertEquals("192.168.1.1|192.168.1.0/24", ArrivalWatcher.fingerprint("192.168.1.1", "192.168.1.37", 24))
        assertEquals("10.0.0.1|10.0.0.0/16", ArrivalWatcher.fingerprint("10.0.0.1", "10.0.12.9", 16))
        assertEquals("", ArrivalWatcher.fingerprint("", "192.168.1.37", 24))
        assertEquals("", ArrivalWatcher.fingerprint("192.168.1.1", "fe80::1", 64))
    }

    @Test
    fun onlyComingBackFromAwayIsArriving() {
        val homes = setOf("192.168.1.1|192.168.1.0/24", "192.168.0.1|192.168.0.0/24")
        assertTrue(ArrivalWatcher.isArrival("192.168.0.1|192.168.0.0/24", homes, "away"))
        assertFalse(ArrivalWatcher.isArrival("192.168.1.1|192.168.1.0/24", homes, "home")) // a blip at home
        assertFalse(ArrivalWatcher.isArrival("192.168.1.1|192.168.1.0/24", homes, "")) // nothing known yet
        assertFalse(ArrivalWatcher.isArrival("10.0.0.1|10.0.0.0/24", homes, "away")) // a café
    }
}

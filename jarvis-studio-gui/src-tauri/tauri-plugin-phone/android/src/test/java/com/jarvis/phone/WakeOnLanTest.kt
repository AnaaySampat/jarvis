package com.jarvis.phone

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeOnLanTest {

    @Test
    fun macsInAnySpellingAreNormalised() {
        assertEquals("aa:bb:cc:dd:ee:ff", WakeOnLan.normMac("AA-BB-CC-DD-EE-FF"))
        assertEquals("aa:bb:cc:dd:ee:ff", WakeOnLan.normMac(" aabbccddeeff "))
        assertEquals("", WakeOnLan.normMac("ff:ff:ff:ff:ff:ff"))
        assertEquals("", WakeOnLan.normMac("not a mac"))
    }

    @Test
    fun theMagicPacketIsSixFfsThenTheMacSixteenTimes() {
        val p = WakeOnLan.packet("01:02:03:04:05:06")!!
        assertEquals(102, p.size)
        assertArrayEquals(ByteArray(6) { 0xFF.toByte() }, p.copyOfRange(0, 6))
        for (i in 0 until 16) {
            assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6), p.copyOfRange(6 + i * 6, 12 + i * 6))
        }
        assertNull(WakeOnLan.packet("nope"))
    }

    @Test
    fun aPrivateAddressAddsItsSubnetBroadcast() {
        assertEquals(listOf("255.255.255.255", "192.168.1.255"), WakeOnLan.targets("192.168.1.20:5555"))
        assertEquals(listOf("255.255.255.255"), WakeOnLan.targets("100.101.1.2"))
        assertEquals(listOf("255.255.255.255"), WakeOnLan.targets(""))
    }

    @Test
    fun sendReportsWhetherAnythingLeftThePhone() {
        val sent = mutableListOf<Pair<String, Int>>()
        val ok = WakeOnLan.send("01:02:03:04:05:06", "192.168.1.20") { _, a, p -> sent.add(a to p) }
        assertTrue(ok.first)
        assertEquals(12, sent.size) // 3 rounds × 2 addresses × ports 9 and 7
        val failed = WakeOnLan.send("01:02:03:04:05:06", "") { _, _, _ -> throw java.io.IOException("Network is unreachable") }
        assertFalse(failed.first)
        assertTrue(failed.second.contains("Network is unreachable"))
    }
}

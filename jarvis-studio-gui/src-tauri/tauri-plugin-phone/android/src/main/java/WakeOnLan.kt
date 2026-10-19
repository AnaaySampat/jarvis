package com.jarvis.phone

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Wake-on-LAN: switch on a TV or PC that is fully off with one UDP "magic packet" —
 * six 0xFF bytes, then its MAC address sixteen times. The device's network card
 * listens for it even when everything else is off, if the device allows it (Sony TV:
 * Settings → Network → Remote start; a PC: Wake on LAN in the BIOS and on the network
 * adapter). A broadcast never crosses a router, so it only works on the same network.
 * Mirrors the desktop's actions/wol.py; the pure half is free of Android types so the
 * JVM tests can drive it.
 */
internal object WakeOnLan {

    private val MAC = Regex(
        "^([0-9a-fA-F]{2})[:-]?([0-9a-fA-F]{2})[:-]?([0-9a-fA-F]{2})[:-]?" +
            "([0-9a-fA-F]{2})[:-]?([0-9a-fA-F]{2})[:-]?([0-9a-fA-F]{2})$",
    )
    private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")

    /** "AA-BB-CC-DD-EE-FF" / "aabbccddeeff" → "aa:bb:cc:dd:ee:ff"; "" if it isn't one. */
    fun normMac(raw: String): String {
        val m = MAC.matchEntire(raw.trim()) ?: return ""
        val mac = m.groupValues.drop(1).joinToString(":") { it.lowercase() }
        return if (mac == "00:00:00:00:00:00" || mac == "ff:ff:ff:ff:ff:ff") "" else mac
    }

    fun packet(mac: String): ByteArray? {
        val clean = normMac(mac)
        if (clean.isEmpty()) return null
        val body = clean.split(":").map { it.toInt(16).toByte() }.toByteArray()
        return ByteArray(6) { 0xFF.toByte() } + ByteArray(16 * 6) { body[it % 6] }
    }

    /** The local broadcast, plus the /24 broadcast of the device's last known private
     *  address (some Wi-Fi access points drop 255.255.255.255). */
    fun targets(near: String): List<String> {
        val out = mutableListOf("255.255.255.255")
        val m = IPV4.matchEntire(near.substringBefore(":").trim()) ?: return out
        val o = m.groupValues.drop(1).map { it.toInt() }
        if (o.any { it > 255 }) return out
        val private = o[0] == 10 || (o[0] == 172 && o[1] in 16..31) || (o[0] == 192 && o[1] == 168)
        if (private) out.add("${o[0]}.${o[1]}.${o[2]}.255")
        return out
    }

    /** Send it to ports 9 and 7, three times over. True means it left the phone, never
     *  that the device woke — the caller checks that by reaching it. */
    fun send(
        mac: String,
        near: String,
        sendTo: (ByteArray, String, Int) -> Unit = ::udp,
    ): Pair<Boolean, String> {
        val packet = packet(mac) ?: return false to "That isn't a MAC address: $mac"
        var sent = 0
        var last = ""
        repeat(3) {
            for (addr in targets(near)) {
                for (port in intArrayOf(9, 7)) {
                    try {
                        sendTo(packet, addr, port)
                        sent++
                    } catch (e: Exception) {
                        last = e.message ?: e.javaClass.simpleName
                    }
                }
            }
        }
        if (sent == 0) return false to "The wake-up packet couldn't be sent (${last.ifEmpty { "no network" }})."
        return true to "Sent a wake-up packet to ${normMac(mac)}."
    }

    private fun udp(data: ByteArray, addr: String, port: Int) {
        DatagramSocket().use { s ->
            s.broadcast = true
            s.send(DatagramPacket(data, data.size, InetAddress.getByName(addr), port))
        }
    }
}

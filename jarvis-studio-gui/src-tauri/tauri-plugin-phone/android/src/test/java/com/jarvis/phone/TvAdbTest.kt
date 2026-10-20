package com.jarvis.phone

import dadb.AdbConnectException
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ConnectException
import java.net.SocketTimeoutException

class TvAdbTest {
    private val tv = "192.168.1.50" to 5555

    /** dadb 2.0.0 throws its own wrapper for a failed connect; tv.ts's `unreachable()` only
     *  knows the "can't reach" / "didn't answer in time" wording. */
    @Test
    fun aWrappedConnectFailureReadsAsUnreachable() {
        val refused = AdbConnectException("Failed to connect to 192.168.1.50:5555", ConnectException("refused"))
        assertTrue(TvAdb.describe(refused, tv).startsWith("I can't reach the TV at 192.168.1.50:5555"))
        val off = AdbConnectException("Failed to connect to 192.168.1.50:5555", SocketTimeoutException("timeout"))
        assertTrue(TvAdb.describe(off, tv).contains("didn't answer in time"))
    }
}

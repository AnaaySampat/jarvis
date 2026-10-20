package com.jarvis.phone

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.net.Inet4Address
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * "When I get home" routines (schedule/routines.ts, trigger "home"). Home is a Wi-Fi
 * network, recognised by its gateway and subnet ("192.168.1.1|192.168.1.0/24") — no
 * SSID, so no location permission. JS learns it on its own: whenever the TV or the PC
 * answers on its home address, the network the phone is on is home ([markHome]). A
 * home with two routers is two such networks.
 *
 * Arriving = a home Wi-Fi network becoming available after the phone was last seen
 * away. A PendingIntent network callback catches the first part while JARVIS is closed;
 * a 15-minute sampler ([ArrivalSampleWorker]) records home/away, so a Wi-Fi blip at
 * home never counts as arriving. The callback is one-shot (see [listen]), so the
 * sampler arms it again whenever it finds the phone away, and counts home-after-away
 * as an arrival itself when the callback was spent elsewhere (on another Wi-Fi on the
 * way). Arriving posts the same notification as a timed
 * routine (RoutineAlarms.post): nothing runs until it's tapped, and a routine runs at
 * most once a day.
 */
object ArrivalWatcher {
    private const val TAG = "ArrivalWatcher"
    private const val PREFS = "jarvis_arrival"
    private const val WORK = "jarvis-arrival-sample"
    private const val MAX_HOMES = 8

    // ── Pure (JVM-tested) ──

    /** A network's identity: its default gateway and IPv4 subnet. "" without either. */
    fun fingerprint(gateway: String, address: String, prefix: Int): String {
        val octets = address.split(".").mapNotNull { it.toIntOrNull() }
        if (gateway.isEmpty() || octets.size != 4 || prefix !in 8..30) return ""
        val ip = octets.fold(0L) { acc, o -> (acc shl 8) or (o.toLong() and 0xFF) }
        val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
        val net = ip and mask
        val dotted = (3 downTo 0).joinToString(".") { ((net shr (it * 8)) and 0xFF).toString() }
        return "$gateway|$dotted/$prefix"
    }

    /** Whether reaching [fp] now is an arrival, given the last sample ("home", "away",
     *  or "" before the first one). */
    fun isArrival(fp: String, homes: Set<String>, last: String): Boolean =
        fp.isNotEmpty() && fp in homes && last == "away"

    /** Seeing Wi-Fi [fp] ("" = none): the new last sample, and whether it's arriving. */
    fun sighting(fp: String, homes: Set<String>, last: String): Pair<String, Boolean> =
        (if (fp.isNotEmpty() && fp in homes) "home" else "away") to isArrival(fp, homes, last)

    // ── Android ──

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun homes(ctx: Context): Set<String> = prefs(ctx).getStringSet("homes", emptySet()) ?: emptySet()
    private fun routines(ctx: Context): List<String> {
        val arr = try { JSONArray(prefs(ctx).getString("routines", "[]")) } catch (_: Exception) { JSONArray() }
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }

    private fun cm(ctx: Context) = ctx.getSystemService(ConnectivityManager::class.java)

    private fun fingerprintOf(lp: LinkProperties?): String {
        lp ?: return ""
        val v4 = lp.linkAddresses.firstOrNull { it.address is Inet4Address } ?: return ""
        val gw = lp.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }
            ?.gateway?.hostAddress ?: ""
        return fingerprint(gw, v4.address.hostAddress ?: "", v4.prefixLength)
    }

    /** The Wi-Fi network the phone is on now, by fingerprint; "" when not on Wi-Fi.
     *  Not `activeNetwork`: with a VPN up (Tailscale, which PC pairing uses) that is the
     *  VPN, whose link has no home gateway — on 2026-10-19 marking home said "The phone
     *  isn't on Wi-Fi" while it was. */
    fun currentWifi(ctx: Context): String {
        val cm = cm(ctx)
        @Suppress("DEPRECATION") // allNetworks: the one call that lists networks without a callback
        val wifi = cm.allNetworks.firstOrNull { net ->
            val caps = cm.getNetworkCapabilities(net)
            caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
        } ?: return ""
        return fingerprintOf(cm.getLinkProperties(wifi))
    }

    /** Remember the current Wi-Fi as home. (ok, summary, homes, here) */
    fun markHome(ctx: Context): Triple<Boolean, String, Int> {
        val fp = currentWifi(ctx)
        if (fp.isEmpty()) return Triple(false, "The phone isn't on Wi-Fi.", homes(ctx).size)
        val set = homes(ctx).toMutableSet()
        if (fp !in set) {
            set.add(fp)
            prefs(ctx).edit().putStringSet("homes", set.toList().takeLast(MAX_HOMES).toSet())
                .putString("last", "home").apply()
        }
        return Triple(true, "This Wi-Fi is home.", set.size)
    }

    fun forgetHomes(ctx: Context) {
        prefs(ctx).edit().remove("homes").remove("last").apply()
    }

    fun homeCount(ctx: Context) = homes(ctx).size
    fun atHome(ctx: Context) = currentWifi(ctx) in homes(ctx)

    /** JS's "when I get home" routines (names): watch while there are any. */
    fun sync(ctx: Context, namesJson: String) {
        prefs(ctx).edit().putString("routines", namesJson).apply()
        rearm(ctx)
    }

    /** Register (or drop) the network callback and the sampler for the stored list —
     *  also after a reboot, which drops PendingIntent callbacks. */
    fun rearm(ctx: Context) {
        val wm = WorkManager.getInstance(ctx)
        if (routines(ctx).isEmpty()) {
            unlisten(ctx)
            wm.cancelUniqueWork(WORK)
            return
        }
        listen(ctx)
        wm.enqueueUniquePeriodicWork(
            WORK, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ArrivalSampleWorker>(15, TimeUnit.MINUTES).build(),
        )
    }

    /** Arm the network callback. It fires once — at once, for a Wi-Fi network already
     *  up — and the system drops it ~5 s after delivering it (2026-10-20: REGISTER
     *  11:22:41.865, RELEASE 11:22:46.915, so the real arrival found nothing listening). */
    private fun listen(ctx: Context) {
        unlisten(ctx)
        try {
            cm(ctx).registerNetworkCallback(
                NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),
                callbackIntent(ctx),
            )
        } catch (e: Exception) {
            Log.w(TAG, "network callback refused: ${e.message}")
        }
    }

    private fun unlisten(ctx: Context) {
        try {
            cm(ctx).unregisterNetworkCallback(callbackIntent(ctx))
        } catch (_: Exception) {
            // not registered
        }
    }

    private fun callbackIntent(ctx: Context): PendingIntent {
        // Mutable: the system fills in which network became available.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getBroadcast(ctx, 7211, Intent(ctx, ArrivalReceiver::class.java), flags)
    }

    /** The sampler: home or away right now; away arms the callback for coming home. */
    fun sample(ctx: Context) {
        if (seen(ctx, currentWifi(ctx)) == "away" && routines(ctx).isNotEmpty()) listen(ctx)
    }

    /** A Wi-Fi network became available. */
    fun onNetwork(ctx: Context, network: Network?) {
        val fp = fingerprintOf(network?.let { cm(ctx).getLinkProperties(it) })
        if (fp.isNotEmpty()) seen(ctx, fp)
    }

    /** Record a sighting and post the routines on arriving. Returns the new last sample. */
    private fun seen(ctx: Context, fp: String): String {
        val (now, arriving) = sighting(fp, homes(ctx), prefs(ctx).getString("last", "") ?: "")
        prefs(ctx).edit().putString("last", now).apply()
        if (arriving) {
            val today = RoutineAlarms.isoDate(System.currentTimeMillis(), TimeZone.getDefault())
            for (name in routines(ctx)) RoutineAlarms.post(ctx, name, today, "You're home: $name")
        }
        return now
    }
}

class ArrivalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        @Suppress("DEPRECATION")
        val network: Network? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(ConnectivityManager.EXTRA_NETWORK, Network::class.java)
        } else {
            intent?.getParcelableExtra(ConnectivityManager.EXTRA_NETWORK)
        }
        ArrivalWatcher.onNetwork(context, network)
    }
}

class ArrivalSampleWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        ArrivalWatcher.sample(applicationContext)
        return Result.success()
    }
}

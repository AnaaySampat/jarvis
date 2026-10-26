package com.jarvis.phone

/** Only the resolved Clock's single timer may be stopped. Never pick an arbitrary
 * alarm, notification or one of several timers. The action belongs to Clock. */
internal data class TimerNotice(val key: String, val pkg: String, val channel: String,
    val summary: Boolean, val actions: List<String>)

internal fun timerCancelAction(notices: List<TimerNotice>, clockPackage: String): Pair<String, Int>? {
    val timers = notices.filter { it.pkg == clockPackage && !it.summary && it.channel.contains("timer", true) }
    val timer = timers.singleOrNull() ?: return null
    val index = timer.actions.indexOfFirst { it.trim().lowercase() in setOf("cancel", "stop", "dismiss") }
    return if (index < 0) null else timer.key to index
}

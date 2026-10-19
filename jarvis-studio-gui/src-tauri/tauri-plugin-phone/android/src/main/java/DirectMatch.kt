package com.jarvis.phone

import java.util.Locale

/**
 * The pure halves of DirectActions — picking a contact and matching a notification
 * to a person — kept free of Android types so the JVM tests can drive them.
 */
internal object DirectMatch {

    /** One phone row from ContactsContract. */
    data class PhoneRow(
        val contactId: Long,
        val name: String,
        val number: String,
        val superPrimary: Boolean,
        val mobile: Boolean,
    )

    sealed class Pick {
        data class One(val name: String, val number: String) : Pick()
        data class Ambiguous(val names: List<String>) : Pick()
        object None : Pick()
    }

    private fun norm(s: String) = s.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")

    /** 0 = exact, 1 = a word of the name starts with the query, 2 = contains, -1 = no match. */
    private fun rank(name: String, query: String): Int {
        val n = norm(name)
        val q = norm(query)
        return when {
            q.isEmpty() -> -1
            n == q -> 0
            n.startsWith(q) || n.split(' ').any { it.startsWith(q) } -> 1
            n.contains(q) -> 2
            else -> -1
        }
    }

    /**
     * The best contact for what the user said. Only the best rank counts: an exact
     * "Mom" beats "Mom Office", but two exact or two prefix hits are a question for the
     * user, never a guess — a message to the wrong person can't be unsent.
     */
    fun pickContact(query: String, rows: List<PhoneRow>): Pick {
        val scored = rows.map { it to rank(it.name, query) }.filter { it.second >= 0 }
        if (scored.isEmpty()) return Pick.None
        val best = scored.minOf { it.second }
        val contacts = scored.filter { it.second == best }.map { it.first }.groupBy { it.contactId }
        if (contacts.size > 1) {
            return Pick.Ambiguous(contacts.values.map { it.first().name }.distinct().take(5))
        }
        val numbers = contacts.values.first()
        val chosen = numbers.firstOrNull { it.superPrimary }
            ?: numbers.firstOrNull { it.mobile }
            ?: numbers.first()
        return Pick.One(chosen.name, chosen.number)
    }

    /** A spoken or typed phone number rather than a name. */
    fun looksLikeNumber(s: String): Boolean {
        val t = s.trim()
        return t.isNotEmpty() && t.all { it.isDigit() || it in "+-() ." } && t.count { it.isDigit() } >= 5
    }

    /**
     * Is this notification title the person (or group)? Apps decorate it: "Mom (2
     * messages)", "Mom:". Exact after stripping that, never a substring — "Al" must not
     * reply to "Alice", and "Mom @ Family" is the Family group, not a chat with Mom.
     */
    fun titleMatches(title: String, person: String): Boolean {
        val p = norm(person)
        if (p.isEmpty()) return false
        val t = norm(title)
            .replace(Regex("\\s*\\(\\d+ (new )?messages?\\)$"), "")
            .removeSuffix(":")
            .trim()
        return t == p
    }
}

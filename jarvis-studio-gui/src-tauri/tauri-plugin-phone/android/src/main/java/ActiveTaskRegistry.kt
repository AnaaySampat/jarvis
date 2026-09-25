package com.jarvis.phone

/**
 * Small synchronized registry used by the foreground supervisor. Keeping this
 * independent of Android makes the multi-task invariants cheap to unit test.
 */
internal class ActiveTaskRegistry(initial: Iterable<String> = emptyList()) {
    private val taskIds = linkedSetOf<String>()

    init {
        initial.filterTo(taskIds) { it.isNotBlank() }
    }

    @Synchronized
    fun add(taskId: String): Boolean = taskId.isNotBlank() && taskIds.add(taskId)

    @Synchronized
    fun remove(taskId: String): Boolean = taskIds.remove(taskId)

    @Synchronized
    fun removeAll(ids: Collection<String>): Int {
        var removed = 0
        ids.forEach { if (taskIds.remove(it)) removed += 1 }
        return removed
    }

    @Synchronized
    fun snapshot(): Set<String> = taskIds.toSet()

    @Synchronized
    fun isEmpty(): Boolean = taskIds.isEmpty()

    @Synchronized
    fun size(): Int = taskIds.size
}

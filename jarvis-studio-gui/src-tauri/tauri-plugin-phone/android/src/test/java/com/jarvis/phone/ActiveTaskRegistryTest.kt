package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveTaskRegistryTest {
    @Test
    fun removingOneTaskNeverDropsAnotherTask() {
        val registry = ActiveTaskRegistry(listOf("task-a", "task-b"))

        assertTrue(registry.remove("task-a"))

        assertEquals(setOf("task-b"), registry.snapshot())
        assertFalse(registry.isEmpty())
        assertEquals(1, registry.size())
    }

    @Test
    fun duplicateAndBlankTaskIdsCannotCorruptTracking() {
        val registry = ActiveTaskRegistry()

        assertFalse(registry.add(""))
        assertTrue(registry.add("task-a"))
        assertFalse(registry.add("task-a"))

        assertEquals(setOf("task-a"), registry.snapshot())
    }

    @Test
    fun snapshotIsDetachedFromLaterMutations() {
        val registry = ActiveTaskRegistry(listOf("task-a"))
        val before = registry.snapshot()

        registry.add("task-b")

        assertEquals(setOf("task-a"), before)
        assertEquals(setOf("task-a", "task-b"), registry.snapshot())
    }

    @Test
    fun bulkPauseRemovalDoesNotDropTaskStartedAfterSnapshot() {
        val registry = ActiveTaskRegistry(listOf("task-a", "task-b"))
        val paused = registry.snapshot()
        registry.add("task-after-pause")

        assertEquals(2, registry.removeAll(paused))

        assertEquals(setOf("task-after-pause"), registry.snapshot())
        assertFalse(registry.isEmpty())
    }
}

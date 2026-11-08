package com.jarvis.phone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DiagnosticExportPolicyTest {
    @Test fun dropsPrivateDataEvenWhenItAppearsInAllowedFieldNames() {
        val secret = "SECRET prompt token message screenshot"
        val source = JSONObject().put("version", 1).put("prompt", secret)
            .put("versions", JSONObject().put("android", "2.5.0").put("windows", secret))
            .put("categories", JSONArray().put("permission").put(secret))
            .put("tasks", JSONArray().put(JSONObject().put("status", "needs_you").put("id", secret)
                .put("elapsed_ms", 2500).put("summary", secret).put("provider_cost", 12)))
        val exported = DiagnosticExportPolicy.sanitize(source.toString())
        assertFalse(exported.contains(secret))
        val task = JSONObject(exported).getJSONArray("tasks").getJSONObject(0)
        assertEquals("task-1", task.getString("id"))
        assertEquals(2500, task.getInt("elapsed_ms"))
        assertTrue(task.isNull("provider_cost"))
    }
    @Test(expected = IllegalArgumentException::class)
    fun refusesUnversionedExports() { DiagnosticExportPolicy.sanitize("{}") }
    @Test fun includesOnlyNumericPerformanceCounters() {
        val secret = "private model route and prompt"
        val row = JSONObject().put("status", "completed").put("instrumentation_version", 2)
            .put("choosing_ms", 50).put("executing_ms", 30).put("fallbacks", 1)
            .put("model_requests", 3).put("verifying_ms", secret).put("provider", secret)
        val source = JSONObject().put("version", 1).put("tasks", JSONArray().put(row))
        val exported = DiagnosticExportPolicy.sanitize(source.toString())
        assertFalse(exported.contains(secret))
        val task = JSONObject(exported).getJSONArray("tasks").getJSONObject(0)
        assertEquals(50, task.getInt("choosing_ms"))
        assertEquals(30, task.getInt("executing_ms"))
        assertEquals(3, task.getInt("model_requests"))
        assertFalse(task.has("verifying_ms"))
    }
}

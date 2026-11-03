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
}

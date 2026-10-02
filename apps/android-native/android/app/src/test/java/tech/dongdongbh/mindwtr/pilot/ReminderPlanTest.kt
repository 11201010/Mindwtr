package tech.dongdongbh.mindwtr.pilot

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/** Core's reminder plan applied in core's order (native-host-contract-reminders.ts), and React Native's old alarms cancelled once. */
class ReminderPlanTest {
    private val events = mutableListOf<String>()
    private var scheduleFailure: Throwable? = null

    private val port = object : ReminderPlan.Port {
        override fun store(entries: Map<String, String>) { events += "store ${entries.values.joinToString(" + ")}" }
        override fun removeDelivered(id: Int) { events += "remove $id" }
        override fun cancel(id: Int) { events += "cancel $id" }
        override fun schedule(alarm: JSONObject) {
            scheduleFailure?.let { throw it }
            events += "schedule ${alarm.getInt("id")} ${alarm.getString("key")}"
        }
        override fun clearDelivered() { events += "clear" }
    }

    private fun alarm(key: String, id: Int, replacing: String?) = JSONObject().put("key", key).put("id", id).put("fireAtMs", 1_000L)
        .put("repeat", "once").put("details", JSONObject().put("title", "t")).put("replacing", replacing ?: JSONObject.NULL)

    private fun plan(writeAhead: String?, cancel: List<Pair<Int, String>>, schedule: List<JSONObject>, clearDelivered: Boolean = false) = JSONObject()
        .put("mode", if (clearDelivered) "revoked" else "active")
        .put("writeAhead", writeAhead ?: JSONObject.NULL)
        .put("cancel", JSONArray(cancel.map { (id, reason) -> JSONObject().put("key", "task:$id").put("id", id).put("reason", reason) }))
        .put("schedule", JSONArray(schedule))
        .put("alarms", "{after}")
        .put("topUpDelayMs", JSONObject.NULL)
        .put("clearDelivered", clearDelivered)

    @Test fun theWriteAheadIsStoredBeforeAnyAlarmChangesAndTheAlarmsLast() {
        ReminderPlan.apply(plan("{ahead}", listOf(7 to "expired"), listOf(alarm("task:a", 11, null))), port)
        assertEquals(listOf("store {ahead}", "cancel 7", "schedule 11 task:a", "store {after}"), events)
    }

    @Test fun aWithdrawnAlarmRemovesWhatItDeliveredFirstAndAnExpiredOneKeepsIt() {
        ReminderPlan.apply(plan("{ahead}", listOf(7 to "withdrawn", 8 to "expired"),
            listOf(alarm("task:a", 11, "withdrawn"), alarm("task:b", 12, "expired"), alarm("task:c", 13, null))), port)
        assertEquals(listOf("store {ahead}", "remove 7", "cancel 7", "cancel 8", "remove 11", "schedule 11 task:a", "schedule 12 task:b",
            "schedule 13 task:c", "store {after}"), events)
    }

    @Test fun aPlanThatMakesNothingStoresOnlyTheAlarms() {
        ReminderPlan.apply(plan(null, listOf(7 to "expired"), emptyList()), port)
        assertEquals(listOf("cancel 7", "store {after}"), events)
    }

    @Test fun theNativeStateIsStoredWithTheAlarmsInOneWrite() {
        val keys = mutableListOf<Set<String>>()
        val recording = object : ReminderPlan.Port by port {
            override fun store(entries: Map<String, String>) { keys += entries.keys; port.store(entries) }
        }
        ReminderPlan.apply(plan(null, listOf(7 to "expired"), emptyList()).put("state", "{delivered}"), recording)
        ReminderPlan.apply(plan(null, emptyList(), emptyList()).put("unchanged", true).put("state", "{none}"), recording)
        assertEquals(listOf("cancel 7", "store {after} + {delivered}", "store {none}"), events)
        assertEquals(listOf(setOf(ReminderPlan.MAP_KEY, ReminderPlan.STATE_KEY), setOf(ReminderPlan.STATE_KEY)), keys)
    }

    @Test fun aPlanThatChangesNothingWritesNothing() {
        ReminderPlan.apply(plan(null, emptyList(), emptyList()).put("unchanged", true), port)
        assertEquals(emptyList<String>(), events)
    }

    @Test fun reactNativesMapsAreRemovedOnlyWhenTheyExist() {
        RnAlarmCleanup.run(rows = { emptyList() }, cancel = { events += "cancel $it" }, stripButtons = { events += "strip" }, forgetMaps = { events += "forget" }, deleteTable = { events += "delete" })
        assertEquals(listOf("strip", "forget", "delete"), events)
    }

    @Test fun noPermissionClearsTheDeliveredRemindersBeforeTheEmptyMapIsStored() {
        ReminderPlan.apply(plan(null, listOf(7 to "withdrawn"), emptyList(), clearDelivered = true), port)
        assertEquals(listOf("remove 7", "cancel 7", "clear", "store {after}"), events)
    }

    @Test fun aRefusedAlarmLeavesTheWriteAheadStoredSoTheNextPlanMakesItAgain() {
        scheduleFailure = SecurityException("Too many alarms")
        assertThrows(SecurityException::class.java) {
            ReminderPlan.apply(plan("{ahead}", emptyList(), listOf(alarm("task:a", 11, null))), port)
        }
        assertEquals(listOf("store {ahead}"), events)
    }

    @Test fun aRemovalThatFailsNeverStopsTheCancel() {
        val failing = object : ReminderPlan.Port by port {
            override fun removeDelivered(id: Int) { events += "remove $id"; throw IllegalStateException("gone") }
        }
        ReminderPlan.apply(plan(null, listOf(7 to "withdrawn"), emptyList()), failing)
        assertEquals(listOf("remove 7", "cancel 7", "store {after}"), events)
    }

    @Test fun theCheckpointsSitAfterTheWriteAheadAndAfterTheAlarmsAreMade() {
        ReminderPlan.apply(plan("{ahead}", emptyList(), listOf(alarm("task:a", 11, null))), port) { events += "checkpoint $it" }
        assertEquals(listOf("store {ahead}", "checkpoint write-ahead", "schedule 11 task:a", "checkpoint scheduled", "store {after}"), events)
    }

    @Test fun aRepeatingAlarmComesBackAtTheSameLocalTimeAfterItsTimeHasPassed() {
        val zone = TimeZone.getTimeZone("Europe/Berlin")
        fun at(year: Int, month: Int, day: Int, hour: Int) = Calendar.getInstance(zone).apply { clear(); set(year, month - 1, day, hour, 30) }.timeInMillis
        // Daily at 08:30 local, across the March clock change.
        assertEquals(at(2026, 3, 30, 8), ReminderPlan.nextRepeat(at(2026, 3, 28, 8), "daily", at(2026, 3, 29, 9), zone))
        // Weekly, three weeks stale: the first one still ahead.
        assertEquals(at(2026, 10, 22, 8), ReminderPlan.nextRepeat(at(2026, 10, 1, 8), "weekly", at(2026, 10, 21, 9), zone))
        assertEquals(null, ReminderPlan.nextRepeat(at(2026, 10, 1, 8), "once", at(2026, 10, 21, 9), zone))
    }

    @Test fun reactNativesAlarmsAreCancelledBeforeItsMapGoesAndTheTableLast() {
        val done = RnAlarmCleanup.run(rows = { listOf(1_790_000_001, 1_790_000_002) }, cancel = { events += "cancel $it" },
            stripButtons = { events += "strip" }, forgetMaps = { events += "forget" }, deleteTable = { events += "delete" })
        assertEquals(2, done)
        // RN's delivered reminders lose their buttons (they target RN's receiver, which is gone) while RN's inventory still exists.
        assertEquals(listOf("cancel 1790000001", "cancel 1790000002", "strip", "forget", "delete"), events)
    }

    @Test fun aCleanupStoppedPartWayKeepsTheMapAndTheTableForTheNextStart() {
        assertThrows(IllegalStateException::class.java) {
            RnAlarmCleanup.run(rows = { listOf(1, 2) }, cancel = { events += "cancel $it"; if (it == 2) throw IllegalStateException("stopped") },
                stripButtons = { events += "strip" }, forgetMaps = { events += "forget" }, deleteTable = { events += "delete" })
        }
        assertEquals(listOf("cancel 1", "cancel 2"), events)
    }

    @Test fun aReactNativeRowThatCannotBeReadFailsTheCleanupAndKeepsEverything() {
        assertEquals(listOf(1_790_000_001), RnAlarmCleanup.requestCodes(listOf("""{"alarmId":1790000001,"id":3}""")))
        for (row in listOf(null, "{not json", """{"id":3}""", """{"alarmId":"x"}""")) {
            assertThrows(IllegalStateException::class.java) { RnAlarmCleanup.requestCodes(listOf("""{"alarmId":1}""", row)) }
        }
        assertThrows(IllegalStateException::class.java) {
            RnAlarmCleanup.run(rows = { RnAlarmCleanup.requestCodes(listOf("{not json")) }, cancel = { events += "cancel $it" },
                stripButtons = { events += "strip" }, forgetMaps = { events += "forget" }, deleteTable = { events += "delete" })
        }
        assertEquals(emptyList<String>(), events)
    }

    @Test fun onlyAMissingTableReadsAsNoReactNativeAlarm() {
        assertEquals(true, RnAlarmCleanup.isMissingTable(RuntimeException("no such table: alarmtbl (code 1 SQLITE_ERROR)")))
        assertEquals(false, RnAlarmCleanup.isMissingTable(RuntimeException("database disk image is malformed (code 11)")))
        assertEquals(false, RnAlarmCleanup.isMissingTable(RuntimeException("no such column: gson_data")))
    }

    @Test fun noReactNativeTableMeansNothingToDo() {
        assertEquals(0, RnAlarmCleanup.run(rows = { null }, cancel = { events += "cancel $it" }, stripButtons = { events += "strip" }, forgetMaps = { events += "forget" }, deleteTable = { events += "delete" }))
        assertEquals(emptyList<String>(), events)
    }
}

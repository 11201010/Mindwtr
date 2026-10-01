package tech.dongdongbh.mindwtr.pilot

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.RnKeyValue
import tech.dongdongbh.mindwtr.pilot.core.debugProperty
import java.util.Calendar
import java.util.TimeZone

/*
 * Reminder alarms on AlarmManager, as React Native's patched alarm library (react-native-alarm-notification, patched by
 * plugins/patch-alarm-notification-gradle.js) sets and shows them. Core decides every alarm: which, when, its id, why one goes,
 * and when to plan again (native-host-contract-reminders.ts; bundle/host-reminders.ts runs the timers in the engine). Kotlin
 * applies core's plan in core's order, posts what a fired alarm carries, and hands Done and Snooze to CoreWork.
 */

/** Core's plan applied in core's order, apart from Android (JVM-tested: ReminderPlanTest). */
internal object ReminderPlan {
    /** RN's alarm map in RN's RKStorage (core's REMINDER_ALARM_MAP_STORAGE_KEY). */
    const val MAP_KEY = "mindwtr:local:alarms:v1"

    interface Port {
        /** RN's alarm map, on disk before this returns. */
        fun store(map: String)
        /** The notification alarm [id] delivered, if it is still shown. */
        fun removeDelivered(id: Int)
        fun cancel(id: Int)
        /** Core's alarm (NativeReminderAlarm) under its id: an alarm held under that id is replaced. */
        fun schedule(alarm: JSONObject)
        /** Every delivered reminder notification: no notification permission. */
        fun clearDelivered()
    }

    /**
     * [plan] (core's NativeReminderAlarmPlan): `writeAhead` stored (on disk), then each cancel, then each alarm made, then `alarms`
     * stored. A withdrawn alarm's delivered notification goes before its cancel; an expired one's stays. A failed removal never
     * stops a cancel. A refused alarm throws before `alarms` is stored: the next plan, from `writeAhead`, makes the pending alarms
     * again under the same ids, so nothing is made twice or left behind. [checkpoint] names each point a process death is safe at.
     */
    fun apply(plan: JSONObject, port: Port, checkpoint: (String) -> Unit = {}) {
        if (!plan.isNull("writeAhead")) {
            port.store(plan.getString("writeAhead"))
            checkpoint("write-ahead")
        }
        val cancel = plan.getJSONArray("cancel")
        for (index in 0 until cancel.length()) {
            val item = cancel.getJSONObject(index)
            val id = item.getInt("id")
            if (item.getString("reason") == "withdrawn") runCatching { port.removeDelivered(id) }
            port.cancel(id)
        }
        val schedule = plan.getJSONArray("schedule")
        for (index in 0 until schedule.length()) {
            val alarm = schedule.getJSONObject(index)
            if (alarm.optString("replacing") == "withdrawn") runCatching { port.removeDelivered(alarm.getInt("id")) }
            port.schedule(alarm)
        }
        checkpoint("scheduled")
        if (plan.optBoolean("clearDelivered")) runCatching { port.clearDelivered() }
        port.store(plan.getString("alarms"))
    }

    /**
     * A repeating alarm's next time after [nowMs], at the same local time a day or a week on, as RN's library re-arms one when it
     * fires (AlarmUtil.rescheduleRepeatingAlarm). Null for a one-shot alarm.
     */
    fun nextRepeat(fireAtMs: Long, repeat: String, nowMs: Long, zone: TimeZone = TimeZone.getDefault()): Long? {
        val field = when (repeat) {
            "daily" -> Calendar.DAY_OF_YEAR
            "weekly" -> Calendar.WEEK_OF_YEAR
            else -> return null
        }
        val next = Calendar.getInstance(zone).apply { timeInMillis = fireAtMs }
        // ponytail: steps one at a time; a weekly alarm stale for years is a few hundred steps.
        do next.add(field, 1) while (next.timeInMillis <= nowMs)
        return next.timeInMillis
    }
}

/**
 * React Native's alarms, cancelled once at the first native start, before the first plan (JVM-tested: ReminderPlanTest). RN's
 * library keeps them in `databases/rnandb`, table `alarmtbl`; each is a broadcast to its AlarmReceiver under the request code in
 * the row's `alarmId`. Their order makes a process death safe anywhere: every alarm is cancelled, then RN's maps go (core plans
 * every alarm afresh, and RN's Pomodoro record no longer names a cancelled alarm), then the table. Until the table is gone each
 * start runs it again, and cancelling twice is harmless; no plan runs before it finished.
 */
internal object RnAlarmCleanup {
    /** [rows]: each RN alarm's request code, null when RN left no table. The number cancelled. */
    fun run(rows: () -> List<Int>?, cancel: (Int) -> Unit, forgetMaps: () -> Unit, deleteTable: () -> Unit): Int {
        val ids = rows() ?: return 0
        ids.forEach(cancel)
        forgetMaps()
        deleteTable()
        return ids.size
    }
}

/**
 * The Android side of core's reminder alarms (CoreHost's alarm bridges): AlarmManager, the tray, RN's old alarms. Called on the
 * engine thread, which alone opens RKStorage.
 */
internal class ReminderAlarms(private val context: Context, private val keyValue: RnKeyValue) : CoreHost.Reminders, ReminderPlan.Port {
    companion object {
        /** Core's POMODORO_ALARM_STORAGE_KEY: RN's record of its Pomodoro alarm. */
        private const val POMODORO_KEY = "mindwtr:local:pomodoro-alarm:v1"
        /** RN's library, which no longer exists here: its alarms are cancelled through its component name. */
        private const val RN_RECEIVER = "com.emekalites.react.alarm.notification.AlarmReceiver"
        private const val RN_DATABASE = "rnandb"
        const val FIRE = "tech.dongdongbh.mindwtr.reminder.FIRE"
        /** The alarm (core's NativeReminderAlarm, with the channel's name), as JSON. */
        const val EXTRA_ALARM = "alarm"

        private fun fireIntent(context: Context) = Intent(context, ReminderAlarmReceiver::class.java).setAction(FIRE)

        /**
         * Alarm [alarm] under its id (a held alarm under that id is replaced), as RN's library sets one: exact while Android allows
         * exact alarms (Android 12+ asks the user), else inexact but still allowed while idle.
         */
        fun arm(context: Context, alarm: JSONObject) {
            val manager = context.getSystemService(AlarmManager::class.java)
            val intent = PendingIntent.getBroadcast(context, alarm.getInt("id"), fireIntent(context).putExtra(EXTRA_ALARM, alarm.toString()),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val at = alarm.getLong("fireAtMs")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            }
        }

        /** RN's exact-alarm check (exact-alarm-permission.ts): only Android 12+ can withhold exact alarms. */
        fun exactAlarmsDenied(context: Context): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && !context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

        /** Android's Alarms & reminders page for this app (RN's openExactAlarmSettings). */
        fun openExactAlarmSettings(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
            runCatching { context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }
                .onFailure { Log.w(CoreHost.TAG, "Native Android exact-alarm settings not opened", it) }
        }

        /** RN's rule (getAndroidNotificationPermissionStatus): before Android 13 notifications need no permission. */
        fun permissionGranted(context: Context): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)
    /** The reminder channel's name core sent with the plan (core's REMINDER_NOTIFICATION_CHANNEL_NAME). */
    private var channelName = ""

    override fun apply(plan: String) {
        val parsed = JSONObject(plan)
        channelName = parsed.optString("channelName")
        ReminderPlan.apply(parsed, this) { point ->
            // Debug builds only (check-reminders-device.mjs): `debug.mindwtr.native.reminder_stop=<point>` kills the process there.
            if (debugProperty("reminder_stop") == point) {
                Log.i(CoreHost.TAG, "Native Android reminder stop at=$point")
                android.os.Process.killProcess(android.os.Process.myPid())
            }
        }
    }

    override fun permissionGranted() = permissionGranted(context)

    override fun cleanupRn(): Int = RnAlarmCleanup.run(rows = ::rnAlarmIds, cancel = ::cancelRn,
        forgetMaps = { keyValue.multiRemove(listOf(ReminderPlan.MAP_KEY, POMODORO_KEY)); Unit },
        deleteTable = { check(context.deleteDatabase(RN_DATABASE) || !context.getDatabasePath(RN_DATABASE).exists()) { "Cannot delete $RN_DATABASE" } })

    override fun store(map: String) { keyValue.set(ReminderPlan.MAP_KEY, map) }

    override fun removeDelivered(id: Int) = notifications.cancel(id)

    override fun cancel(id: Int) {
        PendingIntent.getBroadcast(context, id, fireIntent(context), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let {
            alarms.cancel(it)
            it.cancel()
        }
    }

    override fun schedule(alarm: JSONObject) = arm(context, JSONObject(alarm.toString()).put("channelName", channelName))

    override fun clearDelivered() {
        for (shown in notifications.activeNotifications) {
            if (NotificationCompat.getChannelId(shown.notification) == CoreNotifications.REMINDER_CHANNEL) notifications.cancel(shown.tag, shown.id)
        }
    }

    /** Each RN alarm's request code (its row's `alarmId`); null when RN left no alarm database. */
    private fun rnAlarmIds(): List<Int>? {
        val file = context.getDatabasePath(RN_DATABASE)
        if (!file.exists()) return null
        return SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            // A database RN never gave its table (a stop inside onCreate) holds no alarm.
            val cursor = runCatching { database.rawQuery("SELECT gson_data FROM alarmtbl", null) }.getOrNull() ?: return emptyList()
            cursor.use { rows ->
                buildList { while (rows.moveToNext()) runCatching { JSONObject(rows.getString(0)).getInt("alarmId") }.onSuccess(::add) }
            }
        }
    }

    /** RN's alarm [id] as RN's library cancels it (AlarmUtil.stopAlarm): its explicit broadcast under that request code. */
    private fun cancelRn(id: Int) {
        val intent = Intent().setComponent(ComponentName(context.packageName, RN_RECEIVER))
        PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let {
            alarms.cancel(it)
            it.cancel()
        }
    }
}

/** An alarm fired: its notification, as RN's AlarmReceiver posts it; a repeating alarm comes back at the same local time. */
class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ReminderAlarms.FIRE) return
        val alarm = runCatching { JSONObject(intent.getStringExtra(ReminderAlarms.EXTRA_ALARM)!!) }.getOrNull() ?: return
        runCatching { CoreNotifications.postReminder(context, alarm) }.onFailure { Log.w(CoreHost.TAG, "Native Android reminder not posted", it) }
        runCatching {
            ReminderPlan.nextRepeat(alarm.getLong("fireAtMs"), alarm.optString("repeat"), System.currentTimeMillis())
                ?.let { next -> ReminderAlarms.arm(context, alarm.put("fireAtMs", next)) }
        }.onFailure { Log.w(CoreHost.TAG, "Native Android repeating reminder not re-armed", it) }
    }
}

/**
 * A reminder notification's buttons, as RN's AlarmReceiver takes them: Dismiss clears it; Done and Snooze go to CoreWork as core's
 * journaled commands under the request UUID the notification was posted with, so a second tap or a retry is the same request.
 * Snooze sends the tap's time with it. The notification goes once the job is queued. Not exported: only this app's notifications
 * send these.
 */
class ReminderActionReceiver : BroadcastReceiver() {
    companion object {
        const val COMPLETE = "ACTION_COMPLETE"
        const val SNOOZE = "ACTION_SNOOZE"
        const val DISMISS = "ACTION_DISMISS"
        const val EXTRA_ID = "notificationId"
        const val EXTRA_REQUEST = "requestId"
        const val EXTRA_TASK = "taskId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra(EXTRA_ID, 0)
        runCatching {
            when (intent.action) {
                DISMISS -> Unit
                COMPLETE -> CoreWork.enqueue(context, CoreJob.REMINDER_DONE, mapOf(
                    "requestId" to intent.getStringExtra(EXTRA_REQUEST)!!, "taskId" to intent.getStringExtra(EXTRA_TASK)!!))
                SNOOZE -> {
                    val alarm = JSONObject(intent.getStringExtra(ReminderAlarms.EXTRA_ALARM)!!)
                    val details = alarm.getJSONObject("details")
                    // Debug builds only (check-reminders-device.mjs): `debug.mindwtr.native.snooze_minutes` shortens RN's 10 minutes.
                    debugProperty("snooze_minutes").toDoubleOrNull()?.let { details.put("snooze_interval", it) }
                    CoreWork.enqueue(context, CoreJob.REMINDER_SNOOZE, mapOf("requestId" to intent.getStringExtra(EXTRA_REQUEST)!!,
                        "requestedAt" to System.currentTimeMillis().toString(), "details" to details.toString(),
                        "channelName" to alarm.optString("channelName")))
                }
                else -> return
            }
            context.getSystemService(NotificationManager::class.java).cancel(id)
        }.onFailure { Log.w(CoreHost.TAG, "Native Android reminder action not queued action=${intent.action}", it) }
    }
}

/**
 * Plans the alarms again after a reboot, a clock or time zone change, or an update (RN's library re-arms only after a reboot), and
 * remakes them exact once Android allows exact alarms (RN's rescheduleLocalAlarmsAsExact). Exported as RN's boot receiver is: each
 * of these actions only the system sends. CoreWork runs core's plan; nothing here decides an alarm.
 */
class ReminderRescheduleReceiver : BroadcastReceiver() {
    companion object {
        /** Debug builds only (check-reminders-device.mjs): the same path as a reboot (`mode` cycle) or an exact-alarm grant (exact). */
        const val DEBUG_RESCHEDULE = "tech.dongdongbh.mindwtr.debug.RESCHEDULE_REMINDERS"
        private val CYCLE = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_MY_PACKAGE_REPLACED)
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val mode = when {
            action in CYCLE -> "cycle"
            action == AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> "exact"
            action == DEBUG_RESCHEDULE && BuildConfig.DEBUG -> intent.getStringExtra("mode")?.takeIf { it == "exact" } ?: "cycle"
            else -> return
        }
        Log.i(CoreHost.TAG, "Native Android reminders reschedule action=$action mode=$mode")
        runCatching { CoreWork.enqueue(context, CoreJob.REMINDERS, mapOf("mode" to mode)) }
            .onFailure { Log.w(CoreHost.TAG, "Native Android reminders reschedule not queued", it) }
    }
}

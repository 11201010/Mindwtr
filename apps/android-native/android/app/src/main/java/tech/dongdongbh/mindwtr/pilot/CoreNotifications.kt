package tech.dongdongbh.mindwtr.pilot

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * A notification shown now, as RN shows one (react-native-alarm-notification's sendNotification, patched), from core's
 * details (buildImmediateNotificationDetails; host-entry adds the channel's name). Kotlin reads the details; it decides none.
 */
internal object CoreNotifications {
    /** Posts [details]; false when Android drops it (no notification permission, Android 13+). */
    fun post(context: Context, details: JSONObject): Boolean {
        val channel = details.getString("channel")
        val color = details.optString("color").takeIf { it.isNotEmpty() }?.let(Color::parseColor)
        ensureChannel(context, channel, details.getString("channelName"), color)
        val title = details.getString("title")
        val message = details.getString("message")
        val sound = if (details.optBoolean("play_sound", true)) Settings.System.DEFAULT_NOTIFICATION_URI else null
        // RN's notification ID: the send time in seconds.
        val id = (System.currentTimeMillis() / 1000).toInt()
        // A tap opens the app with the notification's data as extras, as RN's library passes them (the tap's route: the reminders pass).
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        details.optJSONObject("data")?.let { data -> data.keys().forEach { key -> open.putExtra(key, data.getString(key)) } }
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(context.resources.getIdentifier(details.optString("small_icon", "ic_launcher"), "mipmap", context.packageName))
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(details.optBoolean("auto_cancel", true))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setSound(sound)
            .setContentIntent(PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .apply {
                color?.let(::setColor)
                if (details.optBoolean("use_big_text")) setStyle(NotificationCompat.BigTextStyle().bigText(message))
            }
            .build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, notification)
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** RN's reminder channel as RN makes it at start (NotificationOpenIntentsModule.ensureReminderChannel), once; its light in core's color. */
    private fun ensureChannel(context: Context, id: String, name: String, color: Int?) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(id) != null) return
        manager.createNotificationChannel(NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = name
            enableLights(true)
            color?.let { lightColor = it }
            enableVibration(false)
            setSound(Settings.System.DEFAULT_NOTIFICATION_URI, AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
        })
    }
}

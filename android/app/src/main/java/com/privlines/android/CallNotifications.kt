package com.privlines.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

object CallNotifications {
    const val EXTRA_ACTION = "com.privlines.android.CALL_ACTION"
    const val EXTRA_CALL_ID = "com.privlines.android.CALL_ID"
    const val ACTION_CALL_ENDED = "com.privlines.android.CALL_ENDED"
    private const val CHANNEL_ID = "privlines_incoming_calls"
    private const val MESSAGE_CHANNEL_ID = "privlines_messages"

    fun showIncoming(context: Context, callId: String, callerName: String, video: Boolean) {
        if (callId.isBlank()) return
        createChannel(context)

        val caller = Person.Builder()
            .setName(callerName.ifBlank { "PrivLines-Kontakt" })
            .setImportant(true)
            .build()
        val answer = actionIntent(context, callId, "answer", 1)
        val decline = actionIntent(context, callId, "reject", 2)
        val open = incomingActivityIntent(context, callId, caller.name?.toString().orEmpty(), video)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_call)
            .setContentTitle(if (video) "Eingehender Videoanruf" else "Eingehender Anruf")
            .setContentText(caller.name?.toString() ?: "PrivLines-Kontakt")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(90_000L)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
            .setColor(0xFF16C784.toInt())
            .setColorized(true)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(notificationId(callId), notification)
        } catch (_: SecurityException) {
            // Android 13+: the app can receive a push even if notifications were denied.
        }
    }

    fun cancel(context: Context, callId: String) {
        if (callId.isBlank()) return
        NotificationManagerCompat.from(context).cancel(notificationId(callId))
    }

    fun showMessage(context: Context, title: String, body: String, notificationKey: String) {
        createMessageChannel(context)
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId("message:$notificationKey"),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, MESSAGE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_call)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(notificationId("message:$notificationKey"), notification)
        } catch (_: SecurityException) {
            // Android 13+: notification permission is optional and may be denied.
        }
    }

    fun notificationId(callId: String): Int = callId.hashCode() and 0x7fffffff

    private fun actionIntent(context: Context, callId: String, action: String?, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL_ID, callId)
        if (action != null) intent.putExtra(EXTRA_ACTION, action)
        return PendingIntent.getActivity(
            context,
            notificationId(callId) xor requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun incomingActivityIntent(context: Context, callId: String, callerName: String, video: Boolean): PendingIntent {
        val intent = Intent(context, IncomingCallActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra("com.privlines.android.CALLER_NAME", callerName)
            .putExtra("com.privlines.android.CALL_IS_VIDEO", video)
        return PendingIntent.getActivity(
            context,
            notificationId(callId) xor 3,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "PrivLines-Anrufe",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Eingehende Sprach- und Videoanrufe"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun createMessageChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(MESSAGE_CHANNEL_ID, "PrivLines-Nachrichten", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }
}

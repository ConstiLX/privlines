package com.privlines.android

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PrivLinesMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("privlines", MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["kind"]) {
            "call" -> {
                val callId = data["callId"].orEmpty()
                if (PrivLinesActivityState.isForeground && callId in PrivLinesActivityState.activeCallIds) {
                    CallNotifications.cancel(this, callId)
                } else {
                    CallNotifications.showIncoming(
                        context = this,
                        callId = callId,
                        callerName = data["callerName"] ?: data["title"].orEmpty(),
                        video = data["video"] == "true"
                    )
                }
            }
            "call-ended" -> {
                val callId = data["callId"].orEmpty()
                PrivLinesActivityState.activeCallIds.remove(callId)
                CallNotifications.cancel(this, callId)
                sendBroadcast(
                    Intent(CallNotifications.ACTION_CALL_ENDED)
                        .setPackage(packageName)
                        .putExtra(CallNotifications.EXTRA_CALL_ID, callId)
                )
            }
            else -> {
                val chatId = data["chatId"].orEmpty()
                val isOpenChat = chatId.isNotBlank() && PrivLinesActivityState.isForeground && PrivLinesActivityState.activeChatId == chatId
                if (!isOpenChat) {
                    data["senderId"]?.toLongOrNull()?.let { senderId ->
                        val preferences = getSharedPreferences("privlines_unread", MODE_PRIVATE)
                        val unread = preferences.getStringSet("sender_ids", emptySet()).orEmpty().toMutableSet()
                        unread.add(senderId.toString())
                        preferences.edit().putStringSet("sender_ids", unread).apply()
                    }
                    CallNotifications.showMessage(
                        context = this,
                        title = data["title"] ?: "PrivLines",
                        body = data["body"] ?: "Du hast eine neue Benachrichtigung.",
                        notificationKey = data["kind"].orEmpty() + chatId + data["url"].orEmpty()
                    )
                }
            }
        }
    }
}

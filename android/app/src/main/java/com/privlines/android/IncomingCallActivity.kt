package com.privlines.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class IncomingCallActivity : AppCompatActivity() {
    private val timeoutHandler = Handler(Looper.getMainLooper())
    private val closeScreen = Runnable { finish() }
    private var receiverRegistered = false
    private val callEndedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.getStringExtra(CallNotifications.EXTRA_CALL_ID) == getCallId()) finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (android.os.Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.rgb(5, 5, 5)
        window.navigationBarColor = Color.rgb(5, 5, 5)

        val callId = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID).orEmpty()
        val callerName = intent.getStringExtra("com.privlines.android.CALLER_NAME").orEmpty()
        val isVideo = intent.getBooleanExtra("com.privlines.android.CALL_IS_VIDEO", false)
        val textColor = Color.WHITE

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 48, 32, 48)
            setBackgroundColor(Color.rgb(5, 5, 5))
        }
        val title = TextView(this).apply {
            text = if (isVideo) "Eingehender Videoanruf" else "Eingehender Anruf"
            textSize = 18f
            setTextColor(0xFF16C784.toInt())
            gravity = Gravity.CENTER
        }
        val caller = TextView(this).apply {
            text = callerName.ifBlank { "PrivLines-Kontakt" }
            textSize = 30f
            setTextColor(textColor)
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 48)
        }
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val decline = Button(this).apply {
            text = "Ablehnen"
            setTextColor(Color.WHITE)
            setBackgroundColor(0xFFDC3545.toInt())
            setOnClickListener { continueCall(callId, "reject") }
        }
        val answer = Button(this).apply {
            text = "Annehmen"
            setTextColor(Color.WHITE)
            setBackgroundColor(0xFF16C784.toInt())
            setOnClickListener { continueCall(callId, "answer") }
        }
        actions.addView(decline, LinearLayout.LayoutParams(0, 56, 1f).apply { marginEnd = 12 })
        actions.addView(answer, LinearLayout.LayoutParams(0, 56, 1f).apply { marginStart = 12 })
        root.addView(title)
        root.addView(caller)
        root.addView(actions)
        setContentView(root)

        timeoutHandler.postDelayed(closeScreen, 90_000L)
    }

    private fun continueCall(callId: String, action: String) {
        CallNotifications.cancel(this, callId)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(CallNotifications.EXTRA_CALL_ID, callId)
                .putExtra(CallNotifications.EXTRA_ACTION, action)
        )
        finish()
    }

    override fun onDestroy() {
        timeoutHandler.removeCallbacks(closeScreen)
        super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            callEndedReceiver,
            IntentFilter(CallNotifications.ACTION_CALL_ENDED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        receiverRegistered = true
    }

    override fun onResume() {
        super.onResume()
        PrivLinesActivityState.isForeground = true
    }

    override fun onPause() {
        PrivLinesActivityState.isForeground = false
        super.onPause()
    }

    override fun onStop() {
        if (receiverRegistered) {
            unregisterReceiver(callEndedReceiver)
            receiverRegistered = false
        }
        super.onStop()
    }

    private fun getCallId(): String = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID).orEmpty()
}

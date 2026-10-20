package com.privlines.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var waitingForWebPermission: PermissionRequest? = null
    private var uploadCallback: ValueCallback<Array<Uri>>? = null
    private var fcmToken: String? = null

    private val webPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val request = waitingForWebPermission ?: return@registerForActivityResult
        waitingForWebPermission = null
        val allGranted = permissions.values.all { it }
        if (allGranted) request.grant(request.resources) else request.deny()
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) explainFullScreenCallPermissionIfNeeded()
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        uploadCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
        uploadCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(5, 5, 5)
        window.navigationBarColor = android.graphics.Color.rgb(5, 5, 5)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            addJavascriptInterface(PrivLinesBridge(this@MainActivity), "PrivLinesNative")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url
                    val baseHost = Uri.parse(BuildConfig.PRIVLINES_BASE_URL).host
                    if (target.scheme == "https" && target.host == baseHost) return false
                    if (target.scheme == "http" || target.scheme == "https") {
                        startActivity(Intent(Intent.ACTION_VIEW, target))
                        return true
                    }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    fcmToken?.let(::sendPushTokenToPage)
                    sendUnreadToPage()
                    sendPendingCallActionToPage()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    uploadCallback?.onReceiveValue(null)
                    uploadCallback = filePathCallback
                    return try {
                        val chooserIntent = fileChooserParams?.createIntent()
                        if (chooserIntent == null) {
                            uploadCallback?.onReceiveValue(null)
                            uploadCallback = null
                            return false
                        }
                        fileChooserLauncher.launch(chooserIntent)
                        true
                    } catch (_: Exception) {
                        uploadCallback?.onReceiveValue(null)
                        uploadCallback = null
                        false
                    }
                }

                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        val androidPermissions = request.resources.mapNotNull { resource ->
                            when (resource) {
                                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                                else -> null
                            }
                        }.distinct()
                        val unsupported = request.resources.any { resource ->
                            resource != PermissionRequest.RESOURCE_AUDIO_CAPTURE &&
                                resource != PermissionRequest.RESOURCE_VIDEO_CAPTURE
                        }
                        if (unsupported) {
                            request.deny()
                            return@runOnUiThread
                        }
                        val missing = androidPermissions.filter {
                            ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED
                        }
                        if (missing.isEmpty()) {
                            request.grant(request.resources)
                        } else {
                            waitingForWebPermission = request
                            webPermissionLauncher.launch(missing.toTypedArray())
                        }
                    }
                }
            }
        }
        setContentView(webView)
        requestNotificationPermissionIfNeeded()
        if (FirebaseApp.getApps(this).isNotEmpty()) {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    fcmToken = token
                    sendPushTokenToPage(token)
                }
        }
        loadFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loadFromIntent(intent)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (!::webView.isInitialized) {
            super.onBackPressed()
            return
        }
        webView.evaluateJavascript(
            "(function(){var b=document.getElementById('mobileBackButton');if(b&&getComputedStyle(b).display!=='none'){b.click();return true;}var s=document.getElementById('schoolChannelBack');if(s&&getComputedStyle(s).display!=='none'){s.click();return true;}return false;})()"
        ) { handled ->
            if (handled != "true") {
                if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        PrivLinesActivityState.isForeground = true
    }

    override fun onPause() {
        PrivLinesActivityState.isForeground = false
        super.onPause()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            explainFullScreenCallPermissionIfNeeded()
        }
    }

    private fun explainFullScreenCallPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT < 34) return
        if (!androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        val manager = getSystemService(android.app.NotificationManager::class.java)
        if (manager.canUseFullScreenIntent()) return
        AlertDialog.Builder(this)
            .setTitle("Anrufe auf dem Sperrbildschirm")
            .setMessage("Erlaube PrivLines Vollbild-Anrufe, damit eingehende Anrufe den Bildschirm einschalten und direkt angezeigt werden können.")
            .setNegativeButton("Später", null)
            .setPositiveButton("Einstellungen") { _, _ ->
                startActivity(
                    Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                        .setData(Uri.parse("package:$packageName"))
                )
            }
            .show()
    }

    private fun loadFromIntent(intent: Intent?) {
        val action = intent?.getStringExtra(CallNotifications.EXTRA_ACTION)
        val callId = intent?.getStringExtra(CallNotifications.EXTRA_CALL_ID)
        val target = Uri.parse(BuildConfig.PRIVLINES_BASE_URL).buildUpon()
            .appendPath("chat.html")
            .apply {
                if (action != null && callId != null) {
                    appendQueryParameter("nativeCallAction", action)
                    appendQueryParameter("nativeCallId", callId)
                }
            }
            .build()
        webView.loadUrl(target.toString())
    }

    private fun sendPushTokenToPage(token: String) {
        if (!::webView.isInitialized) return
        val quotedToken = JSONObject.quote(token)
        webView.post {
            webView.evaluateJavascript(
                "window.privLinesRegisterAndroidPushToken?.($quotedToken)",
                null
            )
        }
    }

    private fun sendUnreadToPage() {
        if (!::webView.isInitialized) return
        val unread = getSharedPreferences("privlines_unread", MODE_PRIVATE)
            .getStringSet("sender_ids", emptySet()).orEmpty()
        val json = org.json.JSONArray().apply { unread.forEach(::put) }.toString()
        webView.post { webView.evaluateJavascript("window.privLinesSyncNativeUnread?.($json)", null) }
    }

    private fun sendPendingCallActionToPage() {
        val action = intent?.getStringExtra(CallNotifications.EXTRA_ACTION) ?: return
        val callId = intent?.getStringExtra(CallNotifications.EXTRA_CALL_ID) ?: return
        val json = JSONObject()
            .put("action", action)
            .put("callId", callId)
            .toString()
        webView.evaluateJavascript("window.__privLinesNativeCallAction = ${JSONObject.quote(json)}.length ? JSON.parse(${JSONObject.quote(json)}) : null", null)
    }

    inner class PrivLinesBridge(private val activity: MainActivity) {
        @android.webkit.JavascriptInterface
        fun clearUnreadForContact(userId: String?) {
            val id = userId?.toLongOrNull()?.toString() ?: return
            val preferences = getSharedPreferences("privlines_unread", MODE_PRIVATE)
            val unread = preferences.getStringSet("sender_ids", emptySet()).orEmpty().toMutableSet()
            unread.remove(id)
            preferences.edit().putStringSet("sender_ids", unread).apply()
        }

        @android.webkit.JavascriptInterface
        fun setActiveChatId(chatId: String?) {
            PrivLinesActivityState.activeChatId = chatId?.takeIf { it.isNotBlank() }
        }

        @android.webkit.JavascriptInterface
        fun clearIncomingCall(callId: String) {
            if (PrivLinesActivityState.isForeground) {
                PrivLinesActivityState.activeCallIds.add(callId)
                CallNotifications.cancel(activity, callId)
            }
        }

        @android.webkit.JavascriptInterface
        fun requestFullScreenCallAccess() {
            val manager = getSystemService(android.app.NotificationManager::class.java)
            if (android.os.Build.VERSION.SDK_INT >= 34 && !manager.canUseFullScreenIntent()) {
                val settingsIntent = Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runOnUiThread { startActivity(settingsIntent) }
            }
        }
    }
}

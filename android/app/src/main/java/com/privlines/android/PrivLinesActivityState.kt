package com.privlines.android

import java.util.concurrent.ConcurrentHashMap

object PrivLinesActivityState {
    @Volatile
    var isForeground: Boolean = false

    @Volatile
    var activeChatId: String? = null

    val activeCallIds: MutableSet<String> = ConcurrentHashMap.newKeySet()
}

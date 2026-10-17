package com.privlines.android

import java.util.concurrent.ConcurrentHashMap

object PrivLinesActivityState {
    @Volatile
    var isForeground: Boolean = false

    val activeCallIds: MutableSet<String> = ConcurrentHashMap.newKeySet()
}

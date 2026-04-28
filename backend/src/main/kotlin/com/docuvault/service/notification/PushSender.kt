package com.docuvault.service.notification

import com.docuvault.domain.user.UserPushToken

data class PushPayload(
    val title: String,
    val body: String,
    val data: Map<String, String> = emptyMap()
)

/**
 * Implemented by APNs / FCM clients. Implementations register themselves as Spring beans;
 * the dispatcher iterates and routes by token platform.
 */
interface PushSender {
    fun supports(token: UserPushToken): Boolean
    fun send(token: UserPushToken, payload: PushPayload): Result<Unit>
}

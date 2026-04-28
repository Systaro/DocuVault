package com.docuvault.service.notification

import com.docuvault.domain.user.UserPushToken
import org.slf4j.LoggerFactory
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component

/**
 * Always-present fallback sender. ChangeNotificationService picks the first sender whose
 * [supports] returns true; real senders (FcmPushSender, ApnsPushSender) are picked first
 * because they're @Order(0) and only support their platform. This logger handles anything
 * else (e.g. iOS tokens before APNs is configured) so dispatch is observable without crashing.
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
class LoggingPushSender : PushSender {
    private val logger = LoggerFactory.getLogger(LoggingPushSender::class.java)

    override fun supports(token: UserPushToken): Boolean = true

    override fun send(token: UserPushToken, payload: PushPayload): Result<Unit> {
        logger.info(
            "[PushDispatch] would send \"{}\" to user={} platform={} device=\"{}\" tokenPrefix={}",
            payload.title,
            token.user.email,
            token.platform,
            token.deviceName,
            token.token.take(12)
        )
        return Result.success(Unit)
    }
}

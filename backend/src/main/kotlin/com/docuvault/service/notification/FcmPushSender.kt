package com.docuvault.service.notification

import com.docuvault.domain.user.PushPlatform
import com.docuvault.domain.user.UserPushToken
import com.google.auth.oauth2.GoogleCredentials
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.AndroidConfig
import com.google.firebase.messaging.AndroidNotification
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingException
import com.google.firebase.messaging.Message
import com.google.firebase.messaging.MessagingErrorCode
import com.google.firebase.messaging.Notification
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import java.io.FileInputStream

@Configuration
@ConditionalOnExpression("'\${fcm.service-account-path:}' != ''")
class FirebaseConfig {
    private val logger = LoggerFactory.getLogger(FirebaseConfig::class.java)

    @Bean
    fun firebaseApp(
        @Value("\${fcm.service-account-path}") serviceAccountPath: String,
        @Value("\${fcm.project-id:}") projectId: String
    ): FirebaseApp {
        if (FirebaseApp.getApps().isNotEmpty()) {
            return FirebaseApp.getInstance()
        }
        val credentials = FileInputStream(serviceAccountPath).use {
            GoogleCredentials.fromStream(it)
        }
        val builder = FirebaseOptions.builder().setCredentials(credentials)
        if (projectId.isNotBlank()) {
            builder.setProjectId(projectId)
        }
        val app = FirebaseApp.initializeApp(builder.build())
        logger.info("Firebase Admin SDK initialised for project '{}'", projectId.ifBlank { "(default)" })
        return app
    }
}

@Component("fcmPushSender")
@ConditionalOnExpression("'\${fcm.service-account-path:}' != ''")
@org.springframework.core.annotation.Order(0)
class FcmPushSender(
    @Suppress("unused") private val firebaseApp: FirebaseApp
) : PushSender {
    private val logger = LoggerFactory.getLogger(FcmPushSender::class.java)

    override fun supports(token: UserPushToken): Boolean = token.platform == PushPlatform.android

    override fun send(token: UserPushToken, payload: PushPayload): Result<Unit> {
        val message = Message.builder()
            .setToken(token.token)
            .setNotification(
                Notification.builder()
                    .setTitle(payload.title)
                    .setBody(payload.body)
                    .build()
            )
            .setAndroidConfig(
                AndroidConfig.builder()
                    .setNotification(
                        AndroidNotification.builder()
                            .setTitle(payload.title)
                            .setBody(payload.body)
                            .build()
                    )
                    .build()
            )
            .putAllData(payload.data)
            .build()

        return try {
            val id = FirebaseMessaging.getInstance().send(message)
            logger.debug("FCM message {} delivered to user={} device='{}'", id, token.user.email, token.deviceName)
            Result.success(Unit)
        } catch (e: FirebaseMessagingException) {
            logger.warn("FCM send failed for user={} device='{}': {} ({})", token.user.email, token.deviceName, e.message, e.messagingErrorCode)
            // Token is no longer valid — caller can decide to revoke; we surface the code in the error
            if (e.messagingErrorCode == MessagingErrorCode.UNREGISTERED || e.messagingErrorCode == MessagingErrorCode.INVALID_ARGUMENT) {
                Result.failure(IllegalStateException("FCM:${e.messagingErrorCode}"))
            } else {
                Result.failure(e)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

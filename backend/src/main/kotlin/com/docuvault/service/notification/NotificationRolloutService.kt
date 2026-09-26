package com.docuvault.service.notification

import com.docuvault.domain.user.EmailMode
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.EmailService
import com.docuvault.service.SettingsService
import com.docuvault.service.branding.BrandingService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

/**
 * One-time release rollout: switches existing users from the old `NONE` default
 * to `DAILY` and sends each a one-time announcement so the new mail isn't a
 * surprise. Admin-triggered only and idempotent — never runs on boot.
 */
@Service
class NotificationRolloutService(
    private val userRepository: UserRepository,
    private val subscriptionService: NotificationSubscriptionService,
    private val emailService: EmailService,
    private val settingsService: SettingsService,
    private val brandingService: BrandingService
) {
    private val logger = LoggerFactory.getLogger(NotificationRolloutService::class.java)

    fun status(): RolloutStatus {
        val pending = userRepository.findAll().count { it.enabled && it.emailMode == EmailMode.NONE }
        return RolloutStatus(completedAt = settingsService.get(ROLLOUT_KEY), pendingUsers = pending)
    }

    @Transactional
    fun runOnce(force: Boolean = false): RolloutResult {
        val completedAt = settingsService.get(ROLLOUT_KEY)
        if (completedAt != null && !force) {
            return RolloutResult(alreadyCompleted = true, completedAt = completedAt, migrated = 0)
        }

        val targets = userRepository.findAll().filter { it.enabled && it.emailMode == EmailMode.NONE }
        val brand = brandingService.emailBrand()
        for (user in targets) {
            user.emailMode = EmailMode.DAILY
            user.updatedAt = Instant.now()
            userRepository.save(user)

            val token = subscriptionService.tokenFor(user)
            val html = NotificationEmail.buildAnnouncement(user.name, brand, token)
            val headers = NotificationEmail.unsubscribeHeaders(brand.publicUrl, token)
            emailService.sendHtml(user.email, "${brand.appName} notifications are now on", html, headers)
        }

        val now = Instant.now().toString()
        settingsService.set(ROLLOUT_KEY, now)
        logger.info("Notification rollout completed: migrated {} users to DAILY digests", targets.size)
        return RolloutResult(alreadyCompleted = false, completedAt = now, migrated = targets.size)
    }

    companion object {
        const val ROLLOUT_KEY = "notifications.rollout.completedAt"
    }
}

data class RolloutStatus(val completedAt: String?, val pendingUsers: Int)
data class RolloutResult(val alreadyCompleted: Boolean, val completedAt: String?, val migrated: Int)

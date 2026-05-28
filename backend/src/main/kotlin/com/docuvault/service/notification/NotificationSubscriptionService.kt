package com.docuvault.service.notification

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceNotificationSetting
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.SpaceNotificationSettingRepository
import com.docuvault.infrastructure.repository.UserRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.SecureRandom
import java.time.Instant
import java.util.*

/**
 * Resolves per-space notification subscriptions and manages the per-user
 * unsubscribe token.
 *
 * Subscription model is "default on": a row in space_notification_settings is
 * only an override. Resolution order for a (user, space) pair:
 *   1. explicit override on the space itself
 *   2. else override on the space's parent group (cascade)
 *   3. else subscribed (true)
 */
@Service
class NotificationSubscriptionService(
    private val settingRepository: SpaceNotificationSettingRepository,
    private val userRepository: UserRepository
) {
    private val secureRandom = SecureRandom()

    fun isSubscribed(userId: UUID, space: Space): Boolean =
        resolve(space, overridesForUser(userId))

    /** Map of spaceId -> enabled for every explicit override this user has. */
    fun overridesForUser(userId: UUID): Map<UUID, Boolean> =
        settingRepository.findAllByUserId(userId).associate { it.space.id!! to it.enabled }

    /** Resolve a single space against a pre-fetched override map (no extra queries). */
    fun resolve(space: Space, overrides: Map<UUID, Boolean>): Boolean {
        overrides[space.id]?.let { return it }
        space.parent?.id?.let { parentId -> overrides[parentId]?.let { return it } }
        return true
    }

    @Transactional
    fun setOverride(user: User, space: Space, enabled: Boolean) {
        val existing = settingRepository.findByUserIdAndSpaceId(user.id!!, space.id!!)
        if (existing != null) {
            existing.enabled = enabled
            existing.updatedAt = Instant.now()
            settingRepository.save(existing)
        } else {
            settingRepository.save(SpaceNotificationSetting(user = user, space = space, enabled = enabled))
        }
    }

    /** Remove the override so the space falls back to the inherited/default state. */
    @Transactional
    fun clearOverride(userId: UUID, spaceId: UUID) {
        settingRepository.deleteByUserIdAndSpaceId(userId, spaceId)
    }

    /** Return the user's stable unsubscribe token, generating + persisting one on first use. */
    @Transactional
    fun tokenFor(user: User): String {
        user.notificationToken?.let { return it }
        val token = generateToken()
        user.notificationToken = token
        user.updatedAt = Instant.now()
        userRepository.save(user)
        return token
    }

    fun findByToken(token: String): User? = userRepository.findByNotificationToken(token)

    private fun generateToken(): String {
        val bytes = ByteArray(32) // 256-bit
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

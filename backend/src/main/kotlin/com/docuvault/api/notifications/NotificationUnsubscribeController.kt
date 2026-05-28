package com.docuvault.api.notifications

import com.docuvault.domain.user.EmailMode
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.notification.NotificationSubscriptionService
import org.springframework.http.ResponseEntity
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

/**
 * Public (unauthenticated) unsubscribe endpoint reached from notification emails
 * via the per-user [com.docuvault.domain.user.User.notificationToken].
 *
 * - `GET  /notifications/unsubscribe/info` — read-only, drives the frontend page.
 * - `POST /notifications/unsubscribe`      — performs the action (RFC 8058 one-click
 *   and the frontend confirm button). With `s` it mutes one space; without `s` it
 *   turns off all email. POST-only on purpose so link prefetchers can't unsubscribe.
 */
@RestController
@RequestMapping("/notifications")
class NotificationUnsubscribeController(
    private val subscriptionService: NotificationSubscriptionService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository
) {
    @GetMapping("/unsubscribe/info")
    fun info(
        @RequestParam("t") token: String,
        @RequestParam("s", required = false) spaceId: UUID?
    ): ResponseEntity<UnsubscribeInfoDto> {
        val user = subscriptionService.findByToken(token) ?: return ResponseEntity.notFound().build()
        val space = spaceId?.let { spaceRepository.findById(it).orElse(null) }
        return ResponseEntity.ok(
            UnsubscribeInfoDto(
                email = user.email,
                spaceId = space?.id,
                spaceName = space?.name,
                emailMode = user.emailMode.name
            )
        )
    }

    @PostMapping("/unsubscribe")
    @Transactional
    fun unsubscribe(
        @RequestParam("t") token: String,
        @RequestParam("s", required = false) spaceId: UUID?
    ): ResponseEntity<UnsubscribeResultDto> {
        val user = subscriptionService.findByToken(token) ?: return ResponseEntity.notFound().build()

        if (spaceId != null) {
            val space = spaceRepository.findById(spaceId).orElse(null)
                ?: return ResponseEntity.notFound().build()
            subscriptionService.setOverride(user, space, enabled = false)
            return ResponseEntity.ok(
                UnsubscribeResultDto(scope = "space", spaceName = space.name, message = "Muted ${space.name}.")
            )
        }

        user.emailMode = EmailMode.NONE
        user.updatedAt = Instant.now()
        userRepository.save(user)
        return ResponseEntity.ok(
            UnsubscribeResultDto(scope = "all", message = "You've been unsubscribed from all DocuVault emails.")
        )
    }
}

data class UnsubscribeInfoDto(
    val email: String,
    val spaceId: UUID?,
    val spaceName: String?,
    val emailMode: String
)

data class UnsubscribeResultDto(
    val scope: String,
    val spaceName: String? = null,
    val message: String
)

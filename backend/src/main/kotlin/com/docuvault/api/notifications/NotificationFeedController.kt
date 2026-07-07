package com.docuvault.api.notifications

import com.docuvault.infrastructure.repository.SpaceChangeEventRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

/**
 * In-app notification feed for the header bell. Serves the same underlying
 * data as the digest emails (space_change_events), scoped to the caller's
 * accessible spaces and excluding their own changes.
 */
@RestController
@RequestMapping("/notifications")
class NotificationFeedController(
    private val changeEventRepository: SpaceChangeEventRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {
    @GetMapping("/feed")
    @Transactional(readOnly = true)
    fun feed(
        @RequestParam(defaultValue = "30") limit: Int,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<NotificationFeedDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val spaces = permissionService.getAccessibleSpaces(user.id!!, user.role)
        val spaceIds = spaces.mapNotNull { it.id }
        if (spaceIds.isEmpty()) {
            return ResponseEntity.ok(NotificationFeedDto(emptyList(), 0, user.notificationsSeenAt?.toString()))
        }
        val spaceMap = spaces.associateBy { it.id }

        val events = changeEventRepository.findFeed(
            spaceIds, user.id!!, PageRequest.of(0, limit.coerceIn(1, 100))
        )
        val seenAt = user.notificationsSeenAt ?: Instant.EPOCH
        val unseenCount = changeEventRepository.countFeedSince(spaceIds, user.id!!, seenAt)

        val items = events.map { event ->
            val space = spaceMap[event.space.id]
            NotificationFeedItemDto(
                id = event.id!!,
                spaceId = event.space.id!!,
                spaceName = space?.name ?: "",
                spaceFullPath = space?.getFullPath() ?: "",
                filePath = event.filePath,
                changeType = event.changeType.name,
                commitMessage = event.commitMessage,
                authorName = event.commitAuthorName ?: event.triggeredBy?.name,
                detectedAt = event.detectedAt.toString(),
                unseen = event.detectedAt.isAfter(seenAt)
            )
        }

        return ResponseEntity.ok(
            NotificationFeedDto(items, unseenCount, user.notificationsSeenAt?.toString())
        )
    }

    @PostMapping("/feed/seen")
    @Transactional
    fun markSeen(
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, String>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        user.notificationsSeenAt = Instant.now()
        userRepository.save(user)
        return ResponseEntity.ok(mapOf("seenAt" to user.notificationsSeenAt.toString()))
    }
}

data class NotificationFeedDto(
    val items: List<NotificationFeedItemDto>,
    val unseenCount: Long,
    val seenAt: String?
)

data class NotificationFeedItemDto(
    val id: UUID,
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val filePath: String,
    val changeType: String,
    val commitMessage: String?,
    val authorName: String?,
    val detectedAt: String,
    val unseen: Boolean
)

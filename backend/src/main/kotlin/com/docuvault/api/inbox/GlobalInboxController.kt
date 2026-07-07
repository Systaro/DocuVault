package com.docuvault.api.inbox

import com.docuvault.infrastructure.repository.InboxNoteRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.*

/**
 * Cross-space inbox aggregates — lets the dashboard surface unsorted quick
 * notes without one request per space.
 */
@RestController
@RequestMapping("/inbox")
class GlobalInboxController(
    private val inboxNoteRepository: InboxNoteRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {
    @GetMapping("/unsorted-counts")
    @Transactional(readOnly = true)
    fun unsortedCounts(
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SpaceUnsortedCountDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val spaces = permissionService.getAccessibleSpaces(user.id!!, user.role)
        if (spaces.isEmpty()) return ResponseEntity.ok(emptyList())
        val spaceMap = spaces.associateBy { it.id }

        val counts = inboxNoteRepository.countUnsortedBySpaceIds(spaces.mapNotNull { it.id })
            .map {
                SpaceUnsortedCountDto(
                    spaceId = it.spaceId,
                    spaceFullPath = spaceMap[it.spaceId]?.getFullPath() ?: "",
                    count = it.count
                )
            }
        return ResponseEntity.ok(counts)
    }
}

data class SpaceUnsortedCountDto(
    val spaceId: UUID,
    val spaceFullPath: String,
    val count: Long
)

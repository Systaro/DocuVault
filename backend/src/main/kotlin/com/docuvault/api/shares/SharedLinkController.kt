package com.docuvault.api.shares

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.SharedLinkService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/shares")
class SharedLinkController(
    private val sharedLinkService: SharedLinkService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {
    @PostMapping
    fun createShareLink(
        @PathVariable spaceId: UUID,
        @RequestBody request: CreateShareLinkRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SharedLinkDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val expiresAt = request.expiresInDays?.let {
            Instant.now().plus(it.toLong(), ChronoUnit.DAYS)
        }

        val link = sharedLinkService.createLink(space, request.filePath, user, expiresAt)
        return ResponseEntity.status(HttpStatus.CREATED).body(link.toDto())
    }

    @GetMapping
    fun getShareLinks(
        @PathVariable spaceId: UUID,
        @RequestParam(required = false) filePath: String?,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SharedLinkDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val links = if (filePath != null) {
            sharedLinkService.findBySpaceAndFile(spaceId, filePath)
        } else {
            sharedLinkService.findBySpace(spaceId)
        }

        return ResponseEntity.ok(links.map { it.toDto() })
    }

    @DeleteMapping("/{linkId}")
    fun revokeShareLink(
        @PathVariable spaceId: UUID,
        @PathVariable linkId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val revoked = sharedLinkService.revoke(linkId, spaceId)
        return if (revoked) {
            ResponseEntity.noContent().build()
        } else {
            ResponseEntity.notFound().build()
        }
    }
}

package com.docuvault.api.shares

import com.docuvault.domain.space.AccessLevel
import com.docuvault.domain.space.ShareType
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.SharedLinkAccessDenialService
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
    private val permissionService: PermissionService,
    private val denialService: SharedLinkAccessDenialService
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

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val expiresAt = request.expiresInDays?.let {
            Instant.now().plus(it.toLong(), ChronoUnit.DAYS)
        }

        val shareType = try {
            ShareType.valueOf(request.shareType.uppercase())
        } catch (_: IllegalArgumentException) {
            ShareType.FILE
        }

        val accessLevel = try {
            AccessLevel.valueOf(request.accessLevel.uppercase())
        } catch (_: IllegalArgumentException) {
            AccessLevel.VIEW
        }

        val link = sharedLinkService.createLink(
            space = space,
            filePath = request.filePath,
            createdBy = user,
            expiresAt = expiresAt,
            password = request.password,
            shareType = shareType,
            writableScopes = request.writableScopes,
            accessLevel = accessLevel
        )
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

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
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

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val revoked = sharedLinkService.revoke(linkId, spaceId)
        return if (revoked) {
            ResponseEntity.noContent().build()
        } else {
            ResponseEntity.notFound().build()
        }
    }

    @PatchMapping("/{linkId}/password")
    fun updateSharePassword(
        @PathVariable spaceId: UUID,
        @PathVariable linkId: UUID,
        @RequestBody request: UpdateSharePasswordRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val updated = sharedLinkService.updatePassword(linkId, spaceId, request.password)
        return if (updated) {
            ResponseEntity.noContent().build()
        } else {
            ResponseEntity.notFound().build()
        }
    }

    @GetMapping("/{linkId}/denials")
    fun getShareDenials(
        @PathVariable spaceId: UUID,
        @PathVariable linkId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SharedLinkAccessDenialDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val link = sharedLinkService.findBySpace(spaceId).firstOrNull { it.id == linkId }
            ?: return ResponseEntity.notFound().build()

        val denials = denialService.findByToken(link.token)
        return ResponseEntity.ok(denials.map { it.toDto() })
    }
}

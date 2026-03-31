package com.docuvault.api.spaces

import com.docuvault.domain.space.SpaceToken
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.SpaceTokenService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/tokens")
class SpaceTokenController(
    private val spaceTokenService: SpaceTokenService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {

    @GetMapping
    @Transactional(readOnly = true)
    fun listTokens(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SpaceTokenDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(spaceTokenService.listTokens(spaceId).map { it.toDto() })
    }

    @PostMapping
    @Transactional
    fun createToken(
        @PathVariable spaceId: UUID,
        @Valid @RequestBody request: CreateSpaceTokenRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceTokenCreatedDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        val (saved, rawToken) = spaceTokenService.createToken(space, request.name)
        return ResponseEntity.status(HttpStatus.CREATED).body(
            SpaceTokenCreatedDto(token = saved.toDto(), rawToken = rawToken)
        )
    }

    @DeleteMapping("/{tokenId}")
    @Transactional
    fun revokeToken(
        @PathVariable spaceId: UUID,
        @PathVariable tokenId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return if (spaceTokenService.revokeToken(tokenId, spaceId))
            ResponseEntity.noContent().build()
        else
            ResponseEntity.notFound().build()
    }
}

data class CreateSpaceTokenRequest(
    @field:NotBlank(message = "name is required")
    val name: String
)

data class SpaceTokenDto(
    val id: UUID,
    val name: String,
    val tokenPrefix: String,
    val createdAt: Instant,
    val lastUsedAt: Instant?,
    val revokedAt: Instant?
)

data class SpaceTokenCreatedDto(
    val token: SpaceTokenDto,
    val rawToken: String
)

fun SpaceToken.toDto() = SpaceTokenDto(
    id = id!!,
    name = name,
    tokenPrefix = tokenPrefix,
    createdAt = createdAt,
    lastUsedAt = lastUsedAt,
    revokedAt = revokedAt
)

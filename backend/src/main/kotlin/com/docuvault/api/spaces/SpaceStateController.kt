package com.docuvault.api.spaces

import com.docuvault.domain.space.SpaceState
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.SpaceStateRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/state")
class SpaceStateController(
    private val spaceStateRepository: SpaceStateRepository,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {

    /** Returns true if the principal is a space token that matches the requested spaceId. */
    private fun isSpaceTokenForSpace(userDetails: UserDetails, spaceId: UUID): Boolean =
        userDetails.username == "space:$spaceId" &&
        userDetails.authorities.any { it.authority == "ROLE_SPACE_STATE" }

    private fun canRead(userDetails: UserDetails, spaceId: UUID): Boolean {
        if (isSpaceTokenForSpace(userDetails, spaceId)) return true
        val user = userRepository.findByEmail(userDetails.username) ?: return false
        return permissionService.hasAccess(user.id!!, spaceId, user.role)
    }

    private fun canWrite(userDetails: UserDetails, spaceId: UUID): Boolean {
        if (isSpaceTokenForSpace(userDetails, spaceId)) return true
        val user = userRepository.findByEmail(userDetails.username) ?: return false
        return permissionService.hasEditAccess(user.id!!, spaceId, user.role)
    }

    @GetMapping("/{key}")
    @Transactional(readOnly = true)
    fun getState(
        @PathVariable spaceId: UUID,
        @PathVariable key: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceStateDto> {
        if (!canRead(userDetails, spaceId)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "No access to this space")
        }

        val state = spaceStateRepository.findBySpaceIdAndKey(spaceId, key)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "State key not found")

        return ResponseEntity.ok(state.toDto())
    }

    @PutMapping("/{key}")
    @Transactional
    fun putState(
        @PathVariable spaceId: UUID,
        @PathVariable key: String,
        @Valid @RequestBody request: PutStateRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceStateDto> {
        if (!canWrite(userDetails, spaceId)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "No access to this space")
        }

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")

        val existing = spaceStateRepository.findBySpaceIdAndKey(spaceId, key)

        val saved = if (existing != null) {
            existing.value = request.value
            existing.updatedAt = Instant.now()
            spaceStateRepository.save(existing)
        } else {
            spaceStateRepository.save(
                SpaceState(space = space, key = key, value = request.value)
            )
        }

        val status = if (existing != null) HttpStatus.OK else HttpStatus.CREATED
        return ResponseEntity.status(status).body(saved.toDto())
    }

    @DeleteMapping("/{key}")
    @Transactional
    fun deleteState(
        @PathVariable spaceId: UUID,
        @PathVariable key: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        if (!canWrite(userDetails, spaceId)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "No access to this space")
        }

        spaceStateRepository.deleteBySpaceIdAndKey(spaceId, key)
        return ResponseEntity.noContent().build()
    }
}

data class PutStateRequest(
    @field:NotBlank(message = "value is required")
    val value: String
)

data class SpaceStateDto(
    val key: String,
    val value: String,
    val updatedAt: java.time.Instant
)

fun SpaceState.toDto() = SpaceStateDto(key = key, value = value, updatedAt = updatedAt)

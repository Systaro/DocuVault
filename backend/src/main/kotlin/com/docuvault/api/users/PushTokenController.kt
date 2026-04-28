package com.docuvault.api.users

import com.docuvault.domain.user.PushPlatform
import com.docuvault.domain.user.UserPushToken
import com.docuvault.infrastructure.repository.UserPushTokenRepository
import com.docuvault.infrastructure.repository.UserRepository
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/users/me/push-tokens")
class PushTokenController(
    private val userRepository: UserRepository,
    private val pushTokenRepository: UserPushTokenRepository
) {
    @PostMapping
    @Transactional
    fun register(
        @Valid @RequestBody request: RegisterPushTokenRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<PushTokenResponse> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val platform = try {
            PushPlatform.valueOf(request.platform.lowercase())
        } catch (_: IllegalArgumentException) {
            return ResponseEntity.badRequest().build()
        }

        val existing = pushTokenRepository.findByUserIdAndToken(user.id!!, request.token)
        val saved = if (existing != null) {
            existing.lastSeenAt = Instant.now()
            pushTokenRepository.save(existing)
        } else {
            pushTokenRepository.save(
                UserPushToken(
                    user = user,
                    platform = platform,
                    token = request.token,
                    deviceName = request.deviceName.take(120)
                )
            )
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(saved.toDto())
    }

    @GetMapping
    fun list(@AuthenticationPrincipal userDetails: UserDetails): ResponseEntity<List<PushTokenResponse>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        return ResponseEntity.ok(
            pushTokenRepository.findByUserIdOrderByLastSeenAtDesc(user.id!!).map { it.toDto() }
        )
    }

    @DeleteMapping("/{id}")
    @Transactional
    fun delete(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        val deleted = pushTokenRepository.deleteByUserIdAndId(user.id!!, id)
        return if (deleted > 0) ResponseEntity.noContent().build()
        else ResponseEntity.notFound().build()
    }
}

data class RegisterPushTokenRequest(
    @field:NotBlank
    val platform: String,

    @field:NotBlank
    @field:Size(max = 4096)
    val token: String,

    @field:NotBlank
    @field:Size(max = 120)
    val deviceName: String
)

data class PushTokenResponse(
    val id: UUID,
    val platform: String,
    val deviceName: String,
    val createdAt: String,
    val lastSeenAt: String
)

private fun UserPushToken.toDto() = PushTokenResponse(
    id = this.id!!,
    platform = this.platform.name,
    deviceName = this.deviceName,
    createdAt = this.createdAt.toString(),
    lastSeenAt = this.lastSeenAt.toString()
)

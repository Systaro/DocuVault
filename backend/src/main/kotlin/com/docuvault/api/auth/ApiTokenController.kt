package com.docuvault.api.auth

import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.ApiTokenService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/tokens")
class ApiTokenController(
    private val apiTokenService: ApiTokenService,
    private val userRepository: UserRepository
) {
    @PostMapping
    fun createToken(
        @Valid @RequestBody request: CreateTokenRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<CreateTokenResponse> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val expiresAt = request.expiresInDays?.let {
            Instant.now().plusSeconds(it * 86400L)
        }

        return try {
            val (token, rawToken) = apiTokenService.createToken(user, request.name, expiresAt)
            ResponseEntity.status(HttpStatus.CREATED).body(
                CreateTokenResponse(
                    id = token.id!!,
                    name = token.name,
                    token = rawToken,
                    prefix = token.tokenPrefix,
                    expiresAt = token.expiresAt?.toString(),
                    createdAt = token.createdAt.toString()
                )
            )
        } catch (e: IllegalStateException) {
            ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(CreateTokenResponse(error = e.message))
        }
    }

    @GetMapping
    fun listTokens(
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<TokenDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val tokens = apiTokenService.listTokens(user.id!!).map { token ->
            TokenDto(
                id = token.id!!,
                name = token.name,
                prefix = token.tokenPrefix,
                lastUsedAt = token.lastUsedAt?.toString(),
                expiresAt = token.expiresAt?.toString(),
                revokedAt = token.revokedAt?.toString(),
                createdAt = token.createdAt.toString(),
                isActive = token.isValid()
            )
        }

        return ResponseEntity.ok(tokens)
    }

    @DeleteMapping("/{id}")
    fun revokeToken(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        return if (apiTokenService.revokeToken(id, user.id!!)) {
            ResponseEntity.noContent().build()
        } else {
            ResponseEntity.notFound().build()
        }
    }
}

data class CreateTokenRequest(
    @field:NotBlank(message = "Token name is required")
    @field:Size(max = 255, message = "Token name must be at most 255 characters")
    val name: String,
    val expiresInDays: Long? = null
)

data class CreateTokenResponse(
    val id: UUID? = null,
    val name: String? = null,
    val token: String? = null,
    val prefix: String? = null,
    val expiresAt: String? = null,
    val createdAt: String? = null,
    val error: String? = null
)

data class TokenDto(
    val id: UUID,
    val name: String,
    val prefix: String,
    val lastUsedAt: String?,
    val expiresAt: String?,
    val revokedAt: String?,
    val createdAt: String,
    val isActive: Boolean
)

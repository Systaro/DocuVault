package com.docuvault.api.auth

import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.JwtService
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/auth")
class AuthController(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
    private val jwtService: JwtService
) {
    @PostMapping("/register")
    fun register(@Valid @RequestBody request: RegisterRequest): ResponseEntity<AuthResponse> {
        if (userRepository.existsByEmail(request.email)) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(AuthResponse(error = "Email already registered"))
        }

        val isFirstUser = userRepository.count() == 0L
        val role = if (isFirstUser) UserRole.SUPER_ADMIN else UserRole.VIEWER

        val user = User(
            email = request.email,
            passwordHash = passwordEncoder.encode(request.password),
            name = request.name,
            role = role
        )

        val savedUser = userRepository.save(user)
        val token = jwtService.generateToken(savedUser.email, mapOf("role" to savedUser.role.name))
        val refreshToken = jwtService.generateRefreshToken(savedUser.email)

        return ResponseEntity.status(HttpStatus.CREATED).body(
            AuthResponse(
                token = token,
                refreshToken = refreshToken,
                user = savedUser.toDto()
            )
        )
    }

    @PostMapping("/login")
    fun login(@Valid @RequestBody request: LoginRequest): ResponseEntity<AuthResponse> {
        val user = userRepository.findByEmail(request.email)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid credentials"))

        if (!passwordEncoder.matches(request.password, user.passwordHash)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid credentials"))
        }

        val token = jwtService.generateToken(user.email, mapOf("role" to user.role.name))
        val refreshToken = jwtService.generateRefreshToken(user.email)

        return ResponseEntity.ok(
            AuthResponse(
                token = token,
                refreshToken = refreshToken,
                user = user.toDto()
            )
        )
    }

    @PostMapping("/refresh")
    fun refresh(@RequestBody request: RefreshRequest): ResponseEntity<AuthResponse> {
        val email = jwtService.extractEmail(request.refreshToken)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid refresh token"))

        val user = userRepository.findByEmail(email)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "User not found"))

        if (!jwtService.isTokenValid(request.refreshToken, email)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Refresh token expired"))
        }

        val newToken = jwtService.generateToken(user.email, mapOf("role" to user.role.name))
        val newRefreshToken = jwtService.generateRefreshToken(user.email)

        return ResponseEntity.ok(
            AuthResponse(
                token = newToken,
                refreshToken = newRefreshToken,
                user = user.toDto()
            )
        )
    }
}

data class RegisterRequest(
    @field:NotBlank(message = "Name is required")
    val name: String,

    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String,

    @field:NotBlank(message = "Password is required")
    @field:Size(min = 8, message = "Password must be at least 8 characters")
    val password: String
)

data class LoginRequest(
    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String,

    @field:NotBlank(message = "Password is required")
    val password: String
)

data class RefreshRequest(
    val refreshToken: String
)

data class AuthResponse(
    val token: String? = null,
    val refreshToken: String? = null,
    val user: UserDto? = null,
    val error: String? = null
)

data class UserDto(
    val id: UUID,
    val email: String,
    val name: String,
    val role: String
)

fun User.toDto() = UserDto(
    id = this.id!!,
    email = this.email,
    name = this.name,
    role = this.role.name
)

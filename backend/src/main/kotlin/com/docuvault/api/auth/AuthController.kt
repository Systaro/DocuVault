package com.docuvault.api.auth

import com.docuvault.config.JwtAuthenticationFilter
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.JwtService
import jakarta.servlet.http.Cookie
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/auth")
class AuthController(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
    private val jwtService: JwtService,
    @Value("\${jwt.expiration}") private val accessTokenExpiration: Long,
    @Value("\${jwt.refresh-expiration}") private val refreshTokenExpiration: Long,
    @Value("\${server.servlet.context-path:}") private val contextPath: String
) {
    @PostMapping("/register")
    fun register(
        @Valid @RequestBody request: RegisterRequest,
        response: HttpServletResponse
    ): ResponseEntity<AuthResponse> {
        if (userRepository.existsByEmail(request.email)) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(AuthResponse(error = "Registration failed. Please try again or contact support."))
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
        setAuthCookies(response, savedUser)

        return ResponseEntity.status(HttpStatus.CREATED).body(
            AuthResponse(user = savedUser.toDto())
        )
    }

    @PostMapping("/login")
    fun login(
        @Valid @RequestBody request: LoginRequest,
        response: HttpServletResponse
    ): ResponseEntity<AuthResponse> {
        val user = userRepository.findByEmail(request.email)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid credentials"))

        if (!passwordEncoder.matches(request.password, user.passwordHash)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid credentials"))
        }

        setAuthCookies(response, user)

        return ResponseEntity.ok(
            AuthResponse(user = user.toDto())
        )
    }

    @PostMapping("/refresh")
    fun refresh(
        request: HttpServletRequest,
        response: HttpServletResponse
    ): ResponseEntity<AuthResponse> {
        val refreshToken = request.cookies
            ?.find { it.name == JwtAuthenticationFilter.REFRESH_TOKEN_COOKIE }
            ?.value
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "No refresh token"))

        val email = jwtService.extractEmail(refreshToken)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid refresh token"))

        val user = userRepository.findByEmail(email)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "User not found"))

        if (!jwtService.isTokenValid(refreshToken, email)) {
            clearAuthCookies(response)
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Refresh token expired"))
        }

        setAuthCookies(response, user)

        return ResponseEntity.ok(
            AuthResponse(user = user.toDto())
        )
    }

    @PostMapping("/logout")
    fun logout(response: HttpServletResponse): ResponseEntity<Unit> {
        clearAuthCookies(response)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/me")
    fun me(@AuthenticationPrincipal userDetails: UserDetails?): ResponseEntity<AuthResponse> {
        if (userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Not authenticated"))
        }
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "User not found"))
        return ResponseEntity.ok(AuthResponse(user = user.toDto()))
    }

    private fun setAuthCookies(response: HttpServletResponse, user: User) {
        val token = jwtService.generateToken(user.email, mapOf("role" to user.role.name))
        val refreshToken = jwtService.generateRefreshToken(user.email)
        val cookiePath = if (contextPath.isBlank()) "/" else contextPath

        val accessCookie = Cookie(JwtAuthenticationFilter.ACCESS_TOKEN_COOKIE, token).apply {
            isHttpOnly = true
            secure = true
            path = cookiePath
            maxAge = (accessTokenExpiration / 1000).toInt()
            setAttribute("SameSite", "Strict")
        }

        val refreshCookie = Cookie(JwtAuthenticationFilter.REFRESH_TOKEN_COOKIE, refreshToken).apply {
            isHttpOnly = true
            secure = true
            path = "${cookiePath}auth/refresh".replace("//", "/")
            maxAge = (refreshTokenExpiration / 1000).toInt()
            setAttribute("SameSite", "Strict")
        }

        response.addCookie(accessCookie)
        response.addCookie(refreshCookie)
    }

    private fun clearAuthCookies(response: HttpServletResponse) {
        val cookiePath = if (contextPath.isBlank()) "/" else contextPath

        val accessCookie = Cookie(JwtAuthenticationFilter.ACCESS_TOKEN_COOKIE, "").apply {
            isHttpOnly = true
            secure = true
            path = cookiePath
            maxAge = 0
            setAttribute("SameSite", "Strict")
        }

        val refreshCookie = Cookie(JwtAuthenticationFilter.REFRESH_TOKEN_COOKIE, "").apply {
            isHttpOnly = true
            secure = true
            path = "${cookiePath}auth/refresh".replace("//", "/")
            maxAge = 0
            setAttribute("SameSite", "Strict")
        }

        response.addCookie(accessCookie)
        response.addCookie(refreshCookie)
    }
}

data class RegisterRequest(
    @field:NotBlank(message = "Name is required")
    val name: String,

    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String,

    @field:NotBlank(message = "Password is required")
    @field:Size(min = 10, message = "Password must be at least 10 characters")
    @field:Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@\$!%*?&\\-_#])[A-Za-z\\d@\$!%*?&\\-_#]{10,}$",
        message = "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
    )
    val password: String
)

data class LoginRequest(
    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String,

    @field:NotBlank(message = "Password is required")
    val password: String
)

data class AuthResponse(
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

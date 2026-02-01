package com.docuvault.api.auth

import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.UserRepository
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.authentication.AuthenticationManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/auth")
class AuthController(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
    private val authenticationManager: AuthenticationManager
) {
    @PostMapping("/register")
    fun register(
        @Valid @RequestBody request: RegisterRequest,
        httpRequest: HttpServletRequest
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
        authenticateSession(httpRequest, request.email, request.password)

        return ResponseEntity.status(HttpStatus.CREATED).body(
            AuthResponse(user = savedUser.toDto())
        )
    }

    @PostMapping("/login")
    fun login(
        @Valid @RequestBody request: LoginRequest,
        httpRequest: HttpServletRequest
    ): ResponseEntity<AuthResponse> {
        val user = userRepository.findByEmail(request.email)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid credentials"))

        if (!passwordEncoder.matches(request.password, user.passwordHash)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Invalid credentials"))
        }

        authenticateSession(httpRequest, request.email, request.password)

        return ResponseEntity.ok(
            AuthResponse(user = user.toDto())
        )
    }

    @PostMapping("/logout")
    fun logout(request: HttpServletRequest): ResponseEntity<Unit> {
        request.getSession(false)?.invalidate()
        SecurityContextHolder.clearContext()
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

    private fun authenticateSession(request: HttpServletRequest, email: String, password: String) {
        val authToken = UsernamePasswordAuthenticationToken(email, password)
        val authentication = authenticationManager.authenticate(authToken)
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = authentication
        SecurityContextHolder.setContext(context)
        request.getSession(true).setAttribute("SPRING_SECURITY_CONTEXT", context)
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

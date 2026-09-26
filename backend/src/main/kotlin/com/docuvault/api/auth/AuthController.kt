package com.docuvault.api.auth

import com.docuvault.domain.user.PasswordResetToken
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.PasswordResetTokenRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.ApiTokenService
import com.docuvault.service.EmailLayout
import com.docuvault.service.EmailService
import com.docuvault.service.branding.BrandingService
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.transaction.annotation.Transactional
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
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.*

@RestController
@RequestMapping("/auth")
class AuthController(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
    private val authenticationManager: AuthenticationManager,
    private val passwordResetTokenRepository: PasswordResetTokenRepository,
    private val emailService: EmailService,
    private val apiTokenService: ApiTokenService,
    private val brandingService: BrandingService
) {
    private val logger = LoggerFactory.getLogger(AuthController::class.java)
    @GetMapping("/setup-status")
    fun setupStatus(): ResponseEntity<SetupStatusResponse> =
        ResponseEntity.ok(SetupStatusResponse(needsSetup = userRepository.count() == 0L))

    @PostMapping("/setup-admin")
    fun setupAdmin(
        @Valid @RequestBody request: RegisterRequest,
        httpRequest: HttpServletRequest
    ): ResponseEntity<AuthResponse> {
        // Only succeeds when zero users exist. Once any user is in the DB,
        // this endpoint returns 409, so it can never be used to take over
        // an existing install.
        if (userRepository.count() > 0L) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(AuthResponse(error = "Setup has already been completed."))
        }

        val admin = User(
            email = request.email,
            passwordHash = passwordEncoder.encode(request.password),
            name = request.name,
            role = UserRole.SUPER_ADMIN
        )
        val saved = userRepository.save(admin)
        authenticateSession(httpRequest, request.email, request.password)
        logger.info("Initial admin created via setup wizard: ${saved.email}")

        return ResponseEntity.status(HttpStatus.CREATED).body(
            AuthResponse(user = saved.toDto())
        )
    }

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
    fun me(
        @AuthenticationPrincipal userDetails: UserDetails?,
        request: HttpServletRequest
    ): ResponseEntity<AuthResponse> {
        if (userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "Not authenticated"))
        }
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse(error = "User not found"))

        val originalAdminEmail = request.getSession(false)
            ?.getAttribute("ORIGINAL_ADMIN_EMAIL") as? String
        val originalAdmin = originalAdminEmail?.let { userRepository.findByEmail(it) }

        return ResponseEntity.ok(AuthResponse(
            user = user.toDto(),
            impersonating = if (originalAdmin != null) true else null,
            originalAdminName = originalAdmin?.name
        ))
    }

    @PostMapping("/native-login")
    fun nativeLogin(@Valid @RequestBody request: NativeLoginRequest): ResponseEntity<NativeLoginResponse> {
        val user = userRepository.findByEmail(request.email)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(NativeLoginResponse(error = "Invalid credentials"))

        if (!passwordEncoder.matches(request.password, user.passwordHash)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(NativeLoginResponse(error = "Invalid credentials"))
        }

        if (!user.enabled) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(NativeLoginResponse(error = "Account is disabled"))
        }

        val tokenName = "Native: ${request.deviceName.take(60)}"
        val expiresAt = Instant.now().plus(365, ChronoUnit.DAYS)

        return try {
            val (apiToken, rawToken) = apiTokenService.createToken(user, tokenName, expiresAt)
            ResponseEntity.ok(
                NativeLoginResponse(
                    user = user.toDto(),
                    token = rawToken,
                    tokenId = apiToken.id!!,
                    expiresAt = expiresAt.toString()
                )
            )
        } catch (e: IllegalStateException) {
            ResponseEntity.status(HttpStatus.CONFLICT)
                .body(NativeLoginResponse(error = e.message ?: "Token limit reached"))
        }
    }

    @PostMapping("/forgot-password")
    @Transactional
    fun forgotPassword(@Valid @RequestBody request: ForgotPasswordRequest): ResponseEntity<Map<String, String>> {
        val message = "If an account with that email exists, a password reset link has been sent."

        logger.info("Password reset requested for email: ${request.email}")
        val user = userRepository.findByEmail(request.email)
        logger.info("User lookup result: ${if (user != null) "found (${user.email})" else "not found"}")

        if (user != null) {
            passwordResetTokenRepository.deleteByEmail(request.email)

            val token = PasswordResetToken(
                email = request.email,
                token = UUID.randomUUID().toString(),
                expiresAt = Instant.now().plus(1, ChronoUnit.HOURS)
            )

            val saved = passwordResetTokenRepository.save(token)
            logger.info("Password reset token created for ${request.email}, sending email...")
            sendPasswordResetEmail(saved)
        }

        return ResponseEntity.ok(mapOf("message" to message))
    }

    @PostMapping("/reset-password")
    @Transactional
    fun resetPassword(@Valid @RequestBody request: ResetPasswordRequest): ResponseEntity<Map<String, String>> {
        val token = passwordResetTokenRepository.findByToken(request.token)
            ?: run {
                logger.warn("Password reset rejected: token not found")
                return ResponseEntity.badRequest().body(mapOf("error" to "Invalid or expired reset link."))
            }

        if (token.usedAt != null) {
            logger.warn("Password reset rejected for ${token.email}: token already used at ${token.usedAt}")
            return ResponseEntity.badRequest().body(mapOf("error" to "This reset link has already been used."))
        }

        if (token.expiresAt.isBefore(Instant.now())) {
            logger.warn("Password reset rejected for ${token.email}: token expired at ${token.expiresAt}")
            return ResponseEntity.badRequest().body(mapOf("error" to "This reset link has expired. Please request a new one."))
        }

        val user = userRepository.findByEmail(token.email)
            ?: run {
                logger.warn("Password reset rejected: no user for token email ${token.email}")
                return ResponseEntity.badRequest().body(mapOf("error" to "Invalid or expired reset link."))
            }

        user.passwordHash = passwordEncoder.encode(request.password)
        user.updatedAt = Instant.now()
        userRepository.save(user)

        token.usedAt = Instant.now()
        passwordResetTokenRepository.save(token)

        logger.info("Password reset completed for ${user.email}")
        return ResponseEntity.ok(mapOf("message" to "Password has been reset successfully. You can now sign in."))
    }

    private fun sendPasswordResetEmail(token: PasswordResetToken) {
        val brand = brandingService.emailBrand()
        val appName = EmailLayout.escape(brand.appName)
        val resetUrl = "${brand.publicUrl}/reset-password?token=${token.token}"
        emailService.sendHtml(
            to = token.email,
            subject = "Reset your ${brand.appName} password",
            htmlBody = EmailLayout.page("""
${EmailLayout.banner(brand, "Reset Your Password", "${brand.appName} account security")}
        <tr><td style="padding: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">Hi there,</p>
          <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 32px;">
            We received a request to reset your <strong style="color: #333;">$appName</strong> password.
            Click the button below to choose a new password.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding: 0 0 32px;">
            ${EmailLayout.button(brand, resetUrl, "Reset Password")}
          </td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8fafb; border-radius: 10px; border: 1px solid #e9eef2;">
            <tr><td style="padding: 20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color: #888; font-size: 13px;">This link expires in</td>
                  <td style="color: #333; font-size: 13px; font-weight: 600; text-align: right;">1 hour</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
${EmailLayout.footer("If you didn't request a password reset, you can safely ignore this email.<br>&copy; ${EmailLayout.signature(brand)}")}
            """.trimIndent())
        )
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
    @field:Size(min = 8, message = "Password must be at least 8 characters")
    @field:Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
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
    val error: String? = null,
    val impersonating: Boolean? = null,
    val originalAdminName: String? = null
)

data class SetupStatusResponse(
    val needsSetup: Boolean
)

data class UserDto(
    val id: UUID,
    val email: String,
    val name: String,
    val role: String,
    val enabled: Boolean = true,
    /** Populated only where team context matters (admin listings, /users/me). */
    val teams: List<com.docuvault.api.teams.TeamBadgeDto> = emptyList(),
    /** Drives the what's-new dialog; null until the user acknowledges one. */
    val changelogSeenVersion: String? = null
)

data class ForgotPasswordRequest(
    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String
)

data class NativeLoginRequest(
    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String,

    @field:NotBlank(message = "Password is required")
    val password: String,

    @field:NotBlank(message = "Device name is required")
    @field:Size(max = 80, message = "Device name too long")
    val deviceName: String
)

data class NativeLoginResponse(
    val user: UserDto? = null,
    val token: String? = null,
    val tokenId: UUID? = null,
    val expiresAt: String? = null,
    val error: String? = null
)

data class ResetPasswordRequest(
    @field:NotBlank(message = "Token is required")
    val token: String,

    @field:NotBlank(message = "Password is required")
    @field:Size(min = 8, message = "Password must be at least 8 characters")
    @field:Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
        message = "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
    )
    val password: String
)

fun User.toDto() = UserDto(
    id = this.id!!,
    email = this.email,
    name = this.name,
    role = this.role.name,
    enabled = this.enabled,
    changelogSeenVersion = this.changelogSeenVersion
)

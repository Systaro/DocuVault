package com.docuvault.api.auth

import com.docuvault.domain.user.PasswordResetToken
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.PasswordResetTokenRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.ApiTokenService
import com.docuvault.service.EmailService
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
    private val apiTokenService: ApiTokenService
) {
    private val logger = LoggerFactory.getLogger(AuthController::class.java)
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
            ?: return ResponseEntity.badRequest().body(mapOf("error" to "Invalid or expired reset link."))

        if (token.usedAt != null) {
            return ResponseEntity.badRequest().body(mapOf("error" to "This reset link has already been used."))
        }

        if (token.expiresAt.isBefore(Instant.now())) {
            return ResponseEntity.badRequest().body(mapOf("error" to "This reset link has expired. Please request a new one."))
        }

        val user = userRepository.findByEmail(token.email)
            ?: return ResponseEntity.badRequest().body(mapOf("error" to "Invalid or expired reset link."))

        user.passwordHash = passwordEncoder.encode(request.password)
        user.updatedAt = Instant.now()
        userRepository.save(user)

        token.usedAt = Instant.now()
        passwordResetTokenRepository.save(token)

        return ResponseEntity.ok(mapOf("message" to "Password has been reset successfully. You can now sign in."))
    }

    private fun sendPasswordResetEmail(token: PasswordResetToken) {
        val resetUrl = "https://docuvault.systaro.de/reset-password?token=${token.token}"
        emailService.sendHtml(
            to = token.email,
            subject = "Reset your DocuVault password",
            htmlBody = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f2f5; padding: 40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; width: 100%;">
        <!-- Header -->
        <tr><td style="background: linear-gradient(135deg, #4a8a8f 0%, #6fb3b8 50%, #8fcdd2 100%); border-radius: 16px 16px 0 0; padding: 40px 40px 32px; text-align: center;">
          <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
            <img src="https://docuvault.systaro.de/assets/logo.png" alt="DocuVault" width="36" height="36" style="display: block; filter: brightness(0) invert(1);" />
          </div>
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0 0 8px;">Reset Your Password</h1>
          <p style="color: rgba(255,255,255,0.85); font-size: 15px; margin: 0;">DocuVault account security</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="background: #ffffff; padding: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">Hi there,</p>
          <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 32px;">
            We received a request to reset your <strong style="color: #333;">DocuVault</strong> password.
            Click the button below to choose a new password.
          </p>
          <!-- Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding: 0 0 32px;">
            <a href="$resetUrl" style="display: inline-block; background: linear-gradient(135deg, #4a8a8f, #6fb3b8); color: #ffffff; padding: 14px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; letter-spacing: 0.3px; box-shadow: 0 4px 14px rgba(111,179,184,0.4);">
              Reset Password
            </a>
          </td></tr></table>
          <!-- Details -->
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
        <!-- Footer -->
        <tr><td style="background: #fafbfc; border-radius: 0 0 16px 16px; border-top: 1px solid #eef1f4; padding: 24px 40px; text-align: center;">
          <p style="color: #aaa; font-size: 12px; line-height: 1.6; margin: 0;">
            If you didn't request a password reset, you can safely ignore this email.<br>
            &copy; DocuVault &middot; <a href="https://docuvault.systaro.de" style="color: #6fb3b8; text-decoration: none;">docuvault.systaro.de</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
            """.trimIndent()
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

data class UserDto(
    val id: UUID,
    val email: String,
    val name: String,
    val role: String,
    val enabled: Boolean = true
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
    enabled = this.enabled
)

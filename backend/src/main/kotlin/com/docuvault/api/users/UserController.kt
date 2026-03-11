package com.docuvault.api.users

import com.docuvault.api.auth.UserDto
import com.docuvault.api.auth.toDto
import com.docuvault.domain.user.Invitation
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.InvitationRepository
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.core.userdetails.UserDetailsService
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.authentication.AuthenticationManager
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import com.docuvault.service.EmailService
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.*

@RestController
@RequestMapping("/users")
class UserController(
    private val userRepository: UserRepository,
    private val invitationRepository: InvitationRepository,
    private val spaceRepository: SpaceRepository,
    private val spacePermissionRepository: SpacePermissionRepository,
    private val passwordEncoder: PasswordEncoder,
    private val emailService: EmailService,
    private val authenticationManager: AuthenticationManager,
    private val userDetailsService: UserDetailsService
) {
    @GetMapping("/search")
    fun searchUsers(
        @RequestParam q: String,
        @RequestParam(required = false, defaultValue = "false") includeDisabled: Boolean
    ): ResponseEntity<List<UserSearchResult>> {
        if (q.length < 2) return ResponseEntity.ok(emptyList())
        val users = userRepository.searchByNameOrEmail(q)
            .filter { includeDisabled || it.enabled }
            .map { UserSearchResult(id = it.id!!, name = it.name, email = it.email) }
        return ResponseEntity.ok(users)
    }

    @GetMapping("/me")
    fun getCurrentUser(@AuthenticationPrincipal userDetails: UserDetails): ResponseEntity<UserDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(user.toDto())
    }

    @PutMapping("/me")
    fun updateCurrentUser(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: UpdateUserRequest
    ): ResponseEntity<UserDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()

        request.name?.let { user.name = it }
        request.password?.let { user.passwordHash = passwordEncoder.encode(it) }
        user.updatedAt = Instant.now()

        val updated = userRepository.save(user)
        return ResponseEntity.ok(updated.toDto())
    }

    @PostMapping("/me/change-password")
    fun changePassword(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: ChangePasswordRequest
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()

        if (!passwordEncoder.matches(request.currentPassword, user.passwordHash)) {
            return ResponseEntity.badRequest().body(mapOf("errors" to listOf("Current password is incorrect")))
        }

        user.passwordHash = passwordEncoder.encode(request.newPassword)
        user.updatedAt = Instant.now()
        userRepository.save(user)

        return ResponseEntity.ok(mapOf("message" to "Password changed successfully"))
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun listUsers(): ResponseEntity<List<UserDto>> {
        val users = userRepository.findAll().map { it.toDto() }
        return ResponseEntity.ok(users)
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun getUser(@PathVariable id: UUID): ResponseEntity<UserDto> {
        val user = userRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(user.toDto())
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun updateUser(
        @PathVariable id: UUID,
        @Valid @RequestBody request: AdminUpdateUserRequest
    ): ResponseEntity<UserDto> {
        val user = userRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        request.name?.let { user.name = it }
        request.role?.let { user.role = UserRole.valueOf(it) }
        user.updatedAt = Instant.now()

        val updated = userRepository.save(user)
        return ResponseEntity.ok(updated.toDto())
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun deleteUser(@PathVariable id: UUID): ResponseEntity<Unit> {
        if (!userRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }
        userRepository.deleteById(id)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{id}/permissions")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun getUserPermissions(@PathVariable id: UUID): ResponseEntity<List<UserPermissionDto>> {
        val user = userRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        val permissions = spacePermissionRepository.findAllByUserId(user.id!!)
        return ResponseEntity.ok(permissions.map {
            UserPermissionDto(
                spaceId = it.space.id!!,
                spaceName = it.space.name,
                spaceFullPath = it.space.getFullPath(),
                spaceType = it.space.type.name,
                permissionLevel = it.permissionLevel.name
            )
        })
    }

    @PutMapping("/{id}/permissions")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun setUserPermissions(
        @PathVariable id: UUID,
        @Valid @RequestBody request: SetUserPermissionsRequest
    ): ResponseEntity<List<UserPermissionDto>> {
        val user = userRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        // Get current permissions for this user
        val currentPermissions = spacePermissionRepository.findAllByUserId(user.id!!)
        val currentBySpaceId = currentPermissions.associateBy { it.space.id!! }

        // Desired permissions from request
        val desiredBySpaceId = request.permissions.associateBy { it.spaceId }

        // Remove permissions not in the new set
        currentBySpaceId.forEach { (spaceId, _) ->
            if (!desiredBySpaceId.containsKey(spaceId)) {
                spacePermissionRepository.deleteByUserIdAndSpaceId(user.id!!, spaceId)
            }
        }

        // Add or update permissions
        desiredBySpaceId.forEach { (spaceId, desired) ->
            val existing = currentBySpaceId[spaceId]
            val level = com.docuvault.domain.space.PermissionLevel.valueOf(desired.permissionLevel)
            if (existing != null) {
                if (existing.permissionLevel != level) {
                    existing.permissionLevel = level
                    spacePermissionRepository.save(existing)
                }
            } else {
                val space = spaceRepository.findById(spaceId).orElse(null) ?: return@forEach
                spacePermissionRepository.save(
                    com.docuvault.domain.space.SpacePermission(
                        user = user,
                        space = space,
                        permissionLevel = level
                    )
                )
            }
        }

        // Return updated permissions
        val updated = spacePermissionRepository.findAllByUserId(user.id!!)
        return ResponseEntity.ok(updated.map {
            UserPermissionDto(
                spaceId = it.space.id!!,
                spaceName = it.space.name,
                spaceFullPath = it.space.getFullPath(),
                spaceType = it.space.type.name,
                permissionLevel = it.permissionLevel.name
            )
        })
    }

    @PostMapping("/{id}/impersonate")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun impersonateUser(
        @PathVariable id: UUID,
        httpRequest: HttpServletRequest
    ): ResponseEntity<UserDto> {
        val targetUser = userRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (targetUser.role == UserRole.SUPER_ADMIN) {
            return ResponseEntity.badRequest().build()
        }

        val currentAuth = SecurityContextHolder.getContext().authentication
        val adminEmail = currentAuth.name

        val targetUserDetails = userDetailsService.loadUserByUsername(targetUser.email)
        val newAuth = UsernamePasswordAuthenticationToken(
            targetUserDetails, null, targetUserDetails.authorities
        )

        val session = httpRequest.getSession(true)
        session.setAttribute("ORIGINAL_ADMIN_EMAIL", adminEmail)
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = newAuth
        SecurityContextHolder.setContext(context)
        session.setAttribute("SPRING_SECURITY_CONTEXT", context)

        return ResponseEntity.ok(targetUser.toDto())
    }

    @PostMapping("/stop-impersonation")
    fun stopImpersonation(httpRequest: HttpServletRequest): ResponseEntity<UserDto> {
        val session = httpRequest.getSession(false)
            ?: return ResponseEntity.badRequest().build()

        val originalAdminEmail = session.getAttribute("ORIGINAL_ADMIN_EMAIL") as? String
            ?: return ResponseEntity.badRequest().build()

        val adminUser = userRepository.findByEmail(originalAdminEmail)
            ?: return ResponseEntity.badRequest().build()

        val adminUserDetails = userDetailsService.loadUserByUsername(adminUser.email)
        val adminAuth = UsernamePasswordAuthenticationToken(
            adminUserDetails, null, adminUserDetails.authorities
        )

        session.removeAttribute("ORIGINAL_ADMIN_EMAIL")
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = adminAuth
        SecurityContextHolder.setContext(context)
        session.setAttribute("SPRING_SECURITY_CONTEXT", context)

        return ResponseEntity.ok(adminUser.toDto())
    }

    @PostMapping("/invite")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun inviteUser(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: InviteUserRequest
    ): ResponseEntity<InvitationDto> {
        val inviter = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        // Check if an active (enabled) user already exists with this email
        val existingUser = userRepository.findByEmail(request.email)
        if (existingUser != null && existingUser.enabled) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build()
        }

        if (invitationRepository.findByEmailAndAcceptedAtIsNull(request.email).isNotEmpty()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build()
        }

        val space = request.spaceId?.let {
            spaceRepository.findById(it).orElse(null)
        }

        val userRole = UserRole.valueOf(request.role ?: "VIEWER")

        // Create a disabled placeholder user so permissions can be assigned before registration
        val placeholderUser = if (existingUser == null) {
            val user = User(
                email = request.email,
                passwordHash = passwordEncoder.encode(UUID.randomUUID().toString()),
                name = request.email.substringBefore("@"),
                role = userRole,
                enabled = false
            )
            userRepository.save(user)
        } else {
            // Re-use existing disabled placeholder (e.g., if invitation was deleted and re-sent)
            existingUser.role = userRole
            userRepository.save(existingUser)
        }

        // If a specific space was provided, grant permission on it
        if (space != null) {
            val permissionLevel = when (userRole) {
                UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN -> com.docuvault.domain.space.PermissionLevel.ADMIN
                UserRole.EDITOR -> com.docuvault.domain.space.PermissionLevel.EDIT
                UserRole.VIEWER -> com.docuvault.domain.space.PermissionLevel.VIEW
            }
            val existingPerm = spacePermissionRepository.findByUserIdAndSpaceId(placeholderUser.id!!, space.id!!)
            if (existingPerm == null) {
                spacePermissionRepository.save(
                    com.docuvault.domain.space.SpacePermission(
                        user = placeholderUser,
                        space = space,
                        permissionLevel = permissionLevel
                    )
                )
            }
        }

        val invitation = Invitation(
            email = request.email,
            space = space,
            role = userRole,
            token = UUID.randomUUID().toString(),
            expiresAt = Instant.now().plus(7, ChronoUnit.DAYS),
            createdBy = inviter
        )

        val saved = invitationRepository.save(invitation)
        sendInvitationEmail(saved)
        return ResponseEntity.status(HttpStatus.CREATED).body(saved.toDto())
    }

    @PostMapping("/invitations/{id}/resend")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun resendInvitation(@PathVariable id: UUID): ResponseEntity<Map<String, String>> {
        val invitation = invitationRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (invitation.acceptedAt != null) {
            return ResponseEntity.badRequest().body(mapOf("error" to "Invitation already accepted"))
        }

        // Refresh expiry
        invitation.expiresAt = Instant.now().plus(7, ChronoUnit.DAYS)
        invitationRepository.save(invitation)

        sendInvitationEmail(invitation)
        return ResponseEntity.ok(mapOf("message" to "Invitation resent to ${invitation.email}"))
    }

    private fun sendInvitationEmail(invitation: Invitation) {
        val acceptUrl = "https://docuvault.systaro.de/accept-invitation?token=${invitation.token}"
        val roleName = invitation.role.name.replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }
        val expiryDate = invitation.expiresAt.toString().substring(0, 10)
        emailService.sendHtml(
            to = invitation.email,
            subject = "You're invited to DocuVault",
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
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0 0 8px;">You're invited to DocuVault</h1>
          <p style="color: rgba(255,255,255,0.85); font-size: 15px; margin: 0;">Collaborative documentation with Git-powered version control</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="background: #ffffff; padding: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">Hi there,</p>
          <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 32px;">
            You've been invited to join <strong style="color: #333;">DocuVault</strong> as
            <span style="display: inline-block; background: #e8f5f6; color: #4a8a8f; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 600;">$roleName</span>.
            Click the button below to set up your account and get started.
          </p>
          <!-- Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding: 0 0 32px;">
            <a href="$acceptUrl" style="display: inline-block; background: linear-gradient(135deg, #4a8a8f, #6fb3b8); color: #ffffff; padding: 14px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; letter-spacing: 0.3px; box-shadow: 0 4px 14px rgba(111,179,184,0.4);">
              Accept Invitation
            </a>
          </td></tr></table>
          <!-- Details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8fafb; border-radius: 10px; border: 1px solid #e9eef2;">
            <tr><td style="padding: 20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color: #888; font-size: 13px; padding-bottom: 8px;">Role</td>
                  <td style="color: #333; font-size: 13px; font-weight: 600; text-align: right; padding-bottom: 8px;">$roleName</td>
                </tr>
                <tr>
                  <td style="color: #888; font-size: 13px;">Expires</td>
                  <td style="color: #333; font-size: 13px; font-weight: 600; text-align: right;">$expiryDate</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background: #fafbfc; border-radius: 0 0 16px 16px; border-top: 1px solid #eef1f4; padding: 24px 40px; text-align: center;">
          <p style="color: #aaa; font-size: 12px; line-height: 1.6; margin: 0;">
            If you didn't expect this invitation, you can safely ignore this email.<br>
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

    @DeleteMapping("/invitations/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun deleteInvitation(@PathVariable id: UUID): ResponseEntity<Unit> {
        val invitation = invitationRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (invitation.acceptedAt != null) {
            return ResponseEntity.badRequest().build()
        }

        invitationRepository.delete(invitation)

        // Clean up placeholder user if no other pending invitations exist for this email
        val otherInvitations = invitationRepository.findByEmailAndAcceptedAtIsNull(invitation.email)
        if (otherInvitations.isEmpty()) {
            val placeholderUser = userRepository.findByEmail(invitation.email)
            if (placeholderUser != null && !placeholderUser.enabled) {
                userRepository.delete(placeholderUser)
            }
        }

        return ResponseEntity.noContent().build()
    }

    @GetMapping("/invitations")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun listInvitations(): ResponseEntity<List<InvitationDto>> {
        val invitations = invitationRepository.findAll().map { it.toDto() }
        return ResponseEntity.ok(invitations)
    }

    @PostMapping("/accept-invitation")
    fun acceptInvitation(
        @Valid @RequestBody request: AcceptInvitationRequest,
        httpRequest: HttpServletRequest
    ): ResponseEntity<UserDto> {
        val invitation = invitationRepository.findByToken(request.token)
            ?: return ResponseEntity.notFound().build()

        if (invitation.acceptedAt != null) {
            return ResponseEntity.badRequest().build()
        }

        if (invitation.expiresAt.isBefore(Instant.now())) {
            return ResponseEntity.status(HttpStatus.GONE).build()
        }

        // Find the placeholder user created during invitation
        val existingUser = userRepository.findByEmail(invitation.email)

        val savedUser = if (existingUser != null && !existingUser.enabled) {
            // Activate the placeholder user
            existingUser.passwordHash = passwordEncoder.encode(request.password)
            existingUser.name = request.name
            existingUser.role = invitation.role
            existingUser.enabled = true
            existingUser.updatedAt = Instant.now()
            userRepository.save(existingUser)
        } else if (existingUser != null && existingUser.enabled) {
            // Already an active user with this email
            return ResponseEntity.status(HttpStatus.CONFLICT).build()
        } else {
            // No placeholder exists (edge case) — create fresh
            val user = User(
                email = invitation.email,
                passwordHash = passwordEncoder.encode(request.password),
                name = request.name,
                role = invitation.role,
                enabled = true
            )
            userRepository.save(user)
        }

        invitation.acceptedAt = Instant.now()
        invitationRepository.save(invitation)

        // Establish session for the new user
        val authToken = UsernamePasswordAuthenticationToken(invitation.email, request.password)
        val authentication = authenticationManager.authenticate(authToken)
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = authentication
        SecurityContextHolder.setContext(context)
        httpRequest.getSession(true).setAttribute("SPRING_SECURITY_CONTEXT", context)

        return ResponseEntity.status(HttpStatus.CREATED).body(savedUser.toDto())
    }
}

data class UpdateUserRequest(
    val name: String? = null,
    val password: String? = null
)

data class AdminUpdateUserRequest(
    val name: String? = null,
    val role: String? = null
)

data class InviteUserRequest(
    @field:NotBlank(message = "Email is required")
    @field:Email(message = "Invalid email format")
    val email: String,
    val spaceId: UUID? = null,
    val role: String? = "VIEWER"
)

data class AcceptInvitationRequest(
    @field:NotBlank(message = "Token is required")
    val token: String,

    @field:NotBlank(message = "Name is required")
    val name: String,

    @field:NotBlank(message = "Password is required")
    @field:jakarta.validation.constraints.Size(min = 8, message = "Password must be at least 8 characters")
    @field:jakarta.validation.constraints.Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@\$!%*?&\\-_#])[A-Za-z\\d@\$!%*?&\\-_#]{8,}$",
        message = "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
    )
    val password: String
)

data class ChangePasswordRequest(
    @field:NotBlank(message = "Current password is required")
    val currentPassword: String,

    @field:NotBlank(message = "New password is required")
    @field:jakarta.validation.constraints.Size(min = 8, message = "Password must be at least 8 characters")
    @field:jakarta.validation.constraints.Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@\$!%*?&\\-_#])[A-Za-z\\d@\$!%*?&\\-_#]{8,}$",
        message = "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character"
    )
    val newPassword: String
)

data class UserSearchResult(
    val id: UUID,
    val name: String,
    val email: String
)

data class InvitationDto(
    val id: UUID,
    val email: String,
    val spaceId: UUID?,
    val role: String,
    val token: String,
    val expiresAt: Instant,
    val accepted: Boolean,
    val createdAt: Instant
)

fun Invitation.toDto() = InvitationDto(
    id = this.id!!,
    email = this.email,
    spaceId = this.space?.id,
    role = this.role.name,
    token = this.token,
    expiresAt = this.expiresAt,
    accepted = this.acceptedAt != null,
    createdAt = this.createdAt
)

data class UserPermissionDto(
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val spaceType: String,
    val permissionLevel: String
)

data class SetUserPermissionsRequest(
    val permissions: List<PermissionEntry>
)

data class PermissionEntry(
    val spaceId: UUID,
    val permissionLevel: String
)

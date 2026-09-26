package com.docuvault.api.users

import com.docuvault.api.auth.UserDto
import com.docuvault.api.auth.toDto
import com.docuvault.api.teams.TeamBadgeDto
import com.docuvault.api.teams.TeamSpacePermissionDto
import com.docuvault.api.teams.toBadgeDto
import com.docuvault.api.teams.toDto as teamPermissionToDto
import com.docuvault.domain.user.Invitation
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.InvitationRepository
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
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
import com.docuvault.service.EmailLayout
import com.docuvault.service.EmailService
import com.docuvault.service.branding.BrandingService
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
    private val teamMembershipRepository: TeamMembershipRepository,
    private val teamPermissionRepository: TeamSpacePermissionRepository,
    private val teamService: com.docuvault.service.TeamService,
    private val permissionService: com.docuvault.service.PermissionService,
    private val passwordEncoder: PasswordEncoder,
    private val emailService: EmailService,
    private val authenticationManager: AuthenticationManager,
    private val userDetailsService: UserDetailsService,
    private val subscriptionService: com.docuvault.service.notification.NotificationSubscriptionService,
    private val brandingService: BrandingService
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
    @Transactional(readOnly = true)
    fun getCurrentUser(@AuthenticationPrincipal userDetails: UserDetails): ResponseEntity<UserDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(user.toDto().copy(teams = teamsOf(user.id!!)))
    }

    /**
     * Acknowledges the release notes up to the given version. The entries
     * themselves ship with the frontend, so only the marker lives server-side.
     */
    @PostMapping("/me/changelog-seen")
    fun markChangelogSeen(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: ChangelogSeenRequest
    ): ResponseEntity<Map<String, String>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()

        user.changelogSeenVersion = request.version
        user.updatedAt = Instant.now()
        userRepository.save(user)
        return ResponseEntity.ok(mapOf("changelogSeenVersion" to request.version))
    }

    private fun teamsOf(userId: UUID): List<TeamBadgeDto> =
        teamMembershipRepository.findAllByUserId(userId)
            .map { it.team.toBadgeDto() }
            .sortedBy { it.name.lowercase() }

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

    @GetMapping("/me/notifications")
    fun getNotificationPreferences(@AuthenticationPrincipal userDetails: UserDetails): ResponseEntity<NotificationPreferencesDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()

        val overrides = subscriptionService.overridesForUser(user.id!!)
        val spaces = permissionService.getGrantedSpaces(user.id!!)
            .sortedBy { it.getFullPath() }
            .map {
                SpaceNotificationDto(
                    spaceId = it.id!!,
                    name = it.name,
                    fullPath = it.getFullPath(),
                    type = it.type.name,
                    parentId = it.parent?.id,
                    enabled = subscriptionService.resolve(it, overrides),
                    override = overrides[it.id]
                )
            }

        return ResponseEntity.ok(
            NotificationPreferencesDto(pushMode = user.pushMode.name, emailMode = user.emailMode.name, spaces = spaces)
        )
    }

    @PutMapping("/me/notifications")
    fun updateNotificationPreferences(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: NotificationPreferencesDto
    ): ResponseEntity<NotificationPreferencesDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()
        try {
            user.pushMode = com.docuvault.domain.user.PushMode.valueOf(request.pushMode)
            user.emailMode = com.docuvault.domain.user.EmailMode.valueOf(request.emailMode)
        } catch (_: IllegalArgumentException) {
            return ResponseEntity.badRequest().build()
        }
        user.updatedAt = Instant.now()
        userRepository.save(user)
        return ResponseEntity.ok(NotificationPreferencesDto(pushMode = user.pushMode.name, emailMode = user.emailMode.name))
    }

    @PutMapping("/me/notifications/spaces/{spaceId}")
    @Transactional
    fun setSpaceNotification(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable spaceId: UUID,
        @RequestBody request: SpaceNotificationToggle
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()
        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()
        if (!canManageSpaceNotification(user, spaceId)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build()

        subscriptionService.setOverride(user, space, request.enabled)
        return ResponseEntity.noContent().build()
    }

    @DeleteMapping("/me/notifications/spaces/{spaceId}")
    @Transactional
    fun clearSpaceNotification(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable spaceId: UUID
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.notFound().build()
        if (!canManageSpaceNotification(user, spaceId)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build()

        subscriptionService.clearOverride(user.id!!, spaceId)
        return ResponseEntity.noContent().build()
    }

    private fun canManageSpaceNotification(user: User, spaceId: UUID): Boolean {
        if (user.role == UserRole.SUPER_ADMIN || user.role == UserRole.ORG_ADMIN) return true
        return permissionService.getEffectivePermission(user.id!!, spaceId) != null
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional(readOnly = true)
    fun listUsers(): ResponseEntity<List<UserDto>> {
        // One pass over all memberships instead of a query per user.
        val teamsByUser = teamMembershipRepository.findAll()
            .groupBy({ it.user.id!! }, { it.team.toBadgeDto() })

        val users = userRepository.findAll().map { user ->
            user.toDto().copy(
                teams = teamsByUser[user.id]?.sortedBy { it.name.lowercase() } ?: emptyList()
            )
        }
        return ResponseEntity.ok(users)
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional(readOnly = true)
    fun getUser(@PathVariable id: UUID): ResponseEntity<UserDto> {
        val user = userRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(user.toDto().copy(teams = teamsOf(user.id!!)))
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

    /**
     * The user's teams together with the grants each team confers, so the admin
     * UI can show inherited access next to the user's own permissions.
     */
    @GetMapping("/{id}/teams")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional(readOnly = true)
    fun getUserTeams(@PathVariable id: UUID): ResponseEntity<List<UserTeamDto>> {
        if (!userRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        val teams = teamMembershipRepository.findAllByUserId(id)
            .map { it.team }
            .sortedBy { it.name.lowercase() }
            .map { team ->
                UserTeamDto(
                    id = team.id!!,
                    name = team.name,
                    color = team.color,
                    permissions = teamPermissionRepository.findAllByTeamId(team.id!!)
                        .map { it.teamPermissionToDto() }
                        .sortedBy { it.spaceFullPath }
                )
            }
        return ResponseEntity.ok(teams)
    }

    @PutMapping("/{id}/teams")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun setUserTeams(
        @PathVariable id: UUID,
        @RequestBody request: SetUserTeamsRequest
    ): ResponseEntity<List<UserTeamDto>> {
        if (!userRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }
        teamService.setTeamsForUser(id, request.teamIds)
        return getUserTeams(id)
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

        // Teams are assigned to the placeholder account, exactly as the space
        // grant above is: by the time the person accepts, the access their teams
        // carry is already theirs, and the invitee shows up in the team's member
        // list while the invitation is still pending — which is what the admin
        // who picked the team was saying should happen.
        //
        // Naming no team leaves memberships alone rather than clearing them, so
        // re-sending an invitation does not quietly drop the teams someone was
        // already put into.
        if (request.teamIds.isNotEmpty()) {
            teamService.setTeamsForUser(placeholderUser.id!!, request.teamIds)
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
        val brand = brandingService.emailBrand()
        val appName = EmailLayout.escape(brand.appName)
        val acceptUrl = "${brand.publicUrl}/accept-invitation?token=${invitation.token}"
        val roleName = invitation.role.name.replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }
        val expiryDate = invitation.expiresAt.toString().substring(0, 10)
        emailService.sendHtml(
            to = invitation.email,
            subject = "You're invited to ${brand.appName}",
            htmlBody = EmailLayout.page("""
${EmailLayout.banner(brand, "You're invited to ${brand.appName}", "Collaborative documentation with Git-powered version control")}
        <tr><td style="padding: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">Hi there,</p>
          <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 32px;">
            You've been invited to join <strong style="color: #333;">$appName</strong> as
            <span style="display: inline-block; background: #f0f2f5; color: ${brand.color}; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 600;">$roleName</span>.
            Click the button below to set up your account and get started.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding: 0 0 32px;">
            ${EmailLayout.button(brand, acceptUrl, "Accept Invitation")}
          </td></tr></table>
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
${EmailLayout.footer("If you didn't expect this invitation, you can safely ignore this email.<br>&copy; ${EmailLayout.signature(brand)}")}
            """.trimIndent())
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

data class ChangelogSeenRequest(
    @field:jakarta.validation.constraints.Pattern(
        regexp = "^v\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$",
        message = "Version must look like v1.2.3"
    )
    val version: String
)

data class NotificationPreferencesDto(
    @field:jakarta.validation.constraints.NotBlank
    val pushMode: String,
    @field:jakarta.validation.constraints.NotBlank
    val emailMode: String,
    val spaces: List<SpaceNotificationDto> = emptyList()
)

data class SpaceNotificationDto(
    val spaceId: UUID,
    val name: String,
    val fullPath: String,
    val type: String,
    val parentId: UUID?,
    val enabled: Boolean,
    val override: Boolean?
)

data class SpaceNotificationToggle(
    val enabled: Boolean
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
    val role: String? = "VIEWER",
    /** Teams the person joins right away — see inviteUser for why that works. */
    val teamIds: List<UUID> = emptyList()
)

data class AcceptInvitationRequest(
    @field:NotBlank(message = "Token is required")
    val token: String,

    @field:NotBlank(message = "Name is required")
    val name: String,

    @field:NotBlank(message = "Password is required")
    @field:jakarta.validation.constraints.Size(min = 8, message = "Password must be at least 8 characters")
    @field:jakarta.validation.constraints.Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
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
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$",
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

data class UserTeamDto(
    val id: UUID,
    val name: String,
    val color: String?,
    val permissions: List<TeamSpacePermissionDto>
)

data class SetUserTeamsRequest(
    val teamIds: List<UUID> = emptyList()
)

data class PermissionEntry(
    val spaceId: UUID,
    val permissionLevel: String
)

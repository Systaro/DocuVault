package com.docuvault.service

import com.docuvault.domain.space.AccessRequest
import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.AccessRequestRepository
import com.docuvault.service.branding.BrandingService
import com.docuvault.service.branding.EmailBrand
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit

sealed interface AccessRequestResult {
    /** Mailed [notified] people who can grant the access. */
    data class Sent(val notified: Int) : AccessRequestResult
    /** Already asked recently; the admins were not mailed again. */
    data object AlreadyPending : AccessRequestResult
    /** The person can already open this space. */
    data object AlreadyHasAccess : AccessRequestResult
    /** Nobody could be told — worth surfacing rather than reporting success. */
    data object NoOneToNotify : AccessRequestResult
}

/**
 * "Request access" for a space someone cannot open.
 *
 * The interesting decision is who to tell. Rather than a single nominated
 * owner, the request goes to the people who could actually act on it, in
 * order of how close they are to the space:
 *
 *  1. Admins of the space itself or of a group above it, including admin
 *     rights granted through a team — these are the space's real owners.
 *  2. Failing that, whoever created the space.
 *  3. Failing that, the super admins, who can always grant.
 *
 * Super admins are deliberately last: on an install with many of them, a space
 * that has its own admins should not mail everybody.
 */
@Service
class AccessRequestService(
    private val accessRequestRepository: AccessRequestRepository,
    private val permissionService: PermissionService,
    private val emailService: EmailService,
    private val settingsService: SettingsService,
    private val brandingService: BrandingService
) {
    private val logger = LoggerFactory.getLogger(AccessRequestService::class.java)

    companion object {
        /** A repeat within this window is treated as the same request. */
        private const val DEDUPE_HOURS = 24L
        /** Ceiling on admins mailed for one request. */
        private const val MAX_RECIPIENTS = 10
    }

    @Transactional
    fun request(requester: User, space: Space, message: String?): AccessRequestResult {
        if (permissionService.hasAccess(requester.id!!, space.id!!, requester.role)) {
            return AccessRequestResult.AlreadyHasAccess
        }

        val since = Instant.now().minus(DEDUPE_HOURS, ChronoUnit.HOURS)
        if (accessRequestRepository.existsBySpaceIdAndUserIdAndCreatedAtAfter(space.id!!, requester.id!!, since)) {
            return AccessRequestResult.AlreadyPending
        }

        val recipients = recipientsFor(space).filter { it.id != requester.id }
        val record = accessRequestRepository.save(
            AccessRequest(space = space, user = requester, message = message?.take(1000))
        )

        // Nobody to tell, or no way to tell them. Both leave the requester waiting
        // for an answer that will never come, so both are reported as failures
        // rather than dressed up as a sent request.
        if (recipients.isEmpty()) {
            logger.warn("Access request for '${space.name}' by ${requester.email}: no one can grant it")
            return AccessRequestResult.NoOneToNotify
        }
        if (!settingsService.isMailConfigured()) {
            logger.warn("Access request for '${space.name}' by ${requester.email}: no SMTP configured, ${recipients.size} admin(s) not reached")
            return AccessRequestResult.NoOneToNotify
        }

        val brand = brandingService.emailBrand()
        recipients.forEach { admin ->
            emailService.sendHtml(
                to = admin.email,
                subject = "${requester.name} is asking for access to ${space.name}",
                htmlBody = emailBody(brand, requester, space, message, admin)
            )
        }

        // Counts the people addressed, not deliveries confirmed: sendHtml is
        // @Async and logs its own failures, so nothing here can observe the
        // outcome. Checking SMTP is configured above is as far as this can go.
        record.notified = recipients.size
        accessRequestRepository.save(record)
        return AccessRequestResult.Sent(recipients.size)
    }

    /** The people who could grant this, nearest first. See the class comment. */
    private fun recipientsFor(space: Space): List<User> {
        val members = permissionService.effectiveMembersOf(space)

        val spaceAdmins = members
            .filter { it.level == PermissionLevel.ADMIN && !it.superAdmin }
            .map { it.user }
        if (spaceAdmins.isNotEmpty()) return spaceAdmins.take(MAX_RECIPIENTS)

        val creator = space.createdBy.takeIf { it.enabled }
        if (creator != null) return listOf(creator)

        return members.filter { it.superAdmin }.map { it.user }.take(MAX_RECIPIENTS)
    }

    /** The requester's name and note reach an HTML email, so they are escaped. */
    private fun emailBody(brand: EmailBrand, requester: User, space: Space, message: String?, admin: User): String {
        val spaceUrl = "${brand.publicUrl}/spaces/${space.getFullPath()}"
        val settingsUrl = "$spaceUrl/settings"
        val note = message?.takeIf { it.isNotBlank() }?.let {
            """
            <tr><td style="padding: 0 0 24px;">
              <div style="background: #f6f8f8; border-left: 3px solid ${brand.color}; border-radius: 6px; padding: 14px 16px;">
                <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${escape(it)}</p>
              </div>
            </td></tr>
            """
        } ?: ""

        return EmailLayout.page("""
${EmailLayout.banner(brand, "Someone needs access", space.name)}
        <tr><td style="padding: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">Hi ${escape(admin.name)},</p>
          <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 24px;">
            <strong style="color: #333;">${escape(requester.name)}</strong>
            (${escape(requester.email)}) asked for access to
            <strong style="color: #333;">${escape(space.name)}</strong>.
            You are getting this because you can grant it.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">$note</table>
          <div style="margin: 0 0 28px;">${EmailLayout.button(brand, settingsUrl, "Manage access")}</div>
          <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 0;">
            If they should not have it, you can ignore this — nothing was granted.
          </p>
        </td></tr>
${EmailLayout.footer("""${escape(brand.appName)} · <a href="$spaceUrl" style="color: ${brand.color}; text-decoration: none;">${escape(space.getFullPath())}</a>""")}
        """.trimIndent())
    }

    private fun escape(text: String): String = EmailLayout.escape(text)
}

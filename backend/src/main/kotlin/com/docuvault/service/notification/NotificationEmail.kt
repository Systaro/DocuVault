package com.docuvault.service.notification

import com.docuvault.domain.space.ChangeType
import com.docuvault.service.EmailLayout
import com.docuvault.service.branding.EmailBrand
import java.util.*

/** A single file change as rendered in an email (decoupled from JPA entities). */
data class DigestChange(
    val changeType: ChangeType,
    val path: String,
    val oldPath: String?,
    val author: String
)

/** All changes for one space in a digest/instant email. */
data class DigestSpaceView(
    val spaceId: UUID,
    val spaceName: String,
    val changes: List<DigestChange>
)

object NotificationEmail {
    private const val MAX_ROWS_PER_GROUP = 15

    /**
     * RFC 8058 headers so mail clients render a native one-click unsubscribe.
     * Points at the public API endpoint (context-path /api). With a spaceId the
     * one-click mutes just that space; without it, it turns off all email.
     */
    fun unsubscribeHeaders(publicUrl: String, token: String, spaceId: UUID? = null): Map<String, String> {
        val scope = spaceId?.let { "&s=$it" } ?: ""
        return mapOf(
            "List-Unsubscribe" to "<$publicUrl/api/notifications/unsubscribe?t=$token$scope>",
            "List-Unsubscribe-Post" to "List-Unsubscribe=One-Click"
        )
    }

    /** Real-time email for a single commit in a single space. */
    fun buildInstant(view: DigestSpaceView, author: String, brand: EmailBrand, token: String): String {
        val total = view.changes.size
        return wrap(
            heading = "New activity",
            subheading = "${escapeHtml(author)} made $total change${plural(total)} in ${escapeHtml(view.spaceName)}",
            body = renderSpaceSection(view, brand, token),
            brand = brand,
            token = token
        )
    }

    /** Consolidated digest covering every space a user is subscribed to in this window. */
    fun buildDigest(spaces: List<DigestSpaceView>, periodLabel: String, brand: EmailBrand, token: String): String {
        val totalChanges = spaces.sumOf { it.changes.size }
        val spaceCount = spaces.size
        val subheading =
            "$totalChanges change${plural(totalChanges)} across $spaceCount space${plural(spaceCount)} you follow"
        val body = spaces.joinToString("\n") { renderSpaceSection(it, brand, token) }
        return wrap(
            heading = "${periodLabel.replaceFirstChar { it.uppercase() }} digest",
            subheading = subheading,
            body = body,
            brand = brand,
            token = token
        )
    }

    /** One-time announcement when notifications are switched on for the release. */
    fun buildAnnouncement(name: String, brand: EmailBrand, token: String): String {
        val body = """
        <tr><td style="padding:24px 32px;color:#444;font-size:15px;line-height:1.7;">
          <p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
          <p style="margin:0 0 16px;">
            We've turned on <strong>daily change digests</strong> for the ${escapeHtml(brand.appName)} spaces you're part of.
            Once a day you'll get a single email summarising what was added, edited, renamed or removed —
            so you can keep up without watching the repos.
          </p>
          <p style="margin:0 0 8px;">You're in control:</p>
          <ul style="margin:0 0 16px;padding-left:20px;color:#555;font-size:14px;line-height:1.7;">
            <li>Switch to instant or hourly, or turn email off entirely.</li>
            <li>Mute individual repositories or whole groups.</li>
          </ul>
          <div style="padding:8px 0 0;">${EmailLayout.button(brand, "${brand.publicUrl}/account", "Manage notifications")}</div>
        </td></tr>
        """.trimIndent()
        return wrap(
            heading = "Notifications are on",
            subheading = "Daily digests for the spaces you follow",
            body = body,
            brand = brand,
            token = token
        )
    }

    // --- section rendering -------------------------------------------------

    private fun renderSpaceSection(view: DigestSpaceView, brand: EmailBrand, token: String): String {
        val total = view.changes.size
        val byType = view.changes.groupBy { it.changeType }
        val chips = TYPE_ORDER.mapNotNull { type ->
            byType[type]?.size?.let { count -> chip(type, count, brand) }
        }.joinToString("")

        val groups = TYPE_ORDER.mapNotNull { type ->
            byType[type]?.takeIf { it.isNotEmpty() }?.let { changes -> renderGroup(type, changes, brand) }
        }.joinToString("\n")

        val muteUrl = "${brand.publicUrl}/unsubscribe?t=$token&s=${view.spaceId}"

        return """
        <tr><td style="padding:24px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:16px;font-weight:700;color:#222;">${escapeHtml(view.spaceName)}</td>
            <td style="text-align:right;color:#888;font-size:13px;white-space:nowrap;">$total change${plural(total)}</td>
          </tr></table>
          <div style="margin:8px 0 4px;">$chips</div>
        </td></tr>
        $groups
        <tr><td style="padding:12px 32px 20px;border-bottom:1px solid #eef1f4;">
          <a href="${brand.publicUrl}/spaces" style="color:${brand.color};text-decoration:none;font-size:13px;font-weight:600;">Open ${escapeHtml(view.spaceName)}</a>
          <span style="color:#ccc;"> &nbsp;·&nbsp; </span>
          <a href="$muteUrl" style="color:#aaa;text-decoration:none;font-size:13px;">Mute this repository</a>
        </td></tr>
        """.trimIndent()
    }

    private fun renderGroup(type: ChangeType, changes: List<DigestChange>, brand: EmailBrand): String {
        val color = typeColor(type, brand)
        val shown = changes.take(MAX_ROWS_PER_GROUP)
        val overflow = changes.size - shown.size
        val rows = shown.joinToString("\n") { fileRow(it, color) }
        val more = if (overflow > 0)
            """<tr><td colspan="3" style="padding:2px 32px 2px 44px;color:#aaa;font-size:12px;">+$overflow more</td></tr>"""
        else ""
        // Nest the rows table inside a <td> of a single <tr> so it stays within the
        // outer 640px card. Emitting a bare <table> between outer-table rows makes
        // clients close the outer table and the rows escape the card.
        return """
        <tr><td style="padding:10px 32px 2px;color:$color;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${verb(type)}</td></tr>
        <tr><td style="padding:0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">
            $rows
            $more
          </table>
        </td></tr>
        """.trimIndent()
    }

    private fun fileRow(change: DigestChange, color: String): String {
        val label = if (change.changeType == ChangeType.RENAMED && change.oldPath != null) {
            "${prettyPath(change.oldPath)} <span style=\"color:#bbb;\">&rarr;</span> ${prettyPath(change.path)}"
        } else {
            prettyPath(change.path)
        }
        return """<tr>
            |<td width="8" style="padding:4px 0 4px 32px;vertical-align:top;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:$color;margin-top:6px;"></span></td>
            |<td style="padding:4px 12px 4px 6px;font-size:13px;color:#333;word-break:break-all;overflow-wrap:anywhere;">$label</td>
            |<td width="110" style="padding:4px 32px 4px 12px;font-size:12px;color:#999;text-align:right;vertical-align:top;word-break:break-word;">${escapeHtml(change.author)}</td>
            |</tr>""".trimMargin()
    }

    /** Render "folder/sub/" dimmed and the filename emphasised. */
    private fun prettyPath(path: String): String {
        val idx = path.lastIndexOf('/')
        return if (idx >= 0) {
            val dir = escapeHtml(path.substring(0, idx + 1))
            val file = escapeHtml(path.substring(idx + 1))
            "<span style=\"color:#aaa;\">$dir</span><span style=\"color:#333;\">$file</span>"
        } else {
            "<span style=\"color:#333;\">${escapeHtml(path)}</span>"
        }
    }

    private fun chip(type: ChangeType, count: Int, brand: EmailBrand): String {
        val color = typeColor(type, brand)
        return """<span style="display:inline-block;margin:0 6px 4px 0;font-size:12px;color:$color;">
            |<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:$color;vertical-align:middle;margin-right:5px;"></span>$count ${verb(type).lowercase()}</span>""".trimMargin()
    }

    private fun verb(type: ChangeType): String = when (type) {
        ChangeType.ADDED -> "Added"
        ChangeType.MODIFIED -> "Edited"
        ChangeType.DELETED -> "Removed"
        ChangeType.RENAMED -> "Renamed"
    }

    private fun typeColor(type: ChangeType, brand: EmailBrand): String = when (type) {
        ChangeType.ADDED -> "#16a34a"
        ChangeType.MODIFIED -> brand.color
        ChangeType.DELETED -> "#dc2626"
        ChangeType.RENAMED -> "#b7791f"
    }

    private fun plural(n: Int) = if (n == 1) "" else "s"

    private val TYPE_ORDER = listOf(ChangeType.ADDED, ChangeType.MODIFIED, ChangeType.RENAMED, ChangeType.DELETED)

    // --- shell + footer ----------------------------------------------------

    private fun wrap(heading: String, subheading: String, body: String, brand: EmailBrand, token: String): String {
        val text = EmailLayout.textOn(brand.color)
        return EmailLayout.page(width = 640, rows = """
        <tr><td style="background-color:${brand.color};padding:24px 32px;color:$text;">
          <h1 style="margin:0;font-size:20px;font-weight:700;">${escapeHtml(heading)}</h1>
          <p style="margin:4px 0 0;font-size:14px;opacity:.9;">${escapeHtml(subheading)}</p>
        </td></tr>
        $body
        ${footer(brand, token)}
        """.trimIndent())
    }

    private fun footer(brand: EmailBrand, token: String): String {
        val manageUrl = "${brand.publicUrl}/account"
        val unsubAllUrl = "${brand.publicUrl}/unsubscribe?t=$token"
        return EmailLayout.footer("""
            You're receiving this because notifications are on for ${escapeHtml(brand.appName)} spaces you follow.<br>
            <a href="$manageUrl" style="color:${brand.color};text-decoration:none;">Manage notifications</a>
            <span style="color:#ccc;"> &nbsp;·&nbsp; </span>
            <a href="$unsubAllUrl" style="color:#999;text-decoration:underline;">Unsubscribe from all</a>
        """.trimIndent())
    }

    private fun escapeHtml(s: String): String = EmailLayout.escape(s)
}

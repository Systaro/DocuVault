package com.docuvault.service.notification

import com.docuvault.domain.space.ChangeType
import com.docuvault.domain.space.SpaceChangeEvent
import com.docuvault.service.git.DetectedChange

object NotificationEmail {
    fun buildInstant(spaceName: String, author: String, changes: List<DetectedChange>): String {
        val rows = changes.joinToString("\n") { c ->
            row(verb(c.changeType), c.filePath, author)
        }
        return wrap(
            spaceName = spaceName,
            heading = "New activity",
            subheading = "$author made ${changes.size} change${if (changes.size == 1) "" else "s"} in ${escapeHtml(spaceName)}",
            tableRows = rows
        )
    }

    fun buildDigest(spaceName: String, events: List<SpaceChangeEvent>, periodLabel: String): String {
        val rows = events.joinToString("\n") { evt ->
            val author = evt.triggeredBy?.name ?: evt.commitAuthorName ?: "Unknown"
            row(verb(evt.changeType), evt.filePath, author)
        }
        return wrap(
            spaceName = spaceName,
            heading = "$periodLabel updates",
            subheading = "${escapeHtml(spaceName)} &middot; ${events.size} change${if (events.size == 1) "" else "s"} in the last $periodLabel",
            tableRows = rows
        )
    }

    private fun row(verb: String, path: String, author: String): String =
        """<tr>
            |<td style="padding:8px 12px;color:#888;font-size:12px;white-space:nowrap;">$verb</td>
            |<td style="padding:8px 12px;color:#333;font-size:13px;">${escapeHtml(path)}</td>
            |<td style="padding:8px 12px;color:#888;font-size:12px;white-space:nowrap;">${escapeHtml(author)}</td>
            |</tr>""".trimMargin()

    private fun verb(type: ChangeType): String = when (type) {
        ChangeType.ADDED -> "added"
        ChangeType.MODIFIED -> "edited"
        ChangeType.DELETED -> "deleted"
        ChangeType.RENAMED -> "renamed"
    }

    private fun wrap(spaceName: String, heading: String, subheading: String, tableRows: String): String = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#4a8a8f 0%,#6fb3b8 100%);padding:24px 32px;color:#fff;">
          <h1 style="margin:0;font-size:20px;">$heading</h1>
          <p style="margin:4px 0 0;font-size:14px;opacity:.9;">$subheading</p>
        </td></tr>
        <tr><td style="padding:0 16px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            $tableRows
          </table>
        </td></tr>
        <tr><td style="background:#fafbfc;padding:16px 32px;border-top:1px solid #eef1f4;text-align:center;">
          <a href="https://docuvault.systaro.de" style="color:#6fb3b8;text-decoration:none;font-size:13px;">Open DocuVault</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".trimIndent()

    private fun escapeHtml(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}

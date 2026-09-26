package com.docuvault.service

import com.docuvault.service.branding.EmailBrand
import org.springframework.web.util.HtmlUtils

/**
 * The shell every HTML email shares: page, coloured banner, button and footer.
 * Inline styles and tables only, because that is what mail clients render.
 */
object EmailLayout {

    /** A white card on a grey page; [rows] are `<tr>` elements. */
    fun page(rows: String, width: Int = 560): String = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="$width" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
$rows
      </table>
    </td></tr>
  </table>
</body>
</html>
""".trimIndent()

    /** Centred header in the brand colour, topped by the logo or, without one, the app name. */
    fun banner(brand: EmailBrand, title: String, subtitle: String): String {
        val text = textOn(brand.color)
        val mark = brand.logoUrl?.let {
            """<img src="$it" alt="${escape(brand.appName)}" height="40" style="display:block;margin:0 auto 20px;height:40px;width:auto;max-width:220px;border:0;" />"""
        } ?: """<p style="color:$text;font-size:15px;font-weight:700;letter-spacing:.02em;margin:0 0 20px;">${escape(brand.appName)}</p>"""
        return """
        <tr><td style="background-color:${brand.color};padding:36px 40px 32px;text-align:center;">
          $mark
          <h1 style="color:$text;font-size:22px;font-weight:700;margin:0 0 8px;">${escape(title)}</h1>
          <p style="color:$text;opacity:.85;font-size:15px;margin:0;">${escape(subtitle)}</p>
        </td></tr>
        """.trimIndent()
    }

    fun button(brand: EmailBrand, href: String, label: String): String = """
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background-color:${brand.color};">
          <a href="$href" style="display:inline-block;padding:12px 26px;color:${textOn(brand.color)};font-size:15px;font-weight:600;text-decoration:none;">${escape(label)}</a>
        </td></tr></table>
    """.trimIndent()

    /** [html] is inserted as is; escape anything user supplied before passing it. */
    fun footer(html: String): String = """
        <tr><td style="background:#fafbfc;border-top:1px solid #eef1f4;padding:20px 40px;text-align:center;">
          <p style="color:#999;font-size:12px;line-height:1.6;margin:0;">$html</p>
        </td></tr>
    """.trimIndent()

    /** "App name · host", linking back to the install. */
    fun signature(brand: EmailBrand): String =
        """${escape(brand.appName)} &middot; <a href="${brand.publicUrl}" style="color:${brand.color};text-decoration:none;">${escape(brand.host)}</a>"""

    fun escape(text: String): String = HtmlUtils.htmlEscape(text)

    /**
     * White on dark brand colours, near-black on light ones, so a pale brand
     * colour stays readable. The cut-off sits above the contrast-neutral 0.18
     * because white reads better on mid tones such as the default teal.
     */
    fun textOn(hex: String): String {
        val rgb = hex.removePrefix("#").chunked(2).map { it.toInt(16) / 255.0 }
            .map { if (it <= 0.03928) it / 12.92 else Math.pow((it + 0.055) / 1.055, 2.4) }
        val luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        return if (luminance > 0.3) "#1a1a1a" else "#ffffff"
    }
}

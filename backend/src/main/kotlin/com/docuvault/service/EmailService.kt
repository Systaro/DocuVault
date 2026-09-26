package com.docuvault.service

import com.docuvault.service.branding.BrandingService
import org.slf4j.LoggerFactory
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSenderImpl
import org.springframework.mail.javamail.MimeMessageHelper
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Service

@Service
class EmailService(
    private val settingsService: SettingsService,
    private val brandingService: BrandingService
) {
    private val logger = LoggerFactory.getLogger(EmailService::class.java)

    /**
     * Build a JavaMailSender from the live settings on each call. Cheap to
     * construct; lets admin changes from /admin/settings take effect without
     * a restart.
     */
    fun buildSender(): JavaMailSenderImpl = JavaMailSenderImpl().apply {
        host = settingsService.getMailHost()
        port = settingsService.getMailPort()
        username = settingsService.getMailUsername()
        password = settingsService.getMailPassword()
        defaultEncoding = "UTF-8"
        javaMailProperties.apply {
            setProperty("mail.transport.protocol", "smtp")
            setProperty("mail.smtp.auth", if (username.isNullOrBlank()) "false" else "true")
            setProperty("mail.smtp.starttls.enable", settingsService.getMailStartTls().toString())
            setProperty("mail.smtp.connectiontimeout", "5000")
            setProperty("mail.smtp.timeout", "5000")
            setProperty("mail.smtp.writetimeout", "5000")
        }
    }

    /** An explicitly configured sender name wins; otherwise mail goes out under the app's own name. */
    private fun fromName(): String = settingsService.getMailFromName().ifBlank { brandingService.appName() }

    /** A fresh install has no SMTP server; skipping beats an SMTP error per mail. */
    private fun skipUnconfigured(subject: String): Boolean {
        if (settingsService.isMailConfigured()) return false
        logger.warn("Mail host not configured, not sending: $subject")
        return true
    }

    @Async
    fun sendSimple(to: String, subject: String, body: String) {
        if (skipUnconfigured(subject)) return
        try {
            val sender = buildSender()
            val message = SimpleMailMessage()
            message.from = "${fromName()} <${settingsService.getMailFromAddress()}>"
            message.setTo(to)
            message.subject = subject
            message.text = body
            sender.send(message)
            logger.info("Email sent successfully: $subject")
        } catch (e: Exception) {
            logger.error("Failed to send email: ${e.message}", e)
        }
    }

    @Async
    fun sendHtml(to: String, subject: String, htmlBody: String, headers: Map<String, String> = emptyMap()) {
        if (skipUnconfigured(subject)) return
        try {
            val sender = buildSender()
            val mimeMessage = sender.createMimeMessage()
            val helper = MimeMessageHelper(mimeMessage, true, "UTF-8")
            helper.setFrom(settingsService.getMailFromAddress(), fromName())
            helper.setTo(to)
            helper.setSubject(subject)
            helper.setText(htmlBody, true)
            headers.forEach { (name, value) -> mimeMessage.setHeader(name, value) }
            sender.send(mimeMessage)
            logger.info("HTML email sent successfully: $subject")
        } catch (e: Exception) {
            logger.error("Failed to send HTML email: ${e.message}", e)
        }
    }

    /**
     * Synchronous send used by the admin "send test mail" button. Throws on
     * failure so the controller can return the SMTP error to the UI.
     */
    fun sendTestSync(to: String) {
        val sender = buildSender()
        val mimeMessage = sender.createMimeMessage()
        val helper = MimeMessageHelper(mimeMessage, true, "UTF-8")
        val appName = brandingService.appName()
        helper.setFrom(settingsService.getMailFromAddress(), fromName())
        helper.setTo(to)
        helper.setSubject("$appName — test email")
        helper.setText(
            """
            <p>If you're reading this, your ${EmailLayout.escape(appName)} SMTP settings are working.</p>
            <p>Sent from <strong>${settingsService.getMailFromAddress()}</strong>
               via <code>${settingsService.getMailHost()}:${settingsService.getMailPort()}</code>.</p>
            """.trimIndent(),
            true
        )
        sender.send(mimeMessage)
    }
}

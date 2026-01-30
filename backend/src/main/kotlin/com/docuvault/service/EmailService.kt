package com.docuvault.service

import org.slf4j.LoggerFactory
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.mail.javamail.MimeMessageHelper
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Service

@Service
class EmailService(
    private val mailSender: JavaMailSender
) {
    private val logger = LoggerFactory.getLogger(EmailService::class.java)

    companion object {
        const val FROM_ADDRESS = "noreply@systaro.de"
        const val FROM_NAME = "DocuVault"
    }

    @Async
    fun sendSimple(to: String, subject: String, body: String) {
        try {
            val message = SimpleMailMessage()
            message.from = "$FROM_NAME <$FROM_ADDRESS>"
            message.setTo(to)
            message.subject = subject
            message.text = body
            mailSender.send(message)
            logger.info("Email sent successfully: $subject")
        } catch (e: Exception) {
            logger.error("Failed to send email: ${e.message}", e)
        }
    }

    @Async
    fun sendHtml(to: String, subject: String, htmlBody: String) {
        try {
            val mimeMessage = mailSender.createMimeMessage()
            val helper = MimeMessageHelper(mimeMessage, true, "UTF-8")
            helper.setFrom(FROM_ADDRESS, FROM_NAME)
            helper.setTo(to)
            helper.setSubject(subject)
            helper.setText(htmlBody, true)
            mailSender.send(mimeMessage)
            logger.info("HTML email sent successfully: $subject")
        } catch (e: Exception) {
            logger.error("Failed to send HTML email: ${e.message}", e)
        }
    }
}

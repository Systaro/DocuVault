package com.docuvault.service

import com.docuvault.domain.AppSetting
import com.docuvault.infrastructure.repository.AppSettingRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.security.SecureRandom

@Service
class SettingsService(
    private val appSettingRepository: AppSettingRepository,
    @Value("\${gitlab.url}") private val defaultGitlabUrl: String,
    @Value("\${gitlab.token}") private val defaultGitlabToken: String,
    @Value("\${openai.api-key}") private val defaultOpenaiApiKey: String,
    @Value("\${openai.chat-model}") private val defaultChatModel: String,
    @Value("\${openai.edit-model:}") private val defaultEditModel: String,
    @Value("\${openai.embedding-model}") private val defaultEmbeddingModel: String,
    @Value("\${spring.mail.host:}") private val defaultMailHost: String,
    @Value("\${spring.mail.port:25}") private val defaultMailPort: String,
    @Value("\${spring.mail.username:}") private val defaultMailUsername: String,
    @Value("\${spring.mail.password:}") private val defaultMailPassword: String,
    @Value("\${spring.mail.properties.mail.smtp.starttls.enable:true}") private val defaultMailStartTls: String,
    @Value("\${app.mail.from-address}") private val defaultMailFromAddress: String,
    @Value("\${app.mail.from-name}") private val defaultMailFromName: String,
    @Value("\${pdf.render-url:}") private val defaultPdfRenderUrl: String,
    @Value("\${pdf.api-key:}") private val defaultPdfApiKey: String,
    @Value("\${encryption.key}") private val encryptionKeySource: String
) {
    private val encryptionKey: SecretKeySpec by lazy {
        val keyBytes = encryptionKeySource.toByteArray().copyOf(32)
        SecretKeySpec(keyBytes, "AES")
    }

    private fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val iv = ByteArray(12)
        SecureRandom().nextBytes(iv)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey, GCMParameterSpec(128, iv))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val combined = iv + ciphertext
        return Base64.getEncoder().encodeToString(combined)
    }

    private fun decrypt(encrypted: String): String {
        return try {
            val combined = Base64.getDecoder().decode(encrypted)
            val iv = combined.copyOfRange(0, 12)
            val ciphertext = combined.copyOfRange(12, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey, GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (e: Exception) {
            // Fallback: value may not be encrypted yet (migration)
            encrypted
        }
    }
    companion object {
        const val GITLAB_URL = "gitlab.url"
        const val GITLAB_TOKEN = "gitlab.token"
        const val OPENAI_API_KEY = "openai.api-key"
        const val OPENAI_CHAT_MODEL = "openai.chat-model"
        const val OPENAI_EDIT_MODEL = "openai.edit-model"
        const val OPENAI_EMBEDDING_MODEL = "openai.embedding-model"
        const val MAIL_HOST = "mail.host"
        const val MAIL_PORT = "mail.port"
        const val MAIL_USERNAME = "mail.username"
        const val MAIL_PASSWORD = "mail.password"
        const val MAIL_STARTTLS = "mail.starttls"
        const val MAIL_FROM_ADDRESS = "mail.from-address"
        const val MAIL_FROM_NAME = "mail.from-name"

        // Optional HTML-to-PDF renderer. Left blank the product falls back to
        // the browser's own print dialog, so a self-hosted install without one
        // still exports — just not as a downloaded file.
        const val PDF_RENDER_URL = "pdf.render-url"
        const val PDF_API_KEY = "pdf.api-key"
    }

    fun get(key: String): String? {
        val setting = appSettingRepository.findById(key).orElse(null) ?: return null
        return if (setting.encrypted && setting.value != null) {
            decrypt(setting.value!!)
        } else {
            setting.value
        }
    }

    fun set(key: String, value: String?, encrypted: Boolean = false) {
        val setting = appSettingRepository.findById(key).orElse(null)
            ?: AppSetting(key = key, encrypted = encrypted)
        setting.value = if (encrypted && value != null) encrypt(value) else value
        setting.updatedAt = Instant.now()
        appSettingRepository.save(setting)
    }

    fun getAll(): Map<String, String?> {
        return appSettingRepository.findAll().associate { it.key to it.value }
    }

    fun getOrDefault(key: String, default: String): String {
        return get(key)?.takeIf { it.isNotBlank() } ?: default
    }

    // Convenience methods with env var fallback
    fun getGitlabUrl(): String {
        return getOrDefault(GITLAB_URL, defaultGitlabUrl)
    }

    fun getGitlabToken(): String {
        return getOrDefault(GITLAB_TOKEN, defaultGitlabToken)
    }

    fun getOpenaiApiKey(): String {
        return getOrDefault(OPENAI_API_KEY, defaultOpenaiApiKey)
    }

    fun getChatModel(): String {
        return getOrDefault(OPENAI_CHAT_MODEL, defaultChatModel)
    }

    /** Blank means "use the chat model" — see OpenAIProvider.getEditModel(). */
    fun getEditModel(): String {
        return getOrDefault(OPENAI_EDIT_MODEL, defaultEditModel)
    }

    fun getEmbeddingModel(): String {
        return getOrDefault(OPENAI_EMBEDDING_MODEL, defaultEmbeddingModel)
    }

    fun getMailHost(): String = getOrDefault(MAIL_HOST, defaultMailHost)
    fun getMailPort(): Int = getOrDefault(MAIL_PORT, defaultMailPort).toIntOrNull() ?: 25
    fun getMailUsername(): String = getOrDefault(MAIL_USERNAME, defaultMailUsername)
    fun getMailPassword(): String = getOrDefault(MAIL_PASSWORD, defaultMailPassword)
    fun getMailStartTls(): Boolean = getOrDefault(MAIL_STARTTLS, defaultMailStartTls).toBooleanStrictOrNull() ?: true
    fun getMailFromAddress(): String = getOrDefault(MAIL_FROM_ADDRESS, defaultMailFromAddress)
    /** Blank means "use the app name" — see EmailService. */
    fun getMailFromName(): String = getOrDefault(MAIL_FROM_NAME, defaultMailFromName)
    fun isMailConfigured(): Boolean = getMailHost().isNotBlank()

    fun getPdfRenderUrl(): String = getOrDefault(PDF_RENDER_URL, defaultPdfRenderUrl)
    fun getPdfApiKey(): String = getOrDefault(PDF_API_KEY, defaultPdfApiKey)
    /** Only the URL is required — a renderer may well need no key. */
    fun isPdfConfigured(): Boolean = getPdfRenderUrl().isNotBlank()

    // Get all settings with masked sensitive values
    fun getAllSettingsForDisplay(): Map<String, SettingValue> {
        val dbSettings = getAll()

        return mapOf(
            GITLAB_URL to SettingValue(
                value = dbSettings[GITLAB_URL]?.takeIf { it.isNotBlank() } ?: defaultGitlabUrl,
                source = if (dbSettings[GITLAB_URL]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            GITLAB_TOKEN to SettingValue(
                value = maskToken(dbSettings[GITLAB_TOKEN]?.takeIf { it.isNotBlank() } ?: defaultGitlabToken),
                source = if (dbSettings[GITLAB_TOKEN]?.isNotBlank() == true) "database" else "environment",
                masked = true,
                configured = (dbSettings[GITLAB_TOKEN]?.isNotBlank() == true) || defaultGitlabToken.isNotBlank()
            ),
            OPENAI_API_KEY to SettingValue(
                value = maskToken(dbSettings[OPENAI_API_KEY]?.takeIf { it.isNotBlank() } ?: defaultOpenaiApiKey),
                source = if (dbSettings[OPENAI_API_KEY]?.isNotBlank() == true) "database" else "environment",
                masked = true,
                configured = (dbSettings[OPENAI_API_KEY]?.isNotBlank() == true) || defaultOpenaiApiKey.isNotBlank()
            ),
            OPENAI_CHAT_MODEL to SettingValue(
                value = dbSettings[OPENAI_CHAT_MODEL]?.takeIf { it.isNotBlank() } ?: defaultChatModel,
                source = if (dbSettings[OPENAI_CHAT_MODEL]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            OPENAI_EDIT_MODEL to SettingValue(
                value = dbSettings[OPENAI_EDIT_MODEL]?.takeIf { it.isNotBlank() } ?: defaultEditModel,
                source = if (dbSettings[OPENAI_EDIT_MODEL]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            OPENAI_EMBEDDING_MODEL to SettingValue(
                value = dbSettings[OPENAI_EMBEDDING_MODEL]?.takeIf { it.isNotBlank() } ?: defaultEmbeddingModel,
                source = if (dbSettings[OPENAI_EMBEDDING_MODEL]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            MAIL_HOST to SettingValue(
                value = dbSettings[MAIL_HOST]?.takeIf { it.isNotBlank() } ?: defaultMailHost,
                source = if (dbSettings[MAIL_HOST]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            MAIL_PORT to SettingValue(
                value = dbSettings[MAIL_PORT]?.takeIf { it.isNotBlank() } ?: defaultMailPort,
                source = if (dbSettings[MAIL_PORT]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            MAIL_USERNAME to SettingValue(
                value = dbSettings[MAIL_USERNAME]?.takeIf { it.isNotBlank() } ?: defaultMailUsername,
                source = if (dbSettings[MAIL_USERNAME]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            MAIL_PASSWORD to SettingValue(
                value = maskToken(dbSettings[MAIL_PASSWORD]?.takeIf { it.isNotBlank() } ?: defaultMailPassword),
                source = if (dbSettings[MAIL_PASSWORD]?.isNotBlank() == true) "database" else "environment",
                masked = true,
                configured = (dbSettings[MAIL_PASSWORD]?.isNotBlank() == true) || defaultMailPassword.isNotBlank()
            ),
            MAIL_STARTTLS to SettingValue(
                value = dbSettings[MAIL_STARTTLS]?.takeIf { it.isNotBlank() } ?: defaultMailStartTls,
                source = if (dbSettings[MAIL_STARTTLS]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            MAIL_FROM_ADDRESS to SettingValue(
                value = dbSettings[MAIL_FROM_ADDRESS]?.takeIf { it.isNotBlank() } ?: defaultMailFromAddress,
                source = if (dbSettings[MAIL_FROM_ADDRESS]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            MAIL_FROM_NAME to SettingValue(
                value = dbSettings[MAIL_FROM_NAME]?.takeIf { it.isNotBlank() } ?: defaultMailFromName,
                source = if (dbSettings[MAIL_FROM_NAME]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            PDF_RENDER_URL to SettingValue(
                value = dbSettings[PDF_RENDER_URL]?.takeIf { it.isNotBlank() } ?: defaultPdfRenderUrl,
                source = if (dbSettings[PDF_RENDER_URL]?.isNotBlank() == true) "database" else "environment",
                masked = false
            ),
            PDF_API_KEY to SettingValue(
                value = maskToken(dbSettings[PDF_API_KEY]?.takeIf { it.isNotBlank() } ?: defaultPdfApiKey),
                source = if (dbSettings[PDF_API_KEY]?.isNotBlank() == true) "database" else "environment",
                masked = true,
                configured = (dbSettings[PDF_API_KEY]?.isNotBlank() == true) || defaultPdfApiKey.isNotBlank()
            )
        )
    }

    private fun maskToken(token: String): String {
        if (token.isBlank()) return ""
        if (token.length <= 8) return "••••••••"
        return token.take(4) + "••••••••" + token.takeLast(4)
    }
}

data class SettingValue(
    val value: String,
    val source: String, // "database" or "environment"
    val masked: Boolean = false,
    val configured: Boolean = true
)

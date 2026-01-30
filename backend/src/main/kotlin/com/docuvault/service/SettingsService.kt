package com.docuvault.service

import com.docuvault.domain.AppSetting
import com.docuvault.infrastructure.repository.AppSettingRepository
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.time.Instant

@Service
class SettingsService(
    private val appSettingRepository: AppSettingRepository,
    @Value("\${gitlab.url}") private val defaultGitlabUrl: String,
    @Value("\${gitlab.token}") private val defaultGitlabToken: String,
    @Value("\${openai.api-key}") private val defaultOpenaiApiKey: String,
    @Value("\${openai.chat-model}") private val defaultChatModel: String,
    @Value("\${openai.embedding-model}") private val defaultEmbeddingModel: String
) {
    companion object {
        const val GITLAB_URL = "gitlab.url"
        const val GITLAB_TOKEN = "gitlab.token"
        const val OPENAI_API_KEY = "openai.api-key"
        const val OPENAI_CHAT_MODEL = "openai.chat-model"
        const val OPENAI_EMBEDDING_MODEL = "openai.embedding-model"
    }

    fun get(key: String): String? {
        return appSettingRepository.findById(key).orElse(null)?.value
    }

    fun set(key: String, value: String?, encrypted: Boolean = false) {
        val setting = appSettingRepository.findById(key).orElse(null)
            ?: AppSetting(key = key, encrypted = encrypted)
        setting.value = value
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

    fun getEmbeddingModel(): String {
        return getOrDefault(OPENAI_EMBEDDING_MODEL, defaultEmbeddingModel)
    }

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
            OPENAI_EMBEDDING_MODEL to SettingValue(
                value = dbSettings[OPENAI_EMBEDDING_MODEL]?.takeIf { it.isNotBlank() } ?: defaultEmbeddingModel,
                source = if (dbSettings[OPENAI_EMBEDDING_MODEL]?.isNotBlank() == true) "database" else "environment",
                masked = false
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

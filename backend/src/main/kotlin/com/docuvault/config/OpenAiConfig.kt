package com.docuvault.config

import com.aallam.openai.api.http.Timeout
import com.aallam.openai.client.OpenAI
import com.docuvault.service.SettingsService
import org.springframework.stereotype.Component
import kotlin.time.Duration.Companion.seconds

@Component
class OpenAIProvider(
    private val settingsService: SettingsService
) {
    fun getClient(): OpenAI? {
        val apiKey = settingsService.getOpenaiApiKey()

        return if (apiKey.isNotBlank()) {
            OpenAI(
                token = apiKey,
                timeout = Timeout(socket = 60.seconds)
            )
        } else {
            null
        }
    }

    fun isConfigured(): Boolean {
        return settingsService.getOpenaiApiKey().isNotBlank()
    }

    fun getChatModel(): String {
        return settingsService.getChatModel()
    }

    fun getEmbeddingModel(): String {
        return settingsService.getEmbeddingModel()
    }
}

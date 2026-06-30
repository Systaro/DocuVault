package com.docuvault.config

import com.aallam.openai.api.http.Timeout
import com.aallam.openai.client.OpenAI
import com.docuvault.service.SettingsService
import org.springframework.stereotype.Component
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

@Component
class OpenAIProvider(
    private val settingsService: SettingsService
) {
    // Non-streaming calls hold the socket idle while the model generates, so the socket
    // timeout effectively bounds total generation time. 60s suits interactive calls;
    // long-output calls (e.g. whole-document translation) pass a larger value.
    fun getClient(socketTimeout: Duration = 60.seconds): OpenAI? {
        val apiKey = settingsService.getOpenaiApiKey()

        return if (apiKey.isNotBlank()) {
            OpenAI(
                token = apiKey,
                timeout = Timeout(socket = socketTimeout)
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

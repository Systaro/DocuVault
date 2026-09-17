package com.docuvault.service.ai

import com.aallam.openai.api.audio.TranscriptionRequest
import com.aallam.openai.api.file.FileSource
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import kotlinx.coroutines.runBlocking
import okio.Buffer
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import kotlin.time.Duration.Companion.seconds

/** Speech to text for voice input, with the OpenAI key from the admin settings. */
@Service
class TranscriptionService(
    private val openAIProvider: OpenAIProvider,
    @Value("\${openai.transcription-model:gpt-4o-transcribe}") private val model: String
) {
    companion object {
        /** OpenAI's own limit for one transcription request. */
        const val MAX_BYTES = 25L * 1024 * 1024
    }

    fun transcribe(audio: ByteArray, fileName: String, language: String?): String {
        if (audio.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "The recording is empty")
        if (audio.size > MAX_BYTES) throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "The recording is longer than voice input allows")
        val openAI = openAIProvider.getClient(socketTimeout = 120.seconds)
            ?: throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI features are not configured")

        val transcription = runBlocking {
            openAI.transcription(
                TranscriptionRequest(
                    audio = FileSource(name = fileName, source = Buffer().write(audio)),
                    model = ModelId(model),
                    language = language?.takeIf { it.matches(Regex("^[a-z]{2}$")) }
                )
            )
        }
        return transcription.text.trim()
    }
}

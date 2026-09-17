package com.docuvault.api.capture

import com.docuvault.service.ai.TranscriptionService
import com.docuvault.service.capture.CaptureService
import com.docuvault.service.capture.CaptureSuggestionDto
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException

@RestController
class CaptureController(
    private val captureService: CaptureService,
    private val transcriptionService: TranscriptionService
) {
    /** Where a quick note should go and which tasks it holds. Nothing is saved. */
    @PostMapping("/capture/suggest")
    fun suggest(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: CaptureSuggestRequest
    ): CaptureSuggestionDto = captureService.suggest(userDetails.username, request.content)

    /** Turns a voice recording into text for the note or question being typed. */
    @PostMapping("/ai/transcribe", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun transcribe(
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam("audio") audio: MultipartFile,
        @RequestParam(required = false) language: String?
    ): TranscriptionDto {
        val type = audio.contentType.orEmpty()
        if (!type.startsWith("audio/") && !type.startsWith("video/webm")) {
            throw ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Voice input expects an audio recording")
        }
        val extension = when {
            type.contains("webm") -> "webm"
            type.contains("ogg") -> "ogg"
            type.contains("mp4") || type.contains("m4a") -> "m4a"
            type.contains("wav") -> "wav"
            type.contains("mpeg") -> "mp3"
            else -> "webm"
        }
        return TranscriptionDto(transcriptionService.transcribe(audio.bytes, "recording.$extension", language))
    }
}

data class CaptureSuggestRequest(
    @field:NotBlank(message = "The note is empty")
    val content: String
)

data class TranscriptionDto(val text: String)

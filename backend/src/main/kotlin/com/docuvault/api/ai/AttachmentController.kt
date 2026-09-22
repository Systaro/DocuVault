package com.docuvault.api.ai

import com.docuvault.service.ai.AttachmentDto
import com.docuvault.service.ai.AttachmentService
import com.docuvault.service.ai.SavedAttachmentDto
import jakarta.validation.Valid
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.NotNull
import org.springframework.http.CacheControl
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import java.nio.charset.StandardCharsets
import java.util.*
import java.util.concurrent.TimeUnit

/** Files for the assistant: uploaded before a question or quick note is sent, private to their owner. */
@RestController
@RequestMapping("/ai/attachments")
class AttachmentController(private val attachmentService: AttachmentService) {

    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam("files") files: List<MultipartFile>
    ): List<AttachmentDto> = attachmentService.upload(userDetails.username, files)

    /** The original file, for thumbnails and for opening it again from the conversation. */
    @GetMapping("/{id}/content")
    fun content(@AuthenticationPrincipal userDetails: UserDetails, @PathVariable id: UUID): ResponseEntity<ByteArray> {
        val (attachment, bytes) = attachmentService.content(userDetails.username, id)
        // Text is served as plain text whatever it is, so an uploaded file never runs as a page.
        val type = if (attachment.contentType.startsWith("text/")) "text/plain;charset=UTF-8" else attachment.contentType
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(type))
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(attachment.fileName, StandardCharsets.UTF_8).build().toString())
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
            .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePrivate())
            .body(bytes)
    }

    /** Reads photos and files into the text of a quick note: handwriting, printed pages, PDFs. */
    @PostMapping("/read")
    fun read(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: ReadAttachmentsRequest
    ): ReadAttachmentsDto = ReadAttachmentsDto(attachmentService.transcribe(userDetails.username, request.attachmentIds))

    /** Commits the original file into a space. The assistant calls this when asked to keep a file. */
    @PostMapping("/{id}/save")
    fun save(
        @AuthenticationPrincipal userDetails: UserDetails,
        @PathVariable id: UUID,
        @Valid @RequestBody request: SaveAttachmentRequest
    ): SavedAttachmentDto = attachmentService.saveToSpace(userDetails.username, id, request.spaceId!!, request.path)
}

data class ReadAttachmentsRequest(
    @field:NotEmpty(message = "No files to read")
    val attachmentIds: List<UUID> = emptyList()
)

data class ReadAttachmentsDto(val text: String)

data class SaveAttachmentRequest(
    @field:NotNull(message = "spaceId is required")
    val spaceId: UUID? = null,
    /** Repository-relative target; defaults to attachments/<file name>. */
    val path: String? = null
)

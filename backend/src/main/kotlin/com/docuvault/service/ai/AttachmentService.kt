package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.chat.ContentPart
import com.aallam.openai.api.chat.ImagePart
import com.aallam.openai.api.chat.TextPart
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.AssistantAttachment
import com.docuvault.domain.ai.AttachmentKind
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.AssistantAttachmentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.FileUploadService
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import com.docuvault.service.requireSpaceWritable
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import java.time.Instant
import java.util.*
import kotlin.time.Duration.Companion.seconds

data class AttachmentDto(
    val id: UUID,
    val fileName: String,
    val contentType: String,
    val kind: AttachmentKind,
    val sizeBytes: Long,
    val pageCount: Int?
)

data class SavedAttachmentDto(val spaceId: UUID, val path: String, val name: String)

/**
 * Files people give the assistant: photos and scans (handwriting included),
 * PDFs and text files. They are stored privately for their owner, read into
 * the model's input when a question is sent with them, and only reach a
 * space when the user asks for that.
 */
@Service
class AttachmentService(
    private val repository: AssistantAttachmentRepository,
    private val userRepository: UserRepository,
    private val spaceRepository: SpaceRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val fileUploadService: FileUploadService,
    private val openAIProvider: OpenAIProvider,
    private val s3Client: S3Client,
    @Value("\${minio.attachments-bucket}") private val bucket: String
) {
    private val logger = LoggerFactory.getLogger(AttachmentService::class.java)

    companion object {
        const val MAX_FILE_BYTES = 20L * 1024 * 1024
        const val MAX_FILES_PER_MESSAGE = 10
        /** Images sent to the model in one request; older ones beyond this are named, not shown. */
        const val MAX_IMAGES_PER_REQUEST = 16
        private const val MAX_TEXT_PER_ATTACHMENT = 40_000
        private val UNSENT_TTL = java.time.Duration.ofDays(1)

        private val READ_INSTRUCTIONS = """
            You turn photos, scans and files into the text of a note for a note-taking app.
            - Transcribe handwriting and printed text faithfully, in the language it is written in. Do not translate, summarise or correct it.
            - Keep the structure in Markdown: headings, lists, numbered steps, checkboxes as "- [ ]" or "- [x]", tables where there is one.
            - Join lines that only break because the paper or column ended; keep line breaks the writer meant.
            - Keep crossed-out words crossed out (~~like this~~). Mark words you cannot read as [illegible].
            - Several files: give each its own section, in the order received, without commentary.
            - Answer with the transcription only.
        """.trimIndent()
    }

    // ---- Upload and download ------------------------------------------------------------

    @Transactional
    fun upload(userEmail: String, files: List<MultipartFile>): List<AttachmentDto> {
        if (files.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "No files")
        if (files.size > MAX_FILES_PER_MESSAGE) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "At most $MAX_FILES_PER_MESSAGE files at once")
        }
        val user = user(userEmail)
        return files.map { store(user, it) }
    }

    private fun store(user: User, file: MultipartFile): AttachmentDto {
        val fileName = displayName(file.originalFilename)
        if (file.size > MAX_FILE_BYTES) {
            throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "$fileName is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB")
        }
        val bytes = file.bytes
        val detected = try {
            AttachmentFiles.detect(fileName, bytes)
        } catch (e: UnsupportedAttachmentException) {
            throw ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, e.message)
        }

        val key = "${user.id}/${UUID.randomUUID()}"
        var extracted: String? = null
        var pageImages = 0
        var pageCount: Int? = null
        when (detected.kind) {
            AttachmentKind.PDF -> {
                val pdf = try {
                    AttachmentFiles.readPdf(fileName, bytes)
                } catch (e: UnsupportedAttachmentException) {
                    throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, e.message)
                }
                extracted = pdf.text
                pageCount = pdf.pageCount
                pdf.renderedPages.forEachIndexed { index, png -> put(pageKey(key, index), png, "image/png") }
                pageImages = pdf.renderedPages.size
            }
            AttachmentKind.TEXT -> extracted = AttachmentFiles.decodeUtf8(bytes)?.take(AttachmentFiles.MAX_TEXT_CHARS)
            AttachmentKind.IMAGE -> Unit
        }
        put(key, bytes, detected.contentType)

        val saved = repository.save(
            AssistantAttachment(
                user = user,
                fileName = fileName,
                contentType = detected.contentType,
                sizeBytes = bytes.size.toLong(),
                kind = detected.kind,
                storageKey = key,
                extractedText = extracted,
                pageImages = pageImages,
                pageCount = pageCount
            )
        )
        return saved.toDto()
    }

    /** The file, for its owner only; anyone else gets a 404, as for a file that does not exist. */
    @Transactional(readOnly = true)
    fun content(userEmail: String, id: UUID): Pair<AssistantAttachment, ByteArray> {
        val attachment = owned(user(userEmail), id)
        return attachment to get(attachment.storageKey)
    }

    // ---- Sending with a message ----------------------------------------------------------

    /**
     * Binds files to the conversation they are sent in. A file already sent
     * belongs to its conversation and cannot be moved to another one.
     */
    @Transactional
    fun attach(user: User, conversationId: UUID, ids: List<UUID>): List<AssistantAttachment> {
        if (ids.isEmpty()) return emptyList()
        if (ids.size > MAX_FILES_PER_MESSAGE) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "At most $MAX_FILES_PER_MESSAGE files per message")
        }
        return ownedAll(user, ids).map { attachment ->
            if (attachment.conversationId != null && attachment.conversationId != conversationId) {
                throw ResponseStatusException(HttpStatus.CONFLICT, "${attachment.fileName} belongs to another conversation")
            }
            attachment.conversationId = conversationId
            repository.save(attachment)
        }
    }

    @Transactional(readOnly = true)
    fun byIds(ids: Collection<UUID>): Map<UUID, AssistantAttachment> =
        if (ids.isEmpty()) emptyMap() else repository.findAllById(ids.toSet()).associateBy { it.id!! }

    /**
     * The model's view of [attachments]: text parts for text and PDF content,
     * image parts for photos and scanned pages. [imageBudget] limits how many
     * images are included; the rest are only named.
     */
    fun contentParts(attachments: List<AssistantAttachment>, imageBudget: Int): Pair<List<ContentPart>, Int> {
        var images = 0
        val parts = mutableListOf<ContentPart>()
        attachments.forEach { attachment ->
            val label = "Attachment \"${attachment.fileName}\" [attachment_id: ${attachment.id}]"
            when (attachment.kind) {
                AttachmentKind.IMAGE -> {
                    if (images < imageBudget) {
                        parts += TextPart("$label, an image:")
                        parts += ImagePart(dataUrl(attachment.contentType, get(attachment.storageKey)), "high")
                        images++
                    } else {
                        parts += TextPart("$label, an image sent earlier (not shown again).")
                    }
                }
                AttachmentKind.PDF -> {
                    val pages = attachment.pageCount?.let { ", $it pages" } ?: ""
                    parts += TextPart("$label, a PDF$pages:\n${clip(attachment.extractedText)}")
                    for (index in 0 until attachment.pageImages) {
                        if (images >= imageBudget) break
                        parts += TextPart("Scanned page image ${index + 1} of \"${attachment.fileName}\":")
                        parts += ImagePart(dataUrl("image/png", get(pageKey(attachment.storageKey, index))), "high")
                        images++
                    }
                }
                AttachmentKind.TEXT -> parts += TextPart("$label, a text file:\n${clip(attachment.extractedText)}")
            }
        }
        return parts to images
    }

    // ---- Quick note ------------------------------------------------------------------------

    /** Reads photos and files into the text of a quick note. Nothing is stored beyond the upload. */
    fun transcribe(userEmail: String, ids: List<UUID>): String {
        if (ids.isEmpty()) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "No files to read")
        if (ids.size > MAX_FILES_PER_MESSAGE) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "At most $MAX_FILES_PER_MESSAGE files at once")
        }
        val attachments = ownedAll(user(userEmail), ids)
        val openAI = openAIProvider.getClient(socketTimeout = 180.seconds)
            ?: throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI features are not configured")
        val (parts, _) = contentParts(attachments, MAX_IMAGES_PER_REQUEST)
        val response = runBlocking {
            openAI.chatCompletion(
                ChatCompletionRequest(
                    model = ModelId(openAIProvider.getChatModel()),
                    messages = listOf(
                        ChatMessage(role = ChatRole.System, content = READ_INSTRUCTIONS),
                        ChatMessage(role = ChatRole.User, content = parts)
                    )
                )
            )
        }
        return response.choices.firstOrNull()?.message?.content?.trim().orEmpty()
            .removePrefix("```markdown").removePrefix("```").removeSuffix("```").trim()
    }

    // ---- Keeping a file in a space ----------------------------------------------------------

    /**
     * Commits the original file into a repository space the user can edit.
     * Refuses to replace an existing file: that would silently overwrite
     * someone's work with an upload.
     */
    @Transactional
    fun saveToSpace(userEmail: String, id: UUID, spaceId: UUID, requestedPath: String?): SavedAttachmentDto {
        val user = user(userEmail)
        val attachment = owned(user, id)
        val space = spaceRepository.findById(spaceId).orElse(null)
            ?.takeIf { it.type == SpaceType.REPOSITORY }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Space not found")
        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "You cannot add files to this space")
        }
        requireSpaceWritable(space)

        val path = fileUploadService.sanitizeRelativePath(requestedPath?.ifBlank { null } ?: "attachments/${attachment.fileName}")
            ?.let { if (it.endsWith("/")) "$it${attachment.fileName}" else it }
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Not a valid path")
        if (gitService.readFile(space, path) != null) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "$path already exists. Choose another name.")
        }
        val stored = fileUploadService.store(space, path, get(attachment.storageKey))
            ?: throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not write $path")
        fileUploadService.commit(space, listOf(stored), user, "Add $path from an assistant conversation")
        return SavedAttachmentDto(space.id!!, stored.path, stored.name)
    }

    // ---- Housekeeping --------------------------------------------------------------------------

    /**
     * Removes files that never reached a conversation (uploaded and not sent,
     * read into a quick note) or lost theirs when it was deleted.
     */
    @Scheduled(cron = "0 17 * * * *")
    @Transactional
    fun sweep() {
        val stale = repository.findByConversationIdIsNullAndCreatedAtBefore(Instant.now().minus(UNSENT_TTL))
        if (stale.isEmpty()) return
        stale.forEach { attachment ->
            delete(attachment.storageKey)
            for (index in 0 until attachment.pageImages) delete(pageKey(attachment.storageKey, index))
        }
        repository.deleteAll(stale)
        logger.info("Removed ${stale.size} unsent assistant attachment(s)")
    }

    // ---- Helpers ------------------------------------------------------------------------------

    private fun user(email: String): User =
        userRepository.findByEmail(email) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)

    private fun owned(user: User, id: UUID): AssistantAttachment =
        repository.findByIdAndUserId(id, user.id!!)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Attachment not found")

    /** In the order asked for; someone else's file is reported as missing. */
    private fun ownedAll(user: User, ids: List<UUID>): List<AssistantAttachment> {
        val wanted = ids.distinct()
        val found = repository.findByIdInAndUserId(wanted, user.id!!).associateBy { it.id!! }
        return wanted.map { found[it] ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Attachment not found") }
    }

    private fun displayName(original: String?): String {
        val base = original?.substringAfterLast('/')?.substringAfterLast('\\')?.trim().orEmpty()
        val cleaned = base.filter { it >= ' ' && it != '"' }.take(200)
        return cleaned.ifBlank { "file" }
    }

    private fun pageKey(key: String, index: Int) = "$key.page-${index + 1}.png"

    private fun clip(text: String?): String {
        val value = text.orEmpty()
        return if (value.length <= MAX_TEXT_PER_ATTACHMENT) value
        else value.take(MAX_TEXT_PER_ATTACHMENT) + "\n[... the rest of the file is not included]"
    }

    private fun dataUrl(contentType: String, bytes: ByteArray) =
        "data:$contentType;base64,${Base64.getEncoder().encodeToString(bytes)}"

    private fun put(key: String, bytes: ByteArray, contentType: String) {
        s3Client.putObject(
            PutObjectRequest.builder().bucket(bucket).key(key).contentType(contentType).build(),
            RequestBody.fromBytes(bytes)
        )
    }

    private fun get(key: String): ByteArray =
        s3Client.getObjectAsBytes(GetObjectRequest.builder().bucket(bucket).key(key).build()).asByteArray()

    private fun delete(key: String) {
        try {
            s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build())
        } catch (e: Exception) {
            logger.warn("Could not delete attachment object $key: ${e.message}")
        }
    }

    private fun AssistantAttachment.toDto() = AttachmentDto(id!!, fileName, contentType, kind, sizeBytes, pageCount)
}

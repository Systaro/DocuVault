package com.docuvault.api.documents

import com.docuvault.domain.space.Document
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.ai.TranslationService
import com.docuvault.service.git.GitService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.security.MessageDigest
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/documents")
class DocumentTranslationController(
    private val spaceRepository: SpaceRepository,
    private val documentRepository: DocumentRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val translationService: TranslationService
) {
    @GetMapping("/translations")
    fun listTranslations(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam(required = false) path: String?
    ): ResponseEntity<List<DocumentTranslationsDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return if (path != null) {
            val languages = translationService.listLanguagesForDocument(spaceId, path)
            val body = if (languages.isEmpty()) emptyList() else listOf(DocumentTranslationsDto(path, languages))
            ResponseEntity.ok(body)
        } else {
            val body = translationService.listLanguagesBySpace(spaceId)
                .map { DocumentTranslationsDto(it.key, it.value) }
            ResponseEntity.ok(body)
        }
    }

    @PostMapping("/translate")
    fun translate(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: TranslateRequest
    ): ResponseEntity<TranslateResponse> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (!translationService.isSupported(request.targetLanguage)) {
            return ResponseEntity.badRequest().build()
        }

        val content = gitService.readFile(space, request.path)
            ?: return ResponseEntity.notFound().build()

        val contentHash = hashContent(content)

        // Translations are cached per document; ensure a document row exists so the
        // cache has a stable id to hang off (git-synced files are normally already
        // registered, but create the record defensively if not).
        val document = documentRepository.findBySpaceIdAndPath(spaceId, request.path)
            ?: documentRepository.save(
                Document(
                    space = space,
                    path = request.path,
                    title = extractTitle(content, request.path),
                    contentHash = contentHash,
                    lastSyncedAt = Instant.now()
                )
            )

        val result = translationService.getOrCreateTranslation(
            document = document,
            sourceContent = content,
            sourceContentHash = contentHash,
            targetLanguage = request.targetLanguage
        ) ?: return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build()

        return ResponseEntity.ok(
            TranslateResponse(
                targetLanguage = result.targetLanguage,
                content = result.content,
                cached = result.cached
            )
        )
    }

    private fun extractTitle(content: String, path: String): String {
        val headingMatch = Regex("^#\\s+(.+)$", RegexOption.MULTILINE).find(content)
        if (headingMatch != null) {
            return headingMatch.groupValues[1].trim()
        }
        return path.substringAfterLast("/").substringBeforeLast(".")
    }

    private fun hashContent(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(content.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}

data class TranslateRequest(
    @field:NotBlank(message = "Path is required")
    val path: String,

    @field:NotBlank(message = "Target language is required")
    val targetLanguage: String
)

data class TranslateResponse(
    val targetLanguage: String,
    val content: String,
    val cached: Boolean
)

data class DocumentTranslationsDto(
    val path: String,
    val languages: List<String>
)

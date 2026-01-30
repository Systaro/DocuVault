package com.docuvault.api.documents

import com.docuvault.domain.space.Document
import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.FileNode
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
class DocumentController(
    private val spaceRepository: SpaceRepository,
    private val documentRepository: DocumentRepository,
    private val spacePermissionRepository: SpacePermissionRepository,
    private val userRepository: UserRepository,
    private val gitService: GitService,
    private val embeddingService: EmbeddingService
) {
    @GetMapping("/tree")
    fun getFileTree(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<FileNode>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val tree = gitService.getFileTree(space)
        return ResponseEntity.ok(tree)
    }

    @GetMapping
    fun listDocuments(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<DocumentDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val documents = documentRepository.findBySpaceId(spaceId)
        return ResponseEntity.ok(documents.map { it.toDto() })
    }

    @GetMapping("/**")
    fun getDocument(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        request: jakarta.servlet.http.HttpServletRequest
    ): ResponseEntity<DocumentContentDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Extract path from URL
        val fullPath = request.requestURI
        val basePath = "/api/spaces/$spaceId/documents/"
        val documentPath = if (fullPath.startsWith(basePath)) {
            fullPath.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }

        val content = gitService.readFile(space, documentPath)
            ?: return ResponseEntity.notFound().build()

        val document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)

        return ResponseEntity.ok(
            DocumentContentDto(
                id = document?.id,
                path = documentPath,
                title = document?.title ?: extractTitle(content, documentPath),
                content = content,
                lastSyncedAt = document?.lastSyncedAt
            )
        )
    }

    @PostMapping
    fun createDocument(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: CreateDocumentRequest
    ): ResponseEntity<DocumentContentDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Write file to git
        if (!gitService.writeFile(space, request.path, request.content)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
        }

        val contentHash = hashContent(request.content)

        val document = Document(
            space = space,
            path = request.path,
            title = request.title ?: extractTitle(request.content, request.path),
            contentHash = contentHash,
            lastSyncedAt = Instant.now()
        )

        val saved = documentRepository.save(document)

        // Generate embeddings asynchronously
        embeddingService.processDocument(saved.id!!, request.content)

        return ResponseEntity.status(HttpStatus.CREATED).body(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = request.content,
                lastSyncedAt = saved.lastSyncedAt
            )
        )
    }

    @PutMapping("/**")
    fun updateDocument(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: UpdateDocumentRequest,
        servletRequest: jakarta.servlet.http.HttpServletRequest
    ): ResponseEntity<DocumentContentDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Extract path from URL
        val fullPath = servletRequest.requestURI
        val basePath = "/api/spaces/$spaceId/documents/"
        val documentPath = if (fullPath.startsWith(basePath)) {
            fullPath.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }

        // Write file to git
        if (!gitService.writeFile(space, documentPath, request.content)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
        }

        val contentHash = hashContent(request.content)
        val now = Instant.now()

        var document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)

        if (document != null) {
            document.title = request.title ?: extractTitle(request.content, documentPath)
            document.contentHash = contentHash
            document.lastSyncedAt = now
            document.updatedAt = now
        } else {
            document = Document(
                space = space,
                path = documentPath,
                title = request.title ?: extractTitle(request.content, documentPath),
                contentHash = contentHash,
                lastSyncedAt = now
            )
        }

        val saved = documentRepository.save(document)

        // Re-generate embeddings
        embeddingService.processDocument(saved.id!!, request.content)

        // Commit and push if autoCommit is requested
        if (request.autoCommit == true) {
            gitService.commitAndPush(
                space = space,
                message = request.commitMessage ?: "Update ${documentPath}",
                authorName = user.name,
                authorEmail = user.email
            )
        }

        return ResponseEntity.ok(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = request.content,
                lastSyncedAt = saved.lastSyncedAt
            )
        )
    }

    @DeleteMapping("/**")
    fun deleteDocument(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        request: jakarta.servlet.http.HttpServletRequest
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Extract path from URL
        val fullPath = request.requestURI
        val basePath = "/api/spaces/$spaceId/documents/"
        val documentPath = if (fullPath.startsWith(basePath)) {
            fullPath.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }

        // Delete from git
        gitService.deleteFile(space, documentPath)

        // Delete from database
        val document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)
        document?.let { documentRepository.delete(it) }

        return ResponseEntity.noContent().build()
    }

    private fun hasAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return spacePermissionRepository.findByUserIdAndSpaceId(userId, spaceId) != null
    }

    private fun hasEditAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return spacePermissionRepository.existsByUserIdAndSpaceIdAndPermissionLevelIn(
            userId,
            spaceId,
            listOf(PermissionLevel.EDIT, PermissionLevel.ADMIN)
        )
    }

    private fun extractTitle(content: String, path: String): String {
        // Try to extract title from markdown heading
        val headingMatch = Regex("^#\\s+(.+)$", RegexOption.MULTILINE).find(content)
        if (headingMatch != null) {
            return headingMatch.groupValues[1].trim()
        }

        // Fall back to filename without extension
        return path.substringAfterLast("/").substringBeforeLast(".")
    }

    private fun hashContent(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(content.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}

data class CreateDocumentRequest(
    @field:NotBlank(message = "Path is required")
    val path: String,

    val title: String? = null,

    @field:NotBlank(message = "Content is required")
    val content: String
)

data class UpdateDocumentRequest(
    val title: String? = null,

    @field:NotBlank(message = "Content is required")
    val content: String,

    val autoCommit: Boolean? = false,
    val commitMessage: String? = null
)

data class DocumentDto(
    val id: UUID,
    val path: String,
    val title: String?,
    val lastSyncedAt: Instant?
)

data class DocumentContentDto(
    val id: UUID?,
    val path: String,
    val title: String?,
    val content: String,
    val lastSyncedAt: Instant?
)

fun Document.toDto() = DocumentDto(
    id = this.id!!,
    path = this.path,
    title = this.title,
    lastSyncedAt = this.lastSyncedAt
)

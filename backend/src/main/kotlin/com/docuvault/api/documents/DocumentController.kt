package com.docuvault.api.documents

import com.docuvault.domain.space.Document
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.requireSpaceWritable
import com.docuvault.service.git.FileNode
import com.docuvault.service.git.GitService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/documents")
class DocumentController(
    private val spaceRepository: SpaceRepository,
    private val documentRepository: DocumentRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val embeddingService: EmbeddingService
) {
    private fun extractDocumentPath(requestURI: String, spaceId: UUID): String? {
        val basePath = "/api/spaces/$spaceId/documents/"
        if (!requestURI.startsWith(basePath)) return null
        return URLDecoder.decode(requestURI.substring(basePath.length), StandardCharsets.UTF_8)
    }

    @GetMapping("/tree")
    fun getFileTree(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<FileNode>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
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

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
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

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Extract path from URL
        val documentPath = extractDocumentPath(request.requestURI, spaceId)
            ?: return ResponseEntity.badRequest().build()

        val content = gitService.readFile(space, documentPath)
            ?: return ResponseEntity.notFound().build()

        val document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)

        return ResponseEntity.ok(
            DocumentContentDto(
                id = document?.id,
                path = documentPath,
                title = document?.title ?: extractTitle(content, documentPath),
                content = content,
                contentHash = hashContent(content),
                lastSyncedAt = document?.lastSyncedAt
            )
        )
    }

    @PostMapping("/upload", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun uploadFiles(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam("files") files: List<MultipartFile>,
        @RequestParam("folder", required = false) folder: String?
    ): ResponseEntity<List<UploadedFileDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        val prefix = folder?.trim('/')?.let { "$it/" } ?: ""
        val uploaded = mutableListOf<UploadedFileDto>()

        for (file in files) {
            // Extract only the basename — browsers on some OS send full local path (e.g. C:\Users\...\file.md)
            val originalName = file.originalFilename
                ?.substringAfterLast('/')
                ?.substringAfterLast('\\')
                ?.ifBlank { null }
                ?: continue
            val path = "$prefix$originalName"
            val bytes = file.bytes

            val success = gitService.writeBinaryFile(space, path, bytes)
            if (!success) continue

            // Register markdown files as documents in the DB
            if (originalName.endsWith(".md", ignoreCase = true)) {
                val content = String(bytes)
                val contentHash = hashContent(content)
                val now = java.time.Instant.now()
                var document = documentRepository.findBySpaceIdAndPath(spaceId, path)
                if (document != null) {
                    document.title = extractTitle(content, path)
                    document.contentHash = contentHash
                    document.lastSyncedAt = now
                    document.updatedAt = now
                } else {
                    document = com.docuvault.domain.space.Document(
                        space = space,
                        path = path,
                        title = extractTitle(content, path),
                        contentHash = contentHash,
                        lastSyncedAt = now
                    )
                }
                val saved = documentRepository.save(document)
                embeddingService.processDocument(saved.id!!, content)
            }

            uploaded.add(UploadedFileDto(path = path, name = originalName))
        }

        // Auto-commit uploaded files for git-backed spaces
        if (uploaded.isNotEmpty() && !space.gitlabUrl.isNullOrBlank()) {
            try {
                val fileNames = uploaded.joinToString(", ") { it.name }
                gitService.commitAndPush(
                    space = space,
                    message = "Upload ${uploaded.size} file(s): $fileNames",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                // Files are written but commit failed — store the reason so the UI can show it
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.ok(uploaded)
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

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

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

        // Commit and push if autoCommit is requested — skip for non-git-backed spaces
        if (request.autoCommit == true && !space.gitlabUrl.isNullOrBlank()) {
            try {
                gitService.commitAndPush(
                    space = space,
                    message = request.commitMessage ?: "Add ${request.path}",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = request.content,
                contentHash = contentHash,
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

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        // Extract path from URL
        val documentPath = extractDocumentPath(servletRequest.requestURI, spaceId)
            ?: return ResponseEntity.badRequest().build()

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

        // Commit and push if autoCommit is requested — skip for non-git-backed spaces
        if (request.autoCommit == true && !space.gitlabUrl.isNullOrBlank()) {
            try {
                gitService.commitAndPush(
                    space = space,
                    message = request.commitMessage ?: "Update ${documentPath}",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.ok(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = request.content,
                contentHash = contentHash,
                lastSyncedAt = saved.lastSyncedAt
            )
        )
    }

    @PatchMapping("/**")
    fun patchDocument(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: PatchDocumentRequest,
        servletRequest: jakarta.servlet.http.HttpServletRequest
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        // Extract path from URL
        val documentPath = extractDocumentPath(servletRequest.requestURI, spaceId)
            ?: return ResponseEntity.badRequest().build()

        // Read current content
        val currentContent = gitService.readFile(space, documentPath)
            ?: return ResponseEntity.notFound().build()

        // Optimistic locking: verify content hasn't changed since client read it
        if (request.contentHash != null) {
            val actualHash = hashContent(currentContent)
            if (request.contentHash != actualHash) {
                return ResponseEntity.status(HttpStatus.CONFLICT).body(
                    mapOf(
                        "error" to "CONFLICT",
                        "message" to "Document has been modified since you last read it. Please re-read the document and retry.",
                        "currentHash" to actualHash
                    )
                )
            }
        }

        // Validate operations
        if (request.operations.isEmpty()) {
            return ResponseEntity.badRequest().body(
                mapOf("error" to "INVALID_REQUEST", "message" to "At least one operation is required")
            )
        }

        if (request.operations.size > 20) {
            return ResponseEntity.badRequest().body(
                mapOf("error" to "INVALID_REQUEST", "message" to "Maximum 20 operations per request")
            )
        }

        // Apply operations sequentially
        var content = currentContent
        for ((index, op) in request.operations.withIndex()) {
            when (op.op) {
                "replace" -> {
                    if (op.oldText == null || op.newText == null) {
                        return ResponseEntity.badRequest().body(
                            mapOf("error" to "INVALID_OPERATION", "message" to "Operation $index: 'replace' requires 'oldText' and 'newText'")
                        )
                    }
                    if (op.oldText == op.newText) {
                        return ResponseEntity.badRequest().body(
                            mapOf("error" to "INVALID_OPERATION", "message" to "Operation $index: 'oldText' and 'newText' must be different")
                        )
                    }
                    val occurrences = countOccurrences(content, op.oldText)
                    if (occurrences == 0) {
                        return ResponseEntity.badRequest().body(
                            mapOf(
                                "error" to "TEXT_NOT_FOUND",
                                "message" to "Operation $index: exact text not found in document",
                                "operationIndex" to index
                            )
                        )
                    }
                    if (occurrences > 1 && op.replaceAll != true) {
                        return ResponseEntity.badRequest().body(
                            mapOf(
                                "error" to "AMBIGUOUS_MATCH",
                                "message" to "Operation $index: text appears $occurrences times. Provide more context to make it unique, or set replaceAll: true.",
                                "operationIndex" to index,
                                "occurrences" to occurrences
                            )
                        )
                    }
                    content = if (op.replaceAll == true) {
                        content.replace(op.oldText, op.newText)
                    } else {
                        content.replaceFirst(op.oldText, op.newText)
                    }
                }

                "insert" -> {
                    if (op.content == null) {
                        return ResponseEntity.badRequest().body(
                            mapOf("error" to "INVALID_OPERATION", "message" to "Operation $index: 'insert' requires 'content'")
                        )
                    }
                    when {
                        op.after == "START" -> {
                            content = op.content + content
                        }
                        op.after == "END" || (op.after == null && op.before == null) -> {
                            content = content + op.content
                        }
                        op.after != null -> {
                            val pos = content.indexOf(op.after)
                            if (pos == -1) {
                                return ResponseEntity.badRequest().body(
                                    mapOf(
                                        "error" to "TEXT_NOT_FOUND",
                                        "message" to "Operation $index: anchor text for 'after' not found",
                                        "operationIndex" to index
                                    )
                                )
                            }
                            val insertPos = pos + op.after.length
                            content = content.substring(0, insertPos) + op.content + content.substring(insertPos)
                        }
                        op.before != null -> {
                            val pos = content.indexOf(op.before)
                            if (pos == -1) {
                                return ResponseEntity.badRequest().body(
                                    mapOf(
                                        "error" to "TEXT_NOT_FOUND",
                                        "message" to "Operation $index: anchor text for 'before' not found",
                                        "operationIndex" to index
                                    )
                                )
                            }
                            content = content.substring(0, pos) + op.content + content.substring(pos)
                        }
                    }
                }

                else -> {
                    return ResponseEntity.badRequest().body(
                        mapOf("error" to "INVALID_OPERATION", "message" to "Operation $index: unknown operation '${op.op}'. Supported: 'replace', 'insert'")
                    )
                }
            }
        }

        // Write the patched content
        if (!gitService.writeFile(space, documentPath, content)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
        }

        val newContentHash = hashContent(content)
        val now = Instant.now()

        var document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)

        if (document != null) {
            document.title = extractTitle(content, documentPath)
            document.contentHash = newContentHash
            document.lastSyncedAt = now
            document.updatedAt = now
        } else {
            document = Document(
                space = space,
                path = documentPath,
                title = extractTitle(content, documentPath),
                contentHash = newContentHash,
                lastSyncedAt = now
            )
        }

        val saved = documentRepository.save(document)

        // Re-generate embeddings
        embeddingService.processDocument(saved.id!!, content)

        // Commit if requested — skip for non-git-backed spaces
        if (request.autoCommit == true && !space.gitlabUrl.isNullOrBlank()) {
            try {
                gitService.commitAndPush(
                    space = space,
                    message = request.commitMessage ?: "Update ${documentPath}",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.ok(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = content,
                contentHash = newContentHash,
                lastSyncedAt = saved.lastSyncedAt
            )
        )
    }

    private fun countOccurrences(text: String, search: String): Int {
        var count = 0
        var startIndex = 0
        while (true) {
            val index = text.indexOf(search, startIndex)
            if (index == -1) break
            count++
            startIndex = index + 1
        }
        return count
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

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        // Extract path from URL
        val documentPath = extractDocumentPath(request.requestURI, spaceId)
            ?: return ResponseEntity.badRequest().build()

        // Delete from git
        gitService.deleteFile(space, documentPath)

        // Delete from database
        val document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)
        document?.let { documentRepository.delete(it) }

        // Commit and push the deletion so it persists for git-backed spaces
        if (!space.gitlabUrl.isNullOrBlank()) {
            try {
                gitService.commitAndPush(
                    space = space,
                    message = "Delete $documentPath",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.noContent().build()
    }

    @PostMapping("/folder")
    fun createFolder(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestBody request: CreateFolderRequest
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        if (!gitService.createFolder(space, request.path)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
        }

        // Commit and push the folder marker (.gitkeep) so the empty folder persists in git
        if (!space.gitlabUrl.isNullOrBlank()) {
            try {
                gitService.commitAndPush(
                    space = space,
                    message = "Create folder ${request.path}",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.ok().build()
    }

    @PostMapping("/rename")
    fun renameItem(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestBody request: RenameRequest
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        val isDir = gitService.isDirectory(space, request.oldPath)

        if (!gitService.renameItem(space, request.oldPath, request.newPath)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
        }

        // Update database records
        if (isDir) {
            val prefix = request.oldPath + "/"
            val docs = documentRepository.findBySpaceId(spaceId)
            docs.filter { it.path.startsWith(prefix) }.forEach { doc ->
                documentRepository.save(doc.copy(path = request.newPath + "/" + doc.path.removePrefix(prefix)))
            }
        } else {
            val doc = documentRepository.findBySpaceIdAndPath(spaceId, request.oldPath)
            doc?.let { documentRepository.save(it.copy(path = request.newPath)) }
        }

        // Commit and push the rename/move so it persists for git-backed spaces
        if (!space.gitlabUrl.isNullOrBlank()) {
            try {
                gitService.commitAndPush(
                    space = space,
                    message = "Rename ${request.oldPath} to ${request.newPath}",
                    authorName = user.name,
                    authorEmail = user.email
                )
            } catch (e: Exception) {
                space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
                spaceRepository.save(space)
            }
        }

        return ResponseEntity.ok().build()
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
    val content: String,

    val autoCommit: Boolean? = false,
    val commitMessage: String? = null
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
    val contentHash: String?,
    val lastSyncedAt: Instant?
)

data class PatchDocumentRequest(
    val operations: List<PatchOperation>,
    val contentHash: String? = null,
    val autoCommit: Boolean? = false,
    val commitMessage: String? = null
)

data class PatchOperation(
    val op: String,
    val oldText: String? = null,
    val newText: String? = null,
    val content: String? = null,
    val after: String? = null,
    val before: String? = null,
    val replaceAll: Boolean? = false
)

data class UploadedFileDto(
    val path: String,
    val name: String
)

data class CreateFolderRequest(
    @field:NotBlank(message = "Path is required")
    val path: String
)

data class RenameRequest(
    @field:NotBlank(message = "Old path is required")
    val oldPath: String,
    @field:NotBlank(message = "New path is required")
    val newPath: String
)

fun Document.toDto() = DocumentDto(
    id = this.id!!,
    path = this.path,
    title = this.title,
    lastSyncedAt = this.lastSyncedAt
)

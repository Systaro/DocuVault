package com.docuvault.api.documents

import com.docuvault.domain.space.Document
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.AnnotationService
import com.docuvault.service.DocumentLineageService
import com.docuvault.service.FileUploadService
import com.docuvault.service.DocumentPatchService
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.DocumentTransferService
import com.docuvault.service.PatchOperation
import com.docuvault.service.PermissionService
import com.docuvault.service.TransferMode
import com.docuvault.service.TransferResult
import com.docuvault.service.ai.DocumentEditResult
import com.docuvault.service.ai.WritingAssistantService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.requireSpaceWritable
import com.docuvault.service.git.FileNode
import com.docuvault.service.git.FileVersion
import com.docuvault.service.git.GitDiffService
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
    private val gitDiffService: GitDiffService,
    private val embeddingService: EmbeddingService,
    private val writingAssistantService: WritingAssistantService,
    private val documentPersistService: DocumentPersistService,
    private val documentTransferService: DocumentTransferService,
    private val annotationService: AnnotationService,
    private val documentPatchService: DocumentPatchService,
    private val documentLineageService: DocumentLineageService,
    private val fileUploadService: FileUploadService
) {
    private fun extractTitle(content: String, path: String) = documentPersistService.extractTitle(content, path)
    private fun hashContent(content: String) = documentPersistService.hashContent(content)

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

    /**
     * Last commit behind every direct child of a folder, keyed by entry name —
     * the "last change" and "commit" columns of the folder listing. Folders are
     * dated by the newest commit touching anything inside them.
     */
    @GetMapping("/folder-history")
    fun getFolderHistory(
        @PathVariable spaceId: UUID,
        @RequestParam(required = false, defaultValue = "") path: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, FileVersion>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val entries = gitService.listFiles(space, path).map { it.name }.toSet()
        return ResponseEntity.ok(gitDiffService.folderEntryVersions(space, path, entries))
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

    /**
     * Accepts one or many files into [folder].
     *
     * [paths] is index-aligned with [files] and carries each file's path relative
     * to the drop target, so dropping a whole directory recreates its structure
     * instead of flattening it. Absent (or blank) entries fall back to the plain
     * filename. Large batches arrive as several chunked requests — those set
     * [commit] to false until the last one, so the whole upload lands as a single
     * Git commit rather than one per chunk. A call carrying no [files] at all is a
     * finalize: it commits whatever earlier chunks left behind, which is how a
     * partially failed batch still ends up in Git.
     */
    @PostMapping("/upload", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun uploadFiles(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam("files", required = false) files: List<MultipartFile>?,
        @RequestParam("folder", required = false) folder: String?,
        @RequestParam("paths", required = false) paths: List<String>?,
        @RequestParam("commit", required = false, defaultValue = "true") commit: Boolean,
        @RequestParam("commitMessage", required = false) commitMessage: String?
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
        val uploaded = mutableListOf<com.docuvault.service.StoredFile>()

        for ((index, file) in (files ?: emptyList()).withIndex()) {
            // Extract only the basename — browsers on some OS send full local path (e.g. C:\Users\...\file.md)
            val originalName = file.originalFilename
                ?.substringAfterLast('/')
                ?.substringAfterLast('\\')
                ?.ifBlank { null }
                ?: continue
            val relativePath = fileUploadService.sanitizeRelativePath(paths?.getOrNull(index)) ?: originalName
            fileUploadService.store(space, "$prefix$relativePath", file.bytes)?.let { uploaded.add(it) }
        }

        // A finalize call (no files) commits regardless — that is its whole purpose.
        if (commit && (uploaded.isNotEmpty() || files.isNullOrEmpty())) {
            fileUploadService.commit(space, uploaded, user, commitMessage)
        }

        return ResponseEntity.ok(uploaded.map { UploadedFileDto(path = it.path, name = it.name) })
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

        documentPersistService.commitIfRequested(
            space, autoCommit = request.autoCommit == true,
            message = request.commitMessage ?: "Add ${request.path}", user = user
        )

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

        val saved = persistDocument(
            space = space,
            user = user,
            documentPath = documentPath,
            content = request.content,
            title = request.title,
            autoCommit = request.autoCommit == true,
            commitMessage = request.commitMessage
        ) ?: return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()

        return ResponseEntity.ok(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = request.content,
                contentHash = saved.contentHash,
                lastSyncedAt = saved.lastSyncedAt
            )
        )
    }

    private fun persistDocument(
        space: com.docuvault.domain.space.Space,
        user: com.docuvault.domain.user.User,
        documentPath: String,
        content: String,
        title: String?,
        autoCommit: Boolean,
        commitMessage: String?
    ): Document? = documentPersistService.persistDocument(
        space, user, documentPath, content, title, autoCommit, commitMessage
    )

    @PostMapping("/ai-edit")
    fun aiEditDocument(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: AiEditDocumentRequest
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        val documentPath = request.path.trim().trimStart('/')
        if (documentPath.isEmpty()) return ResponseEntity.badRequest().build()

        val extension = documentPath.substringAfterLast('.', "").lowercase()
        if (extension in AI_EDIT_BLOCKED_EXTENSIONS) {
            return ResponseEntity.badRequest()
                .body(mapOf("error" to "AI editing is not available for binary or image files."))
        }

        val previousContent = gitService.readFile(space, documentPath)
            ?: return ResponseEntity.notFound().build()

        // Binary-content safety net for extensions not in the blocklist
        if (previousContent.contains('\u0000') || previousContent.contains('\uFFFD')) {
            return ResponseEntity.badRequest()
                .body(mapOf("error" to "AI editing is not available for binary files."))
        }

        val edit = writingAssistantService.editDocument(
            fileName = documentPath.substringAfterLast('/'),
            content = previousContent,
            instruction = request.instruction
        )

        // Each failure says what actually went wrong. The old catch-all blamed a
        // missing API key for everything, including the timeouts that were the
        // usual cause — which sent people to the settings page for no reason.
        val editedContent = when (edit) {
            is DocumentEditResult.Success -> edit.content
            is DocumentEditResult.NotConfigured ->
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(mapOf("error" to "AI edit failed. Check that an AI API key is configured."))
            is DocumentEditResult.Failed ->
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(mapOf("error" to edit.message))
        }

        val commitMessage = "AI edit: ${request.instruction.replace('\n', ' ').take(72)}"
        persistDocument(
            space = space,
            user = user,
            documentPath = documentPath,
            content = editedContent,
            title = null,
            autoCommit = true,
            commitMessage = commitMessage
        ) ?: return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()

        return ResponseEntity.ok(
            AiEditDocumentResponse(
                path = documentPath,
                content = editedContent,
                previousContent = previousContent,
                strategy = (edit as DocumentEditResult.Success).strategy.name
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

        val patched = documentPatchService.apply(currentContent, request.operations)
        if (patched is DocumentPatchService.Result.Failed) {
            return ResponseEntity.badRequest().body(
                buildMap {
                    put("error", patched.error)
                    put("message", patched.message)
                    patched.operationIndex?.let { put("operationIndex", it) }
                    patched.occurrences?.let { put("occurrences", it) }
                }
            )
        }
        val content = (patched as DocumentPatchService.Result.Applied).content

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

        documentPersistService.commitIfRequested(
            space, autoCommit = request.autoCommit == true,
            message = request.commitMessage ?: "Update ${documentPath}", user = user
        )

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

        // Deleting a folder takes everything inside it, so the document rows for
        // its contents have to go too — matching on the "path/" prefix, which a
        // sibling like "docs-old.md" cannot accidentally satisfy.
        if (gitService.isDirectory(space, documentPath)) {
            val prefix = "$documentPath/"
            // Counted from disk, not from document rows — only markdown files have
            // rows, so counting those would under-report what is actually deleted.
            val contained = gitService.countFilesIn(space, documentPath)

            if (!gitService.deleteDirectory(space, documentPath)) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()
            }
            documentRepository.deleteBySpaceIdAndPathStartingWith(spaceId, prefix)

            documentPersistService.commitIfRequested(
                space, autoCommit = true,
                message = "Delete folder $documentPath ($contained file(s))", user = user
            )
            return ResponseEntity.noContent().build()
        }

        // Delete from git
        gitService.deleteFile(space, documentPath)

        // Delete from database
        val document = documentRepository.findBySpaceIdAndPath(spaceId, documentPath)
        document?.let { documentRepository.delete(it) }

        documentPersistService.commitIfRequested(
            space, autoCommit = true, message = "Delete $documentPath", user = user
        )

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

        // Commit the folder marker (.gitkeep) so the empty folder persists
        documentPersistService.commitIfRequested(
            space, autoCommit = true, message = "Create folder ${request.path}", user = user
        )

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

        // Comments are addressed by (space, path), so they have to follow the
        // file — otherwise a rename strands every thread on it for good.
        annotationService.repointToNewPath(
            sourceSpaceId = spaceId,
            sourcePath = request.oldPath,
            targetSpace = space,
            targetPath = request.newPath,
            isDirectory = isDir
        )

        // Links people already shared point at the old path; this forwards them.
        documentLineageService.recordRename(space, request.oldPath, request.newPath, isDir, user)

        documentPersistService.commitIfRequested(
            space, autoCommit = true,
            message = "Rename ${request.oldPath} to ${request.newPath}", user = user
        )

        return ResponseEntity.ok().build()
    }

    /**
     * Where the document that used to live at `path` is now, for a link that
     * points at a path nothing occupies any more.
     *
     * "Nowhere to forward" answers **204**, not 404, because callers ask this
     * speculatively — a previewed file is handed to an `<iframe>` that reports no
     * status, so the question has to be asked before anything fails. An error for
     * the ordinary answer would put a red entry in the console on every file
     * opened. A 4xx here means the *request* was wrong, not that the document
     * simply never moved.
     *
     * A moved document keeps its permissions from its new home, so the answer is
     * only given when the user may actually see the destination; otherwise this
     * would reveal that a document exists in a space they have no access to.
     */
    @GetMapping("/resolve-moved")
    fun resolveMoved(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<ResolvedLocationDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Something lives here again — a file was moved away and a new one later
        // created in its place. The path is live, so there is nothing to forward,
        // and answering with the old move would send the caller away from a real
        // document. This is what makes the endpoint safe to ask speculatively.
        if (gitService.itemExists(space, path)) {
            return ResponseEntity.noContent().build()
        }

        val moved = documentLineageService.resolve(spaceId, path)
            ?: return ResponseEntity.noContent().build()

        if (!permissionService.hasAccess(user.id!!, moved.spaceId, user.role)) {
            return ResponseEntity.noContent().build()
        }

        val destination = spaceRepository.findById(moved.spaceId).orElse(null)
            ?: return ResponseEntity.noContent().build()

        // A record can outlive the file itself — moved once, deleted later.
        if (!gitService.itemExists(destination, moved.path)) {
            return ResponseEntity.noContent().build()
        }

        return ResponseEntity.ok(
            ResolvedLocationDto(
                spaceId = moved.spaceId,
                spaceFullPath = moved.spaceFullPath,
                spaceName = moved.spaceName,
                path = moved.path,
                sameSpace = moved.spaceId == spaceId,
                viaFolder = moved.viaFolder
            )
        )
    }

    /**
     * Move or copy an item into another space — or into another folder of this
     * one. `spaceId` is always the source; the destination travels in the body.
     *
     * A move needs edit rights on both ends, because it writes to one and
     * removes from the other. A copy only reads the source, so view rights there
     * are enough as long as the user can write to the destination.
     */
    @PostMapping("/transfer")
    fun transferItem(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: TransferRequest
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val mode = runCatching { TransferMode.valueOf(request.mode.uppercase()) }.getOrNull()
            ?: return ResponseEntity.badRequest().body(mapOf("message" to "Unknown mode '${request.mode}'."))

        val sourceSpace = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()
        val targetSpace = spaceRepository.findById(request.targetSpaceId).orElse(null)
            ?: return ResponseEntity.badRequest().body(mapOf("message" to "That space no longer exists."))

        val sourceOk = if (mode == TransferMode.MOVE) {
            permissionService.hasEditAccess(user.id!!, sourceSpace.id!!, user.role)
        } else {
            permissionService.hasAccess(user.id!!, sourceSpace.id!!, user.role)
        }
        if (!sourceOk || !permissionService.hasEditAccess(user.id!!, targetSpace.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(targetSpace)
        if (mode == TransferMode.MOVE) requireSpaceWritable(sourceSpace)

        return when (val result = documentTransferService.transfer(
            sourceSpace = sourceSpace,
            sourcePath = request.sourcePath,
            targetSpace = targetSpace,
            targetFolder = request.targetFolder,
            mode = mode,
            user = user
        )) {
            is TransferResult.Ok -> ResponseEntity.ok(
                TransferResponse(
                    targetSpaceId = targetSpace.id!!,
                    targetSpaceFullPath = targetSpace.getFullPath(),
                    targetPath = result.targetPath,
                    renamed = result.renamed,
                    fileCount = result.fileCount
                )
            )
            is TransferResult.Failed ->
                ResponseEntity.badRequest().body(mapOf("message" to result.reason))
        }
    }

}

data class ResolvedLocationDto(
    val spaceId: UUID,
    val spaceFullPath: String,
    val spaceName: String,
    val path: String,
    val sameSpace: Boolean,
    /** True when the document travelled inside a folder that was moved. */
    val viaFolder: Boolean
)

data class TransferRequest(
    @field:NotBlank(message = "Source path is required")
    val sourcePath: String,

    val targetSpaceId: UUID,

    /** '' means the destination space's root. */
    val targetFolder: String = "",

    /** MOVE or COPY. */
    @field:NotBlank(message = "Mode is required")
    val mode: String
)

data class TransferResponse(
    val targetSpaceId: UUID,
    val targetSpaceFullPath: String,
    val targetPath: String,
    /** True when the name had to be suffixed because the destination was taken. */
    val renamed: Boolean,
    val fileCount: Int
)

/**
 * Extensions AI editing is never offered for. Mirrors AI_EDIT_BLOCKED_EXTENSIONS
 * in frontend/src/app/shared/utils/file-utils.ts — keep the two in sync.
 */
val AI_EDIT_BLOCKED_EXTENSIONS = setOf(
    // images
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif", "tif", "tiff", "psd",
    // documents & archives
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pps", "odt", "rtf",
    "zip", "7z", "rar", "gz", "gz2", "tgz", "tar", "iso", "dmg", "jar", "apk", "msi",
    // media
    "mp3", "mp4", "mpeg", "mkv", "mov", "avi", "webm", "flac", "ogg", "wav", "wma", "wmv",
    "flv", "swf", "3gp", "asf", "divx", "aac",
    // executables & fonts
    "exe", "dll", "sys", "bat", "ttf", "otf", "woff", "woff2", "eot"
)

data class AiEditDocumentRequest(
    @field:NotBlank(message = "Path is required")
    val path: String,

    @field:NotBlank(message = "Instruction is required")
    val instruction: String
)

data class AiEditDocumentResponse(
    val path: String,
    val content: String,
    val previousContent: String,
    /** PATCH when the model named the passages to change, REWRITE when it returned the whole file. */
    val strategy: String
)

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

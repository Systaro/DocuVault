package com.docuvault.api.documents

import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentLineageService
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.HtmlPreviewInjection
import com.docuvault.service.PermissionService
import com.docuvault.service.git.FileHistoryMeta
import com.docuvault.service.git.FileVersion
import com.docuvault.service.git.GitDiffService
import com.docuvault.service.git.GitService
import com.docuvault.service.requireSpaceWritable
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.*

/**
 * Version history ("time capsule") for documents. Every space is git-versioned —
 * remote-connected spaces through their synced repo, local spaces through the
 * lazily-initialized local repository — so history and restore work uniformly.
 */
@RestController
@RequestMapping("/spaces/{spaceId}/document-history")
class DocumentHistoryController(
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService,
    private val gitDiffService: GitDiffService,
    private val documentPersistService: DocumentPersistService,
    private val documentRepository: DocumentRepository,
    private val documentLineageService: DocumentLineageService
) {

    @GetMapping
    fun getHistory(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<FileVersion>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Local spaces created before universal versioning get their baseline commit
        // on first history access, so the view is never empty for existing content.
        if (space.gitlabUrl.isNullOrBlank()) {
            gitService.ensureLocalRepo(space)
        }

        return ResponseEntity.ok(gitDiffService.fileHistory(space, path))
    }

    /** Creator (first commit) and last editor (newest commit) of a document, for the topbar. */
    @GetMapping("/meta")
    fun getMeta(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<FileHistoryMeta> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (space.gitlabUrl.isNullOrBlank()) {
            gitService.ensureLocalRepo(space)
        }

        val meta = gitDiffService.fileMeta(space, path)

        // A document that came from another space has no history here before the
        // commit that brought it in, so git would name whoever moved it as the
        // creator. The move recorded who really created it.
        val origin = documentLineageService.originCreated(space.id!!, path)
        return ResponseEntity.ok(if (origin != null) meta.copy(created = origin) else meta)
    }

    @GetMapping("/content")
    fun getVersionContent(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @RequestParam sha: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<VersionContentDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val content = gitDiffService.fileAtCommit(space, sha, path)
            ?: return ResponseEntity.notFound().build()

        return ResponseEntity.ok(VersionContentDto(path = path, sha = sha, content = content))
    }

    /**
     * The document at [sha], served for the preview pane rather than as data:
     * an HTML page gets the same `<base>` and preview chrome the live file
     * gets, so a historic version displays like the current one instead of as
     * source text. Its assets are the ones in the working tree — the page is
     * historic, the stylesheet and images beside it are not.
     */
    @GetMapping("/raw")
    fun getVersionRaw(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @RequestParam sha: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<ByteArray> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val content = gitDiffService.fileAtCommit(space, sha, path)
            ?: return ResponseEntity.notFound().build()

        val isHtml = path.substringAfterLast('.', "").lowercase() in setOf("html", "htm")
        val body = if (isHtml) {
            HtmlPreviewInjection.inject(
                content,
                HtmlPreviewInjection.baseHref("/api/spaces/$spaceId/files", path)
            )
        } else {
            content
        }

        return ResponseEntity.ok()
            .contentType(if (isHtml) MediaType.TEXT_HTML else MediaType.TEXT_PLAIN)
            .cacheControl(CacheControl.noCache())
            .body(body.toByteArray(Charsets.UTF_8))
    }

    @GetMapping("/diff")
    fun getVersionDiff(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @RequestParam sha: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<VersionDiffDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val diff = gitDiffService.fileDiffAtCommit(space, sha, path)
            ?: return ResponseEntity.notFound().build()

        return ResponseEntity.ok(VersionDiffDto(path = path, sha = sha, diff = diff))
    }

    @PostMapping("/restore")
    fun restoreVersion(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: RestoreVersionRequest
    ): ResponseEntity<DocumentContentDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        requireSpaceWritable(space)

        val content = gitDiffService.fileAtCommit(space, request.sha, request.path)
            ?: return ResponseEntity.notFound().build()

        // Content that carries its own title (a Markdown heading) sets it; anything
        // else keeps the title it has. Without this an HTML page would silently be
        // renamed to its filename on every restore, since the fallback title is
        // derived from the path.
        val restoredTitle = documentPersistService.headingTitle(content)
            ?: documentRepository.findBySpaceIdAndPath(space.id!!, request.path)?.title

        // A restore is itself a new version on top of the history, never a rewind.
        val saved = documentPersistService.persistDocument(
            space = space,
            user = user,
            documentPath = request.path,
            content = content,
            title = restoredTitle,
            autoCommit = true,
            commitMessage = "Restore ${request.path} to version ${request.sha.take(8)}"
        ) ?: return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build()

        return ResponseEntity.ok(
            DocumentContentDto(
                id = saved.id,
                path = saved.path,
                title = saved.title,
                content = content,
                contentHash = saved.contentHash,
                lastSyncedAt = saved.lastSyncedAt
            )
        )
    }
}

data class RestoreVersionRequest(
    @field:NotBlank(message = "Path is required")
    val path: String,

    @field:NotBlank(message = "Sha is required")
    val sha: String
)

data class VersionContentDto(
    val path: String,
    val sha: String,
    val content: String
)

data class VersionDiffDto(
    val path: String,
    val sha: String,
    /** Unified diff text; empty when the commit did not touch the file. */
    val diff: String
)

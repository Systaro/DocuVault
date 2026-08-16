package com.docuvault.service

import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import org.springframework.stereotype.Service
import java.security.MessageDigest
import java.time.Instant

/**
 * Shared document write path used by the document endpoints (create/update/ai-edit)
 * and the history restore: writes the file into the space repo, upserts the Document
 * row, refreshes embeddings and versions the change as a commit.
 */
@Service
class DocumentPersistService(
    private val documentRepository: DocumentRepository,
    private val spaceRepository: SpaceRepository,
    private val gitService: GitService,
    private val embeddingService: EmbeddingService
) {

    /** The title the content carries itself (a Markdown heading), or null when it has none. */
    fun headingTitle(content: String): String? =
        Regex("^#\\s+(.+)$", RegexOption.MULTILINE).find(content)?.groupValues?.get(1)?.trim()

    fun extractTitle(content: String, path: String): String =
        // Fall back to the filename without extension
        headingTitle(content) ?: path.substringAfterLast("/").substringBeforeLast(".")

    fun hashContent(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(content.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }

    /** Returns null when the file could not be written. */
    fun persistDocument(
        space: Space,
        user: User,
        documentPath: String,
        content: String,
        title: String?,
        autoCommit: Boolean,
        commitMessage: String?
    ): Document? {
        if (!gitService.writeFile(space, documentPath, content)) {
            return null
        }

        val contentHash = hashContent(content)
        val now = Instant.now()

        var document = documentRepository.findBySpaceIdAndPath(space.id!!, documentPath)

        if (document != null) {
            document.title = title ?: extractTitle(content, documentPath)
            document.contentHash = contentHash
            document.lastSyncedAt = now
            document.updatedAt = now
        } else {
            document = Document(
                space = space,
                path = documentPath,
                title = title ?: extractTitle(content, documentPath),
                contentHash = contentHash,
                lastSyncedAt = now
            )
        }

        val saved = documentRepository.save(document)

        // Re-generate embeddings
        embeddingService.processDocument(saved.id!!, content)

        commitIfRequested(space, autoCommit, commitMessage ?: "Update $documentPath", user)

        return saved
    }

    /**
     * Versions a change as a commit. Spaces without a remote commit every write into
     * their local history regardless of [autoCommit]; remote-backed spaces keep the
     * staged workflow and only commit+push when the client asked for it. Failures are
     * stored on the space (surfaced in the UI) instead of failing the write.
     */
    fun commitIfRequested(space: Space, autoCommit: Boolean, message: String, user: User) {
        if (!autoCommit && !space.gitlabUrl.isNullOrBlank()) return
        try {
            gitService.commitAndPush(
                space = space,
                message = message,
                authorName = user.name,
                authorEmail = user.email
            )
        } catch (e: Exception) {
            space.lastPushError = e.message?.take(1000) ?: "Failed to push changes"
            spaceRepository.save(space)
        }
    }
}

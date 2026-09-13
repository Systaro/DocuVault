package com.docuvault.service

import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import org.springframework.stereotype.Service
import java.time.Instant

data class StoredFile(val path: String, val name: String, val size: Int)

/**
 * Writes an uploaded file into a space the way the web UI's upload does:
 * bytes into the working copy, Markdown additionally registered as a document
 * and indexed, then one commit. Shared by the multipart endpoint and the
 * ticket-based transfer endpoint the MCP tools use.
 */
@Service
class FileUploadService(
    private val gitService: GitService,
    private val documentRepository: DocumentRepository,
    private val embeddingService: EmbeddingService,
    private val documentPersistService: DocumentPersistService
) {
    /**
     * Turns a client-supplied relative path into a safe, repo-relative one:
     * drive letters, traversal segments and blank parts are dropped, so an
     * uploaded folder keeps its structure but can never escape its target.
     */
    fun sanitizeRelativePath(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return raw.replace('\\', '/')
            .split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." && it != ".." && !it.endsWith(":") }
            .joinToString("/")
            .ifBlank { null }
    }

    /** Stores one file at [path]; null when the write failed. */
    fun store(space: Space, path: String, bytes: ByteArray): StoredFile? {
        if (!gitService.writeBinaryFile(space, path, bytes)) return null
        val name = path.substringAfterLast('/')

        // Markdown is a document, not just a file: register it so search, the
        // tree and the editor know about it.
        if (name.endsWith(".md", ignoreCase = true)) {
            val content = String(bytes, Charsets.UTF_8)
            val contentHash = documentPersistService.hashContent(content)
            val now = Instant.now()
            var document = documentRepository.findBySpaceIdAndPath(space.id!!, path)
            if (document != null) {
                document.title = documentPersistService.extractTitle(content, path)
                document.contentHash = contentHash
                document.lastSyncedAt = now
                document.updatedAt = now
            } else {
                document = Document(
                    space = space,
                    path = path,
                    title = documentPersistService.extractTitle(content, path),
                    contentHash = contentHash,
                    lastSyncedAt = now
                )
            }
            val saved = documentRepository.save(document)
            embeddingService.processDocument(saved.id!!, content)
        }
        return StoredFile(path = path, name = name, size = bytes.size)
    }

    fun commit(space: Space, uploaded: List<StoredFile>, user: User, commitMessage: String?) {
        documentPersistService.commitIfRequested(
            space, autoCommit = true,
            message = commitMessage?.takeIf { it.isNotBlank() } ?: uploadCommitMessage(uploaded),
            user = user
        )
    }

    /** Names the first few uploads and counts the rest; a folder upload must not
     *  produce a commit subject with hundreds of filenames in it. */
    fun uploadCommitMessage(uploaded: List<StoredFile>): String {
        if (uploaded.isEmpty()) return "Finish upload"
        val shown = uploaded.take(5).joinToString(", ") { it.name }
        val rest = uploaded.size - minOf(uploaded.size, 5)
        val names = if (rest > 0) "$shown and $rest more" else shown
        return "Upload ${uploaded.size} file(s): $names"
    }
}

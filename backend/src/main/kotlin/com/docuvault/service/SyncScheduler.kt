package com.docuvault.service

import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SyncStatus
import com.docuvault.infrastructure.repository.DocumentEmbeddingRepository
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitConflictService
import com.docuvault.service.git.GitDiffService
import com.docuvault.service.git.GitOperationException
import com.docuvault.service.git.GitService
import com.docuvault.service.git.MergeConflictException
import com.docuvault.service.notification.ChangeNotificationService
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.jsoup.Jsoup
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant
import kotlin.io.path.extension
import kotlin.io.path.isRegularFile

@Service
class SyncScheduler(
    private val spaceRepository: SpaceRepository,
    private val gitService: GitService,
    private val gitConflictService: GitConflictService,
    private val gitDiffService: GitDiffService,
    private val documentRepository: DocumentRepository,
    private val documentEmbeddingRepository: DocumentEmbeddingRepository,
    private val embeddingService: EmbeddingService,
    private val changeNotificationService: ChangeNotificationService
) {
    private val logger = LoggerFactory.getLogger(SyncScheduler::class.java)

    private val indexableExtensions = setOf("md", "mdx", "txt", "rst", "adoc", "html", "htm")
    private val htmlExtensions = setOf("html", "htm")

    @Scheduled(fixedRate = 60000) // Run every minute
    @Transactional
    fun syncRepositories() {
        // Only sync repositories, not groups
        val spaces = spaceRepository.findAllRepositoriesWithSyncEnabled()

        for (space in spaces) {
            if (space.syncStatus == SyncStatus.IN_CONFLICT) {
                // Don't attempt to pull; instead poll the tracked resolution MR.
                try {
                    gitConflictService.checkConflictMrStatus(space)
                } catch (e: Exception) {
                    logger.warn("Failed to poll conflict MR for space '${space.name}': ${e.message}")
                }
                continue
            }

            val lastSync = space.lastSyncedAt ?: Instant.EPOCH
            val intervalMs = space.syncIntervalMinutes * 60 * 1000L

            if (Instant.now().toEpochMilli() - lastSync.toEpochMilli() >= intervalMs) {
                try {
                    logger.info("Syncing space: ${space.name}")
                    val fromRef = space.lastSyncedCommitSha
                    gitService.pullChanges(space)
                    val toRef = gitDiffService.currentHeadSha(space)
                    val filesChanged = indexDocuments(space)
                    if (toRef != null) {
                        try {
                            changeNotificationService.recordSyncedChanges(space, fromRef, toRef)
                        } catch (e: Exception) {
                            logger.warn("Failed to dispatch change notifications for space '${space.name}': ${e.message}", e)
                        }
                        space.lastSyncedCommitSha = toRef
                    }
                    space.syncStatus = SyncStatus.OK
                    spaceRepository.updateSyncStatus(space.id!!, Instant.now(), null, filesChanged)
                    spaceRepository.save(space)
                    logger.info("Successfully synced space: ${space.name}")
                } catch (e: MergeConflictException) {
                    logger.warn("Merge conflict during scheduled sync of space '${space.name}'")
                    space.syncStatus = SyncStatus.IN_CONFLICT
                    space.conflictBaseRef = e.baseRef
                    space.conflictDetectedAt = Instant.now()
                    space.lastSyncError = e.message
                    spaceRepository.save(space)
                } catch (e: GitOperationException) {
                    logger.warn("Failed to sync space '${space.name}': [${e.errorCode}] ${e.message}")
                    space.syncStatus = SyncStatus.SYNC_ERROR
                    spaceRepository.save(space)
                    spaceRepository.updateSyncStatus(space.id!!, space.lastSyncedAt, e.message ?: "Sync failed")
                } catch (e: Exception) {
                    logger.error("Unexpected error syncing space '${space.name}': ${e.message}", e)
                    space.syncStatus = SyncStatus.SYNC_ERROR
                    spaceRepository.save(space)
                    spaceRepository.updateSyncStatus(space.id!!, space.lastSyncedAt, e.message?.take(500) ?: "Unexpected sync error")
                }
            }
        }
    }

    fun indexDocuments(space: Space): Int {
        val repoPath = gitService.getRepoPath(space.id!!)
        if (!Files.exists(repoPath)) return 0

        var indexed = 0
        var skipped = 0
        var filesOnDisk = 0

        Files.walk(repoPath)
            .filter { it.isRegularFile() }
            .filter { !it.toString().contains("/.git/") }
            .forEach { filePath ->
                filesOnDisk++
                if (filePath.extension.lowercase() !in indexableExtensions) return@forEach
                try {
                    val relativePath = repoPath.relativize(filePath).toString()
                    val rawContent = Files.readString(filePath)
                    val contentHash = sha256(rawContent)

                    val existingDoc = documentRepository.findBySpaceIdAndPath(space.id!!, relativePath)

                    val isHtml = filePath.extension.lowercase() in htmlExtensions
                    val htmlTitle = if (isHtml) extractHtmlTitle(rawContent) else null
                    val content = if (isHtml) stripHtml(rawContent) else rawContent

                    // Re-embed even when content is unchanged if the doc has no embeddings — e.g. it was
                    // first synced before OpenAI was configured (or an embedding call failed), which stores
                    // the content hash with zero embeddings and would otherwise never be retried.
                    if (existingDoc != null && existingDoc.contentHash == contentHash) {
                        if (documentEmbeddingRepository.existsByDocumentId(existingDoc.id!!)) {
                            skipped++
                            return@forEach
                        }
                        embeddingService.processDocument(existingDoc.id!!, content)
                        indexed++
                        return@forEach
                    }

                    val document = existingDoc?.apply {
                        this.contentHash = contentHash
                        this.title = htmlTitle ?: extractTitle(content, relativePath)
                        this.lastSyncedAt = Instant.now()
                        this.updatedAt = Instant.now()
                    } ?: Document(
                        space = space,
                        path = relativePath,
                        title = htmlTitle ?: extractTitle(content, relativePath),
                        contentHash = contentHash,
                        lastSyncedAt = Instant.now()
                    )

                    val saved = documentRepository.save(document)
                    embeddingService.processDocument(saved.id!!, content)
                    indexed++
                } catch (e: Exception) {
                    logger.warn("Failed to index file ${filePath.fileName} in space '${space.name}': ${e.message}")
                }
            }

        val pruned = pruneMissingDocuments(space, filesOnDisk)

        if (indexed > 0 || skipped > 0 || pruned > 0) {
            logger.info(
                "Indexing complete for space '${space.name}': " +
                    "$indexed indexed, $skipped unchanged, $pruned pruned"
            )
        }

        return indexed + pruned
    }

    /**
     * Drops document rows whose file has left the working tree.
     *
     * Indexing only ever upserts, so a file moved or deleted outside the app —
     * in a clone, in GitLab's UI, by an agent — left its old row behind forever.
     * Search then offered a path that no longer resolves, and a moved document
     * showed up once per path it had ever lived at.
     *
     * Existence is checked per stored path instead of against the set of files
     * just walked, because rows also legitimately exist for extensions the
     * indexer skips (css, js, svg written through the editor).
     *
     * Embeddings and cached translations follow via ON DELETE CASCADE.
     */
    private fun pruneMissingDocuments(space: Space, filesOnDisk: Int): Int {
        val documents = documentRepository.findBySpaceId(space.id!!)
        if (documents.isEmpty()) return 0

        // An empty working tree means a broken or half-finished clone far more
        // often than it means every document was genuinely deleted, and pruning
        // on that reading would wipe the space's entire index.
        if (filesOnDisk == 0) {
            logger.warn(
                "Skipping prune for space '${space.name}': working tree is empty " +
                    "but ${documents.size} document(s) are indexed"
            )
            return 0
        }

        val missing = documents.filter { !gitService.regularFileExists(space, it.path) }
        if (missing.isEmpty()) return 0

        documentRepository.deleteAll(missing)
        logger.info(
            "Pruned ${missing.size} stale document(s) from space '${space.name}': " +
                missing.take(10).joinToString(", ") { it.path } +
                if (missing.size > 10) ", …" else ""
        )
        return missing.size
    }

    private fun extractHtmlTitle(html: String): String? {
        val title = Jsoup.parse(html).title()
        return if (title.isNotBlank()) title.take(200) else null
    }

    private fun extractTitle(content: String, path: String): String {
        val firstLine = content.lineSequence().firstOrNull { it.isNotBlank() } ?: return path
        return if (firstLine.startsWith("#")) {
            firstLine.trimStart('#').trim()
        } else {
            path.substringAfterLast('/').substringBeforeLast('.')
        }
    }

    private fun stripHtml(html: String): String {
        val doc = Jsoup.parse(html)
        doc.select("style, script, link, meta, svg, noscript").remove()
        // wholeText() preserves whitespace structure for better chunking
        val text = doc.body()?.wholeText() ?: ""
        // Collapse excessive blank lines
        return text.replace(Regex("\n{3,}"), "\n\n").trim()
    }

    private fun sha256(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(content.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

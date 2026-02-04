package com.docuvault.service

import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitOperationException
import com.docuvault.service.git.GitService
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant
import kotlin.io.path.extension
import kotlin.io.path.isRegularFile

@Service
class SyncScheduler(
    private val spaceRepository: SpaceRepository,
    private val gitService: GitService,
    private val documentRepository: DocumentRepository,
    private val embeddingService: EmbeddingService
) {
    private val logger = LoggerFactory.getLogger(SyncScheduler::class.java)

    private val indexableExtensions = setOf("md", "mdx", "txt", "rst", "adoc")

    @Scheduled(fixedRate = 60000) // Run every minute
    @Transactional
    fun syncRepositories() {
        // Only sync repositories, not groups
        val spaces = spaceRepository.findAllRepositoriesWithSyncEnabled()

        for (space in spaces) {
            val lastSync = space.lastSyncedAt ?: Instant.EPOCH
            val intervalMs = space.syncIntervalMinutes * 60 * 1000L

            if (Instant.now().toEpochMilli() - lastSync.toEpochMilli() >= intervalMs) {
                try {
                    logger.info("Syncing space: ${space.name}")
                    gitService.pullChanges(space)
                    indexDocuments(space)
                    spaceRepository.updateSyncStatus(space.id!!, Instant.now(), null)
                    logger.info("Successfully synced space: ${space.name}")
                } catch (e: GitOperationException) {
                    logger.warn("Failed to sync space '${space.name}': [${e.errorCode}] ${e.message}")
                    spaceRepository.updateSyncStatus(space.id!!, space.lastSyncedAt, e.message ?: "Sync failed")
                } catch (e: Exception) {
                    logger.error("Unexpected error syncing space '${space.name}': ${e.message}", e)
                    spaceRepository.updateSyncStatus(space.id!!, space.lastSyncedAt, e.message?.take(500) ?: "Unexpected sync error")
                }
            }
        }
    }

    private fun indexDocuments(space: Space) {
        val repoPath = gitService.getRepoPath(space.id!!)
        if (!Files.exists(repoPath)) return

        var indexed = 0
        var skipped = 0

        Files.walk(repoPath)
            .filter { it.isRegularFile() }
            .filter { it.extension.lowercase() in indexableExtensions }
            .filter { !it.toString().contains("/.git/") }
            .forEach { filePath ->
                try {
                    val relativePath = repoPath.relativize(filePath).toString()
                    val content = Files.readString(filePath)
                    val contentHash = sha256(content)

                    val existingDoc = documentRepository.findBySpaceIdAndPath(space.id!!, relativePath)

                    if (existingDoc != null && existingDoc.contentHash == contentHash) {
                        skipped++
                        return@forEach
                    }

                    val document = existingDoc?.apply {
                        this.contentHash = contentHash
                        this.title = extractTitle(content, relativePath)
                        this.lastSyncedAt = Instant.now()
                        this.updatedAt = Instant.now()
                    } ?: Document(
                        space = space,
                        path = relativePath,
                        title = extractTitle(content, relativePath),
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

        if (indexed > 0 || skipped > 0) {
            logger.info("Indexing complete for space '${space.name}': $indexed indexed, $skipped unchanged")
        }
    }

    private fun extractTitle(content: String, path: String): String {
        val firstLine = content.lineSequence().firstOrNull { it.isNotBlank() } ?: return path
        return if (firstLine.startsWith("#")) {
            firstLine.trimStart('#').trim()
        } else {
            path.substringAfterLast('/').substringBeforeLast('.')
        }
    }

    private fun sha256(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(content.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

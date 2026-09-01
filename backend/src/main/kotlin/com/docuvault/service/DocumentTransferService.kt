package com.docuvault.service

import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.service.git.GitService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

enum class TransferMode { MOVE, COPY }

sealed interface TransferResult {
    data class Ok(val targetPath: String, val renamed: Boolean, val fileCount: Int) : TransferResult
    data class Failed(val reason: String) : TransferResult
}

/**
 * Moves or copies a document — or a whole folder — between spaces, or within
 * one. Two working trees are involved, so this is deliberately ordered as
 * copy → verify → remove: a failure part-way leaves the original where it was
 * rather than losing it between two repositories.
 *
 * Both spaces are committed separately, because they are separate Git repos.
 */
@Service
class DocumentTransferService(
    private val gitService: GitService,
    private val documentRepository: DocumentRepository,
    private val annotationService: AnnotationService,
    private val documentPersistService: DocumentPersistService,
    private val documentLineageService: DocumentLineageService
) {
    private val logger = LoggerFactory.getLogger(DocumentTransferService::class.java)

    @Transactional
    fun transfer(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetFolder: String,
        mode: TransferMode,
        user: User
    ): TransferResult {
        val sameSpace = sourceSpace.id == targetSpace.id
        val name = sourcePath.substringAfterLast('/')
        val requested = if (targetFolder.isBlank()) name else "${targetFolder.trim('/')}/$name"

        if (!gitService.itemExists(sourceSpace, sourcePath)) {
            return TransferResult.Failed("'$sourcePath' no longer exists in ${sourceSpace.name}.")
        }

        val isDirectory = gitService.isDirectory(sourceSpace, sourcePath)

        if (sameSpace && requested == sourcePath && mode == TransferMode.MOVE) {
            return TransferResult.Failed("That is already where it lives.")
        }
        // Dropping a folder inside itself would recurse until the disk gives out.
        if (isDirectory && sameSpace &&
            (targetFolder == sourcePath || targetFolder.startsWith("$sourcePath/"))
        ) {
            return TransferResult.Failed("Can't put a folder inside itself.")
        }

        val targetPath = freePath(targetSpace, requested)
        val containedFiles = gitService.listFilesUnder(sourceSpace, sourcePath)
        val fileCount = containedFiles.size

        if (!gitService.copyItemAcrossSpaces(sourceSpace, sourcePath, targetSpace, targetPath)) {
            return TransferResult.Failed("Could not write into ${targetSpace.name}.")
        }

        registerDocuments(sourceSpace, sourcePath, targetSpace, targetPath, isDirectory)

        if (mode == TransferMode.MOVE) {
            if (!gitService.removeItem(sourceSpace, sourcePath)) {
                // The copy is already in place, so the safe report is a copy —
                // saying "moved" while the original is still there would be a lie.
                logger.error("Copied '$sourcePath' to ${targetSpace.name} but could not remove the original")
                return TransferResult.Failed(
                    "Copied into ${targetSpace.name}, but the original could not be removed. " +
                        "It is now in both places."
                )
            }
            dropSourceDocuments(sourceSpace, sourcePath, isDirectory)
            moveAnnotations(sourceSpace, sourcePath, targetSpace, targetPath, isDirectory)
            // Only once the original is really gone: this record forwards the old
            // URL and carries the creator across the space boundary. Deleting the
            // file does not erase its git history, so the origin is still readable.
            documentLineageService.recordTransfer(
                sourceSpace = sourceSpace,
                sourcePath = sourcePath,
                targetSpace = targetSpace,
                targetPath = targetPath,
                isDirectory = isDirectory,
                containedFiles = containedFiles,
                user = user
            )
        }

        val verb = if (mode == TransferMode.MOVE) "Move" else "Copy"
        documentPersistService.commitIfRequested(
            targetSpace, autoCommit = true,
            message = "$verb $sourcePath from ${sourceSpace.name} to $targetPath", user = user
        )
        if (mode == TransferMode.MOVE && !sameSpace) {
            documentPersistService.commitIfRequested(
                sourceSpace, autoCommit = true,
                message = "$verb $sourcePath to ${targetSpace.name}", user = user
            )
        }

        return TransferResult.Ok(targetPath, renamed = targetPath != requested, fileCount = fileCount)
    }

    /**
     * A destination that is not already taken. Copying a document next to itself
     * is a normal way to duplicate one, so a collision picks `name (2).md`
     * rather than refusing or overwriting.
     */
    private fun freePath(space: Space, requested: String): String {
        if (!gitService.itemExists(space, requested)) return requested

        val folder = requested.substringBeforeLast('/', "")
        val fileName = requested.substringAfterLast('/')
        val hasExtension = fileName.contains('.') && !fileName.startsWith('.')
        val stem = if (hasExtension) fileName.substringBeforeLast('.') else fileName
        val extension = if (hasExtension) ".${fileName.substringAfterLast('.')}" else ""

        for (n in 2..999) {
            val candidate = listOf(folder, "$stem ($n)$extension")
                .filter { it.isNotEmpty() }
                .joinToString("/")
            if (!gitService.itemExists(space, candidate)) return candidate
        }
        return requested
    }

    /** Give the arrived files Document rows so search and the tree see them. */
    private fun registerDocuments(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        isDirectory: Boolean
    ) {
        val now = Instant.now()
        for (file in gitService.listFilesUnder(sourceSpace, sourcePath)) {
            val destination = if (isDirectory) {
                targetPath + file.removePrefix(sourcePath)
            } else {
                targetPath
            }
            if (documentRepository.findBySpaceIdAndPath(targetSpace.id!!, destination) != null) continue

            val source = documentRepository.findBySpaceIdAndPath(sourceSpace.id!!, file)
            documentRepository.save(
                Document(
                    space = targetSpace,
                    path = destination,
                    title = source?.title,
                    contentHash = source?.contentHash,
                    lastSyncedAt = now,
                    updatedAt = now
                )
            )
        }
    }

    private fun dropSourceDocuments(sourceSpace: Space, sourcePath: String, isDirectory: Boolean) {
        if (isDirectory) {
            val prefix = "$sourcePath/"
            documentRepository.findBySpaceId(sourceSpace.id!!)
                .filter { it.path == sourcePath || it.path.startsWith(prefix) }
                .forEach { documentRepository.delete(it) }
        } else {
            documentRepository.findBySpaceIdAndPath(sourceSpace.id!!, sourcePath)
                ?.let { documentRepository.delete(it) }
        }
    }

    /**
     * Comments belong to the document, so a move takes them along. A copy
     * deliberately does not — a duplicate starts without someone else's
     * unresolved discussion attached to it.
     */
    private fun moveAnnotations(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        isDirectory: Boolean
    ) {
        annotationService.repointToNewPath(
            sourceSpaceId = sourceSpace.id!!,
            sourcePath = sourcePath,
            targetSpace = targetSpace,
            targetPath = targetPath,
            isDirectory = isDirectory
        )
    }
}

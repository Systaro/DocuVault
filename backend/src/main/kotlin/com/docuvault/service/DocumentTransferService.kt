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
        user: User,
        onProgress: (ProgressUpdate) -> Unit = {}
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
        val leavesSource = mode == TransferMode.MOVE && !sameSpace
        val progress = OperationProgress(
            steps = 2 + (if (mode == TransferMode.MOVE) 2 else 0) +
                gitSteps(targetSpace) + (if (leavesSource) gitSteps(sourceSpace) else 0),
            listener = onProgress
        )

        progress.next("Copying files", fileCount)
        if (!gitService.copyItemAcrossSpaces(sourceSpace, sourcePath, targetSpace, targetPath) { progress.advance() }) {
            return TransferResult.Failed("Could not write into ${targetSpace.name}.")
        }

        progress.next("Updating the file index", fileCount)
        registerDocuments(sourceSpace, sourcePath, targetSpace, targetPath, isDirectory, containedFiles) {
            progress.advance()
        }

        if (mode == TransferMode.MOVE) {
            progress.next("Removing the originals")
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
            progress.next("Recording the new location")
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
        commit(
            targetSpace, "$verb $sourcePath from ${sourceSpace.name} to $targetPath", user, progress,
            named = !sameSpace
        )
        if (leavesSource) {
            commit(sourceSpace, "$verb $sourcePath to ${targetSpace.name}", user, progress, named = true)
        }

        logger.info(
            "$verb '$sourcePath' ($fileCount files) from '${sourceSpace.name}' to '$targetPath' " +
                "in '${targetSpace.name}': ${progress.summary()}"
        )
        return TransferResult.Ok(targetPath, renamed = targetPath != requested, fileCount = fileCount)
    }

    /**
     * Renames or moves an item within its space. Unlike [transfer] the item is
     * renamed on disk rather than copied, so its Document rows keep their ids and
     * everything attached to them. Returns false when the rename itself failed.
     */
    fun rename(
        space: Space,
        oldPath: String,
        newPath: String,
        user: User,
        onProgress: (ProgressUpdate) -> Unit = {}
    ): Boolean {
        val progress = OperationProgress(steps = 2 + gitSteps(space), listener = onProgress)
        val isDirectory = gitService.isDirectory(space, oldPath)

        progress.next("Moving")
        if (!gitService.renameItem(space, oldPath, newPath)) return false

        val prefix = "$oldPath/"
        val documents = if (isDirectory) {
            documentRepository.findBySpaceId(space.id!!).filter { it.path.startsWith(prefix) }
        } else {
            listOfNotNull(documentRepository.findBySpaceIdAndPath(space.id!!, oldPath))
        }
        progress.next("Updating the file index", documents.size)
        for (document in documents) {
            val path = if (isDirectory) "$newPath/${document.path.removePrefix(prefix)}" else newPath
            documentRepository.save(document.copy(path = path))
            progress.advance()
        }

        // Comments are addressed by (space, path), so they have to follow the
        // file — otherwise a rename strands every thread on it for good.
        annotationService.repointToNewPath(
            sourceSpaceId = space.id!!,
            sourcePath = oldPath,
            targetSpace = space,
            targetPath = newPath,
            isDirectory = isDirectory
        )

        // Links people already shared point at the old path; this forwards them.
        documentLineageService.recordRename(space, oldPath, newPath, isDirectory, user)

        commit(space, "Rename $oldPath to $newPath", user, progress, named = false)

        logger.info("Rename '$oldPath' to '$newPath' in '${space.name}': ${progress.summary()}")
        return true
    }

    /** Committing, plus pushing when the space has a remote — see [commit]. */
    private fun gitSteps(space: Space) = if (space.gitlabUrl.isNullOrBlank()) 1 else 2

    /**
     * Versions the change in [space] as one or two progress steps: the commit,
     * then the push if there is a remote. [named] puts the space in the labels,
     * for a transfer that commits in two spaces.
     */
    private fun commit(space: Space, message: String, user: User, progress: OperationProgress, named: Boolean) {
        progress.next(if (named) "Saving to Git in ${space.name}" else "Saving to Git")
        documentPersistService.commitIfRequested(
            space, autoCommit = true, message = message, user = user,
            beforePush = {
                progress.next(if (named) "Pushing ${space.name} to its Git remote" else "Pushing to the Git remote")
            }
        )
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

    /**
     * Give the arrived [files] Document rows so search and the tree see them.
     * Both spaces' rows are read once up front rather than twice per file.
     */
    private fun registerDocuments(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        isDirectory: Boolean,
        files: List<String>,
        onFile: () -> Unit
    ) {
        val now = Instant.now()
        val taken = documentRepository.findBySpaceId(targetSpace.id!!).mapTo(HashSet()) { it.path }
        val sources = documentRepository.findBySpaceId(sourceSpace.id!!).associateBy { it.path }
        for (file in files) {
            val destination = if (isDirectory) {
                targetPath + file.removePrefix(sourcePath)
            } else {
                targetPath
            }
            if (destination !in taken) {
                val source = sources[file]
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
            onFile()
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

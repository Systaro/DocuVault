package com.docuvault.service

import com.docuvault.domain.space.DocumentMove
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.DocumentMoveRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.git.FileVersion
import com.docuvault.service.git.GitDiffService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.*

/** Where a document that used to live at some path lives now. */
data class ResolvedLocation(
    val spaceId: UUID,
    val spaceFullPath: String,
    val spaceName: String,
    val path: String,
    /** True when the document travelled inside a folder that was moved. */
    val viaFolder: Boolean
)

/**
 * Keeps track of documents that moved.
 *
 * Two problems fall out of a move and both are solved from the same record:
 *
 *  - **Links rot.** Someone reorganises a space and every URL anyone has ever
 *    shared 404s. [resolve] forwards an old path to the current one.
 *  - **Attribution drifts.** Within a space git rename detection keeps the
 *    original author (see `GitDiffService.fileHistory`), but a move to another
 *    space starts a fresh history in the target repo, where the oldest commit is
 *    the move itself — so the person who moved the file would be shown as its
 *    creator. [recordTransfer] captures the real creation as the file leaves,
 *    and [originCreated] hands it back.
 */
@Service
class DocumentLineageService(
    private val documentMoveRepository: DocumentMoveRepository,
    private val spaceRepository: SpaceRepository,
    private val gitDiffService: GitDiffService
) {
    private val logger = LoggerFactory.getLogger(DocumentLineageService::class.java)

    companion object {
        /** A move chain longer than this is a loop or a mistake; stop walking it. */
        private const val MAX_HOPS = 20
    }

    /**
     * A rename or move inside one space. Git follows the content, so only the
     * forwarding record is needed.
     */
    @Transactional
    fun recordRename(space: Space, oldPath: String, newPath: String, isDirectory: Boolean, user: User) {
        if (oldPath == newPath) return
        documentMoveRepository.save(
            DocumentMove(
                sourceSpaceId = space.id!!,
                sourcePath = oldPath,
                targetSpaceId = space.id!!,
                targetPath = newPath,
                isDirectory = isDirectory,
                movedBy = user.id
            )
        )
    }

    /**
     * A move between two spaces. Records the item itself (so its old URL
     * forwards) and, because the target repo's history begins at the arrival
     * commit, one row per contained file carrying who really created it.
     *
     * Call this *before* the source files are removed — the origin lookup reads
     * the source space's git history.
     */
    @Transactional
    fun recordTransfer(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        isDirectory: Boolean,
        containedFiles: List<String>,
        user: User
    ) {
        val sameSpace = sourceSpace.id == targetSpace.id
        // Only a cross-space move loses its history — within a space git follows
        // the rename, so looking the origin up would just repeat what git knows.
        val keepsHistory = sameSpace
        val rows = mutableListOf<DocumentMove>()

        val itemOrigin = if (!keepsHistory && !isDirectory) originOf(sourceSpace, sourcePath) else null
        rows += moveRow(sourceSpace, sourcePath, targetSpace, targetPath, isDirectory, itemOrigin, user)

        // A folder needs a row per file on top of its own, since attribution is
        // per document and the folder row carries none.
        if (!keepsHistory && isDirectory) {
            val origins = originsOf(sourceSpace, containedFiles)
            for (file in containedFiles) {
                rows += moveRow(
                    sourceSpace, file,
                    targetSpace, targetPath + file.removePrefix(sourcePath),
                    isDirectory = false,
                    origin = origins[file],
                    user = user
                )
            }
        }

        documentMoveRepository.saveAll(rows)
    }

    private fun moveRow(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        isDirectory: Boolean,
        origin: FileVersion?,
        user: User
    ) = DocumentMove(
        sourceSpaceId = sourceSpace.id!!,
        sourcePath = sourcePath,
        targetSpaceId = targetSpace.id!!,
        targetPath = targetPath,
        isDirectory = isDirectory,
        originAuthorName = origin?.authorName,
        originAuthorEmail = origin?.authorEmail,
        originCommitSha = origin?.sha,
        originCreatedAt = origin?.committedAt,
        movedBy = user.id
    )

    /**
     * The creation recorded for the document now at this path, or null when it
     * never crossed spaces — in which case the space's own git history has it.
     */
    fun originCreated(spaceId: UUID, path: String): FileVersion? {
        val recorded = documentMoveRepository
            .findByTargetSpaceIdAndTargetPathOrderByMovedAtDesc(spaceId, path)
            .firstOrNull { it.originCreatedAt != null }
            ?: return null

        return FileVersion(
            sha = recorded.originCommitSha ?: "",
            shortSha = recorded.originCommitSha?.take(8) ?: "",
            message = null,
            authorName = recorded.originAuthorName,
            authorEmail = recorded.originAuthorEmail,
            committedAt = recorded.originCreatedAt!!
        )
    }

    /**
     * Where the document that used to be at [path] lives now, or null when
     * nothing was ever moved away from there.
     *
     * Follows chains (moved twice), matches folder moves by prefix, and prefers
     * the most specific folder when several could apply.
     */
    fun resolve(spaceId: UUID, path: String): ResolvedLocation? {
        var currentSpace = spaceId
        var currentPath = path.trim('/')
        var viaFolder = false
        var moved = false

        val seen = mutableSetOf("$currentSpace:$currentPath")

        for (hop in 0 until MAX_HOPS) {
            val next = nextHop(currentSpace, currentPath) ?: break
            currentSpace = next.spaceId
            currentPath = next.path
            viaFolder = viaFolder || next.viaFolder
            moved = true
            // A move back to where the file already was would loop forever.
            if (!seen.add("$currentSpace:$currentPath")) break
        }

        if (!moved) return null

        val space = spaceRepository.findById(currentSpace).orElse(null) ?: return null
        return ResolvedLocation(
            spaceId = currentSpace,
            spaceFullPath = space.getFullPath(),
            spaceName = space.name,
            path = currentPath,
            viaFolder = viaFolder
        )
    }

    private data class Hop(val spaceId: UUID, val path: String, val viaFolder: Boolean)

    /** One step of the chain: an exact move of this path, else the folder it rode along in. */
    private fun nextHop(spaceId: UUID, path: String): Hop? {
        documentMoveRepository
            .findBySourceSpaceIdAndSourcePathOrderByMovedAtDesc(spaceId, path)
            .firstOrNull()
            ?.let { return Hop(it.targetSpaceId, it.targetPath, viaFolder = false) }

        // Longest matching source folder wins — a file moved with `docs/api` must
        // not be resolved by an older move of `docs`.
        return documentMoveRepository
            .findBySourceSpaceIdAndIsDirectoryTrueOrderByMovedAtDesc(spaceId)
            .filter { path.startsWith("${it.sourcePath}/") }
            .maxByOrNull { it.sourcePath.length }
            ?.let {
                Hop(
                    spaceId = it.targetSpaceId,
                    path = it.targetPath + path.removePrefix(it.sourcePath),
                    viaFolder = true
                )
            }
    }

    /**
     * The true creation of a source file: what an earlier move recorded, else
     * the oldest commit in the source space's history.
     */
    private fun originOf(sourceSpace: Space, path: String): FileVersion? = try {
        originCreated(sourceSpace.id!!, path) ?: gitDiffService.fileMeta(sourceSpace, path).created
    } catch (e: Exception) {
        logger.warn("Could not read origin of '$path' in space '${sourceSpace.name}': ${e.message}")
        null
    }

    /** [originOf] for every file of a folder, with one history walk for all of them. */
    private fun originsOf(sourceSpace: Space, paths: List<String>): Map<String, FileVersion> = try {
        val recorded = paths.mapNotNull { path -> originCreated(sourceSpace.id!!, path)?.let { path to it } }.toMap()
        gitDiffService.createdMany(sourceSpace, paths.filterNot { it in recorded }) + recorded
    } catch (e: Exception) {
        logger.warn("Could not read the origins of ${paths.size} files in space '${sourceSpace.name}': ${e.message}")
        emptyMap()
    }
}

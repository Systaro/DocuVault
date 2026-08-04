package com.docuvault.service.git

import com.docuvault.domain.space.ChangeType
import com.docuvault.domain.space.Space
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.diff.DiffEntry
import org.eclipse.jgit.diff.RenameDetector
import org.eclipse.jgit.lib.Repository
import org.eclipse.jgit.revwalk.RevCommit
import org.eclipse.jgit.revwalk.RevWalk
import org.eclipse.jgit.treewalk.CanonicalTreeParser
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

data class DetectedChange(
    val filePath: String,
    val oldPath: String?,
    val changeType: ChangeType,
    val commitSha: String,
    val commitMessage: String?,
    val authorEmail: String?,
    val authorName: String?
)

data class FileVersion(
    val sha: String,
    val shortSha: String,
    val message: String?,
    val authorName: String?,
    val authorEmail: String?,
    val committedAt: java.time.Instant
)

data class FileHistoryMeta(
    /** Oldest commit that touched the file — who created it and when. */
    val created: FileVersion?,
    /** Newest commit that touched the file — who last edited it and when. */
    val lastEdited: FileVersion?
)

@Service
class GitDiffService(
    private val gitService: GitService
) {
    private val logger = LoggerFactory.getLogger(GitDiffService::class.java)

    fun currentHeadSha(space: Space): String? {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return null
        return try {
            Git.open(repoDir).use { it.repository.resolve("HEAD")?.name }
        } catch (e: Exception) {
            logger.warn("Failed to read HEAD for space '${space.name}': ${e.message}")
            null
        }
    }

    /**
     * Diffs every commit reachable from `toRef` but not from `fromRef`, attributing each
     * file change to the commit that introduced it. Returns one entry per file per commit.
     */
    fun changesBetween(space: Space, fromRef: String, toRef: String): List<DetectedChange> {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return emptyList()
        if (fromRef == toRef) return emptyList()

        return try {
            Git.open(repoDir).use { git ->
                val repo = git.repository
                val from = repo.resolve(fromRef) ?: return emptyList()
                val to = repo.resolve(toRef) ?: return emptyList()

                RevWalk(repo).use { walk ->
                    walk.markStart(walk.parseCommit(to))
                    walk.markUninteresting(walk.parseCommit(from))
                    walk.toList().reversed().flatMap { commit -> diffCommit(repo, commit) }
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to compute git diff for space '${space.name}' ($fromRef..$toRef): ${e.message}")
            emptyList()
        }
    }

    /**
     * All commits that touched the given file, newest first — the version track for
     * the document history / time-capsule view.
     */
    fun fileHistory(space: Space, path: String, limit: Int = 200): List<FileVersion> {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return emptyList()

        return try {
            Git.open(repoDir).use { git ->
                git.log()
                    .addPath(path)
                    .setMaxCount(limit)
                    .call()
                    .map { it.toFileVersion() }
            }
        } catch (e: Exception) {
            logger.warn("Failed to read file history for '${path}' in space '${space.name}': ${e.message}")
            emptyList()
        }
    }

    /**
     * First and last commit that touched the given file. Unlike [fileHistory] this
     * walks the full log, so `created` stays correct past the history cap.
     */
    fun fileMeta(space: Space, path: String): FileHistoryMeta {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return FileHistoryMeta(null, null)

        return try {
            Git.open(repoDir).use { git ->
                var newest: RevCommit? = null
                var oldest: RevCommit? = null
                for (commit in git.log().addPath(path).call()) {
                    if (newest == null) newest = commit
                    oldest = commit
                }
                FileHistoryMeta(
                    created = oldest?.toFileVersion(),
                    lastEdited = newest?.toFileVersion()
                )
            }
        } catch (e: Exception) {
            logger.warn("Failed to read file meta for '${path}' in space '${space.name}': ${e.message}")
            FileHistoryMeta(null, null)
        }
    }

    private fun RevCommit.toFileVersion() = FileVersion(
        sha = name,
        shortSha = name.take(8),
        message = shortMessage,
        authorName = authorIdent?.name,
        authorEmail = authorIdent?.emailAddress,
        committedAt = java.time.Instant.ofEpochSecond(commitTime.toLong())
    )

    /**
     * Unified diff of what the given commit changed in the given file (vs the
     * commit's parent; the first commit diffs against the empty tree). Returns
     * null when the repo or commit is missing, an empty string when the commit
     * did not touch the file.
     */
    fun fileDiffAtCommit(space: Space, sha: String, path: String): String? {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return null

        return try {
            Git.open(repoDir).use { git ->
                val repo = git.repository
                val commitId = repo.resolve(sha) ?: return null
                RevWalk(repo).use { walk ->
                    val commit = walk.parseCommit(commitId)
                    val parent = commit.parents.firstOrNull()?.let { walk.parseCommit(it) }
                    val out = java.io.ByteArrayOutputStream()
                    org.eclipse.jgit.diff.DiffFormatter(out).use { formatter ->
                        formatter.setRepository(repo)
                        formatter.isDetectRenames = true
                        val entries = formatter.scan(parent?.tree, commit.tree)
                            .filter { it.newPath == path || it.oldPath == path }
                        entries.forEach { formatter.format(it) }
                    }
                    out.toString(Charsets.UTF_8)
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to compute diff for '$path' at $sha in space '${space.name}': ${e.message}")
            null
        }
    }

    /** File content as it existed at the given commit, or null when absent there. */
    fun fileAtCommit(space: Space, sha: String, path: String): String? {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return null

        return try {
            Git.open(repoDir).use { git ->
                val repo = git.repository
                val commitId = repo.resolve(sha) ?: return null
                RevWalk(repo).use { walk ->
                    val commit = walk.parseCommit(commitId)
                    val treeWalk = org.eclipse.jgit.treewalk.TreeWalk.forPath(repo, path, commit.tree)
                        ?: return null
                    treeWalk.use {
                        String(repo.open(it.getObjectId(0)).bytes, Charsets.UTF_8)
                    }
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to read '$path' at $sha in space '${space.name}': ${e.message}")
            null
        }
    }

    private fun diffCommit(repo: Repository, commit: RevCommit): List<DetectedChange> {
        val parent = commit.parents.firstOrNull() ?: return emptyList()
        val newTree = CanonicalTreeParser().also { it.reset(repo.newObjectReader(), commit.tree) }
        val oldTree = CanonicalTreeParser().also { it.reset(repo.newObjectReader(), parent.tree) }

        Git.wrap(repo).use { git ->
            val rawDiffs = git.diff()
                .setNewTree(newTree)
                .setOldTree(oldTree)
                .call()

            val withRenames = RenameDetector(repo).apply { addAll(rawDiffs) }.compute()

            val sha = commit.name
            val msg = commit.shortMessage
            val authorEmail = commit.authorIdent?.emailAddress
            val authorName = commit.authorIdent?.name

            return withRenames.map { entry ->
                val type = when (entry.changeType) {
                    DiffEntry.ChangeType.ADD -> ChangeType.ADDED
                    DiffEntry.ChangeType.MODIFY -> ChangeType.MODIFIED
                    DiffEntry.ChangeType.DELETE -> ChangeType.DELETED
                    DiffEntry.ChangeType.RENAME, DiffEntry.ChangeType.COPY -> ChangeType.RENAMED
                    else -> ChangeType.MODIFIED
                }
                val newPath = if (entry.newPath == DiffEntry.DEV_NULL) entry.oldPath else entry.newPath
                val oldPath = if (type == ChangeType.RENAMED && entry.oldPath != DiffEntry.DEV_NULL) entry.oldPath else null
                DetectedChange(
                    filePath = newPath,
                    oldPath = oldPath,
                    changeType = type,
                    commitSha = sha,
                    commitMessage = msg,
                    authorEmail = authorEmail,
                    authorName = authorName
                )
            }
        }
    }
}

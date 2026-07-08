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
                    .map { commit ->
                        FileVersion(
                            sha = commit.name,
                            shortSha = commit.name.take(8),
                            message = commit.shortMessage,
                            authorName = commit.authorIdent?.name,
                            authorEmail = commit.authorIdent?.emailAddress,
                            committedAt = java.time.Instant.ofEpochSecond(commit.commitTime.toLong())
                        )
                    }
            }
        } catch (e: Exception) {
            logger.warn("Failed to read file history for '${path}' in space '${space.name}': ${e.message}")
            emptyList()
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

package com.docuvault.service.git

import com.docuvault.domain.space.ChangeType
import com.docuvault.domain.space.Space
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.diff.DiffEntry
import org.eclipse.jgit.diff.RenameDetector
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.lib.ObjectId
import org.eclipse.jgit.lib.Repository
import org.eclipse.jgit.revwalk.RevCommit
import org.eclipse.jgit.revwalk.RevWalk
import org.eclipse.jgit.treewalk.CanonicalTreeParser
import org.eclipse.jgit.treewalk.EmptyTreeIterator
import org.eclipse.jgit.treewalk.TreeWalk
import org.eclipse.jgit.treewalk.filter.AndTreeFilter
import org.eclipse.jgit.treewalk.filter.PathFilterGroup
import org.eclipse.jgit.treewalk.filter.TreeFilter
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
    val committedAt: java.time.Instant,
    /**
     * Path the file had at this commit. Differs from the file's current path for
     * versions before a rename/move; null where the walk doesn't track it.
     */
    val path: String? = null
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

    companion object {
        /** Guard against a pathological rename chain stalling a page render. */
        private const val MAX_RENAME_HOPS = 20
    }

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
     *
     * Follows renames, so moving a document keeps its past instead of restarting
     * the track at the move commit.
     */
    fun fileHistory(space: Space, path: String, limit: Int = 200): List<FileVersion> {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return emptyList()

        return try {
            Git.open(repoDir).use { git ->
                followRenames(git, path, limit).map { (commit, pathThen) ->
                    commit.toFileVersion(pathThen)
                }
            }
        } catch (e: Exception) {
            logger.warn("Failed to read file history for '${path}' in space '${space.name}': ${e.message}")
            emptyList()
        }
    }

    /**
     * First and last commit that touched the given file. Unlike [fileHistory] this
     * walks the full log, so `created` stays correct past the history cap.
     *
     * Renames are followed here too — without that, whoever moved a document
     * would be shown as having created it, because the move commit is the oldest
     * one touching the new path.
     */
    fun fileMeta(space: Space, path: String): FileHistoryMeta {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return FileHistoryMeta(null, null)

        return try {
            Git.open(repoDir).use { git ->
                val track = followRenames(git, path, limit = Int.MAX_VALUE)
                FileHistoryMeta(
                    created = track.lastOrNull()?.let { (c, p) -> c.toFileVersion(p) },
                    lastEdited = track.firstOrNull()?.let { (c, p) -> c.toFileVersion(p) }
                )
            }
        } catch (e: Exception) {
            logger.warn("Failed to read file meta for '${path}' in space '${space.name}': ${e.message}")
            FileHistoryMeta(null, null)
        }
    }

    /**
     * Where each of [paths] was created — [fileMeta]'s `created`, for many files
     * at once. A folder that moves to another space needs it for every file
     * inside, and a full log per file costs 50–80 ms each on a repository with a
     * thousand commits, so a 200-file folder spent longer on this than on the
     * move itself.
     *
     * Renames are followed as in [followRenames], but the history is walked once
     * per rename hop for all paths together, and each commit's renames are
     * detected once rather than once per file. Paths with no history are absent.
     */
    fun createdMany(space: Space, paths: Collection<String>): Map<String, FileVersion> {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists() || paths.isEmpty()) return emptyMap()

        return try {
            Git.open(repoDir).use { git ->
                val repo = git.repository
                val head = repo.resolve(Constants.HEAD) ?: return emptyMap()
                val created = mutableMapOf<String, FileVersion>()
                val renamesByCommit = mutableMapOf<ObjectId, Map<String, RenameHop>>()
                // Commit to walk back from → path to look for there → the path the
                // file is known by today.
                var pending: Map<ObjectId, Map<String, String>> = mapOf(head to paths.associateWith { it })
                var hops = 0

                while (pending.isNotEmpty() && hops++ < MAX_RENAME_HOPS) {
                    val next = mutableMapOf<ObjectId, MutableMap<String, String>>()
                    for ((start, tracked) in pending) {
                        for ((pathThen, commit) in oldestCommits(repo, start, tracked.keys)) {
                            val current = tracked.getValue(pathThen)
                            created[current] = commit.toFileVersion(pathThen)
                            val id = commit.toObjectId()
                            val hop = renamesByCommit.getOrPut(id) { renamesIn(repo, id) }[pathThen] ?: continue
                            next.getOrPut(hop.parent) { mutableMapOf() }[hop.fromPath] = current
                        }
                    }
                    pending = next
                }
                created
            }
        } catch (e: Exception) {
            logger.warn("Failed to read where ${paths.size} files were created in space '${space.name}': ${e.message}")
            emptyMap()
        }
    }

    /**
     * The oldest commit reachable from [start] that touched each of [paths] — the
     * batch form of reading `git log <path>` to its end, in one walk. Each commit
     * is compared with its first parent; paths nothing touched are absent.
     */
    private fun oldestCommits(repo: Repository, start: ObjectId, paths: Set<String>): Map<String, RevCommit> {
        val oldest = mutableMapOf<String, RevCommit>()
        RevWalk(repo).use { walk ->
            walk.markStart(walk.parseCommit(start))
            TreeWalk(repo).use { tree ->
                tree.isRecursive = true
                tree.filter = AndTreeFilter.create(PathFilterGroup.createFromStrings(paths), TreeFilter.ANY_DIFF)
                for (commit in walk) {
                    tree.reset()
                    if (commit.parentCount > 0) {
                        tree.addTree(walk.parseCommit(commit.getParent(0)).tree)
                    } else {
                        tree.addTree(EmptyTreeIterator())
                    }
                    tree.addTree(commit.tree)
                    // Newest first, so the last commit seen for a path is its oldest.
                    while (tree.next()) oldest[tree.pathString] = commit
                }
            }
        }
        return oldest
    }

    /**
     * Commits that touched the file, newest first, paired with the path the file
     * had at that commit — the equivalent of `git log --follow`.
     *
     * Walked in hops: log the current path until its oldest commit, ask whether
     * that commit got the file by renaming something else, and if so continue
     * from the old path before that commit. Rename detection therefore runs once
     * per rename rather than once per commit.
     */
    private fun followRenames(git: Git, startPath: String, limit: Int): List<Pair<RevCommit, String>> {
        val repo = git.repository
        val track = mutableListOf<Pair<RevCommit, String>>()
        var path = startPath
        var from: org.eclipse.jgit.lib.ObjectId? = repo.resolve(org.eclipse.jgit.lib.Constants.HEAD) ?: return track
        var hops = 0

        while (from != null && track.size < limit && hops++ < MAX_RENAME_HOPS) {
            val remaining = limit - track.size
            val log = git.log().add(from).addPath(path)
            if (remaining < Int.MAX_VALUE) log.setMaxCount(remaining)
            val commits = log.call().toList()
            if (commits.isEmpty()) break

            val pathAtHop = path
            commits.forEach { track.add(it to pathAtHop) }
            if (track.size >= limit) break

            // The oldest commit on this path either created the file or renamed
            // it here from somewhere else; only the latter continues the walk.
            val hop = renameHop(repo, commits.last().id, path) ?: break
            path = hop.fromPath
            from = hop.parent
        }
        return track
    }

    /** Where a rename came from, plus the commit to keep walking back from. */
    private data class RenameHop(val fromPath: String, val parent: org.eclipse.jgit.lib.ObjectId)

    /**
     * The path the file currently at [currentPath] had at commit [sha], or null
     * when that commit is not part of its history. Differs from [currentPath]
     * only for versions from before a rename.
     */
    private fun historicalPath(git: Git, currentPath: String, sha: String): String? =
        followRenames(git, currentPath, limit = Int.MAX_VALUE)
            .firstOrNull { (commit, _) -> commit.name == sha }
            ?.second
            ?.takeIf { it != currentPath }

    /**
     * Whether the commit [commitId] got [path] by renaming something else, and
     * if so from where. Null when it created the file outright.
     */
    private fun renameHop(repo: Repository, commitId: ObjectId, path: String): RenameHop? =
        renamesIn(repo, commitId)[path]

    /**
     * Every path the commit [commitId] got by renaming or copying something else,
     * keyed by that path. Empty for a commit that renamed nothing.
     *
     * The commit is re-read in a plain [RevWalk] on purpose: a path-filtered log
     * rewrites parents to simplify history, so the commit handed in may claim to
     * have no parent at all, and its real parent's tree is unparsed.
     */
    private fun renamesIn(repo: Repository, commitId: ObjectId): Map<String, RenameHop> {
        return try {
            RevWalk(repo).use { walk ->
                val self = walk.parseCommit(commitId)
                if (self.parentCount == 0) return emptyMap()
                val parent = walk.parseCommit(self.getParent(0).id)

                val reader = repo.newObjectReader()
                val newTree = CanonicalTreeParser().also { it.reset(reader, self.tree) }
                val oldTree = CanonicalTreeParser().also { it.reset(reader, parent.tree) }
                Git.wrap(repo).use { git ->
                    val raw = git.diff().setNewTree(newTree).setOldTree(oldTree).call()
                    RenameDetector(repo).apply { addAll(raw) }.compute()
                        .filter {
                            it.changeType == DiffEntry.ChangeType.RENAME ||
                                it.changeType == DiffEntry.ChangeType.COPY
                        }
                        .associate { it.newPath to RenameHop(it.oldPath, parent.id) }
                }
            }
        } catch (e: Exception) {
            logger.warn("Rename detection failed at ${commitId.name}: ${e.message}")
            emptyMap()
        }
    }

    /**
     * Last commit that touched each direct child of [folder] — the "last change"
     * column of a folder listing.
     *
     * Walks the history once for the whole folder rather than running a log per
     * entry, and stops as soon as every entry is accounted for (or [maxCommits]
     * commits in, so a huge history can't stall a page render). Entries with no
     * commit found are simply absent from the result.
     */
    fun folderEntryVersions(
        space: Space,
        folder: String,
        entries: Set<String>,
        maxCommits: Int = 500
    ): Map<String, FileVersion> {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists() || entries.isEmpty()) return emptyMap()

        val prefix = folder.trim('/').let { if (it.isEmpty()) "" else "$it/" }
        val pending = entries.toMutableSet()
        val found = mutableMapOf<String, FileVersion>()

        return try {
            Git.open(repoDir).use { git ->
                val repo = git.repository
                var walked = 0
                for (commit in git.log().call()) {
                    if (pending.isEmpty() || walked++ >= maxCommits) break
                    val version by lazy { commit.toFileVersion() }
                    for (path in commitPaths(repo, commit)) {
                        if (!path.startsWith(prefix)) continue
                        val child = path.removePrefix(prefix).substringBefore('/')
                        if (pending.remove(child)) found[child] = version
                    }
                }
            }
            found
        } catch (e: Exception) {
            logger.warn("Failed to read folder history for '$folder' in space '${space.name}': ${e.message}")
            emptyMap()
        }
    }

    /** Paths a commit touched. The root commit has no parent, so it counts as adding its whole tree. */
    private fun commitPaths(repo: Repository, commit: RevCommit): List<String> {
        val parent = commit.parents.firstOrNull()
        val reader = repo.newObjectReader()

        if (parent == null) {
            val walk = org.eclipse.jgit.treewalk.TreeWalk(repo)
            walk.addTree(commit.tree)
            walk.isRecursive = true
            val paths = mutableListOf<String>()
            walk.use { while (it.next()) paths.add(it.pathString) }
            return paths
        }

        val newTree = CanonicalTreeParser().also { it.reset(reader, commit.tree) }
        val oldTree = CanonicalTreeParser().also { it.reset(reader, parent.tree) }
        return Git.wrap(repo).use { git ->
            git.diff().setNewTree(newTree).setOldTree(oldTree).call().map { entry ->
                if (entry.newPath == DiffEntry.DEV_NULL) entry.oldPath else entry.newPath
            }
        }
    }

    private fun RevCommit.toFileVersion(pathThen: String? = null) = FileVersion(
        sha = name,
        shortSha = name.take(8),
        message = shortMessage,
        authorName = authorIdent?.name,
        authorEmail = authorIdent?.emailAddress,
        committedAt = java.time.Instant.ofEpochSecond(commitTime.toLong()),
        path = pathThen
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
                        val scanned = formatter.scan(parent?.tree, commit.tree)
                        var entries = scanned.filter { it.newPath == path || it.oldPath == path }
                        // Nothing under the current path: before a rename the
                        // file appears under its old one, so follow the track.
                        if (entries.isEmpty()) {
                            val then = historicalPath(git, path, sha)
                            if (then != null) {
                                entries = scanned.filter { it.newPath == then || it.oldPath == then }
                            }
                        }
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

    /**
     * File content as it existed at the given commit, or null when absent there.
     *
     * A version from before a rename is stored under the old path, so when the
     * current path is not in that commit the file's rename track is consulted
     * before giving up.
     */
    fun fileAtCommit(space: Space, sha: String, path: String): String? {
        val repoDir = gitService.getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) return null

        return try {
            Git.open(repoDir).use { git ->
                val repo = git.repository
                val commitId = repo.resolve(sha) ?: return null
                RevWalk(repo).use { walk ->
                    val commit = walk.parseCommit(commitId)
                    val resolved = if (org.eclipse.jgit.treewalk.TreeWalk.forPath(repo, path, commit.tree) != null) {
                        path
                    } else {
                        historicalPath(git, path, sha) ?: return null
                    }
                    val treeWalk = org.eclipse.jgit.treewalk.TreeWalk.forPath(repo, resolved, commit.tree)
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

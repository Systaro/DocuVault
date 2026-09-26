package com.docuvault.service.git

import com.docuvault.domain.space.Space
import com.docuvault.service.SettingsService
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.api.ResetCommand
import org.eclipse.jgit.api.errors.CheckoutConflictException
import org.eclipse.jgit.api.errors.TransportException
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.io.File
import java.net.UnknownHostException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.*
import java.util.concurrent.ConcurrentHashMap

@Service
class GitService(
    @Value("\${git.repos-path}") private val reposPath: String,
    private val settingsService: SettingsService,
    @Value("\${app.git.author-email}") private val botEmail: String
) {
    private val logger = LoggerFactory.getLogger(GitService::class.java)

    // Serializes commit/init operations per space — concurrent saves (autosave from
    // several sessions) would otherwise clash on JGit's index.lock.
    private val repoLocks = ConcurrentHashMap<UUID, Any>()

    private fun lockFor(spaceId: UUID): Any = repoLocks.computeIfAbsent(spaceId) { Any() }

    private fun getCredentialsProvider(): UsernamePasswordCredentialsProvider {
        return UsernamePasswordCredentialsProvider("oauth2", settingsService.getGitlabToken())
    }

    fun getRepoPath(spaceId: UUID): Path = Path.of(reposPath, spaceId.toString())

    /**
     * Lazily turns a space's plain content directory into a local Git repository so
     * every space is versioned, remote or not. Existing on-disk content is captured
     * as a baseline commit so the first real change diffs against the pre-existing
     * state instead of being mixed into it. No-op when a repo already exists.
     */
    fun ensureLocalRepo(space: Space) {
        val repoDir = getRepoPath(space.id!!)
        if (Files.exists(repoDir.resolve(".git"))) return
        synchronized(lockFor(space.id!!)) {
            if (Files.exists(repoDir.resolve(".git"))) return
            try {
                Files.createDirectories(repoDir)
                Git.init().setDirectory(repoDir.toFile()).call().use { git ->
                    if (!git.status().call().isClean) {
                        git.add().addFilepattern(".").call()
                        git.commit()
                            .setMessage("DocuVault: baseline snapshot of existing content")
                            .setAuthor("docuvault-bot", botEmail)
                            .call()
                    }
                }
                logger.info("Initialized local git repository for space '${space.name}' (${space.id})")
            } catch (e: Exception) {
                logger.error("Failed to init local git repository for space '${space.name}': ${e.message}", e)
            }
        }
    }

    /**
     * Clones a repository for the given space.
     * @throws GitOperationException with specific error codes on failure
     */
    fun cloneRepository(space: Space) {
        validateConfiguration(space)

        val repoDir = getRepoPath(space.id!!).toFile()

        if (repoDir.exists()) {
            logger.info("Repository already exists for space '${space.name}' (${space.id})")
            return
        }

        logger.info("Cloning repository for space '${space.name}' from ${space.gitlabUrl}")

        try {
            Git.cloneRepository()
                .setURI(space.gitlabUrl)
                .setDirectory(repoDir)
                .setBranch(space.branch)
                .setCredentialsProvider(getCredentialsProvider())
                .call()
                .close()

            logger.info("Successfully cloned repository for space '${space.name}'")
        } catch (e: Exception) {
            logger.error("Failed to clone repository for space '${space.name}': ${e.message}", e)
            // Clean up partial clone
            repoDir.deleteRecursively()
            throw mapException(e, GitErrorCode.CLONE_FAILED, "clone repository")
        }
    }

    /**
     * Pulls latest changes from the remote repository.
     * @throws GitOperationException with specific error codes on failure
     */
    fun pullChanges(space: Space) {
        validateConfiguration(space)

        val repoDir = getRepoPath(space.id!!).toFile()

        if (!repoDir.exists()) {
            logger.info("Repository doesn't exist for space '${space.name}', cloning...")
            cloneRepository(space)
            return
        }

        logger.info("Pulling changes for space '${space.name}'")

        try {
            Git.open(repoDir).use { git ->
                // Commit whatever is sitting in the working tree before merging. Editor
                // autosaves land there uncommitted, and both a checkout conflict and the
                // merge-abort reset below would otherwise discard them without a trace.
                snapshotDirtyWorkingTree(git, space, "DocuVault: autosaved changes in '${space.name}'")

                var baseRef = git.repository.resolve("HEAD")?.name
                    ?: throw GitOperationException(GitErrorCode.PULL_FAILED, "Repository HEAD is unresolved")

                val result = try {
                    git.pull()
                        .setRemoteBranchName(space.branch)
                        .setCredentialsProvider(getCredentialsProvider())
                        .call()
                } catch (e: CheckoutConflictException) {
                    // JGit couldn't start the merge because the working tree has dirty files
                    // that would be overwritten. Snapshot those edits as a docuvault-bot commit
                    // so we have a single ref to branch off, then retry the pull. If the retry
                    // itself hits a merge conflict, the normal flow below handles it.
                    logger.warn("Checkout conflict for space '${space.name}' — snapshotting dirty working tree as docuvault-bot and retrying pull")
                    if (!snapshotDirtyWorkingTree(git, space, "DocuVault: snapshot local changes before conflict resolution in '${space.name}'")) {
                        // Nothing to commit but JGit still failed — treat as a hard error.
                        throw e
                    }
                    baseRef = git.repository.resolve("HEAD")?.name ?: baseRef
                    git.pull()
                        .setRemoteBranchName(space.branch)
                        .setCredentialsProvider(getCredentialsProvider())
                        .call()
                }

                if (result.mergeResult?.mergeStatus?.isSuccessful == false) {
                    logger.warn("Merge conflict during pull for space '${space.name}', resetting to $baseRef")
                    // Clean the working tree so the repo is usable again — we'll branch off baseRef later.
                    try {
                        git.reset()
                            .setMode(ResetCommand.ResetType.HARD)
                            .setRef(baseRef)
                            .call()
                    } catch (resetEx: Exception) {
                        logger.error("Failed to reset after merge conflict for space '${space.name}': ${resetEx.message}", resetEx)
                    }
                    throw MergeConflictException(baseRef)
                }
            }
            logger.info("Successfully pulled changes for space '${space.name}'")
        } catch (e: GitOperationException) {
            throw e
        } catch (e: Exception) {
            logger.error("Failed to pull changes for space '${space.name}': ${e.message}", e)
            throw mapException(e, GitErrorCode.PULL_FAILED, "pull changes")
        }
    }

    /**
     * Commits any dirty working-tree changes as a docuvault-bot snapshot so that
     * a subsequent pull has a clean slate to merge into. Returns `false` if the
     * working tree was already clean (nothing to commit).
     */
    private fun snapshotDirtyWorkingTree(git: Git, space: Space, message: String): Boolean {
        if (!stageChanges(git)) return false

        git.commit()
            .setMessage(message)
            .setAuthor("docuvault-bot", botEmail)
            .call()
        return true
    }

    /**
     * Stages what changed in the working tree — new and modified files are added,
     * deleted ones removed — and returns false when there is nothing to commit.
     *
     * Only the changed paths are handed to `add`. JGit's `add .` reads and hashes
     * every file in the tree whether it changed or not, which on a space with a
     * couple of hundred megabytes of attachments cost ~6 s on every single commit.
     * Status compares file metadata first, so finding the changes is cheap.
     */
    private fun stageChanges(git: Git): Boolean {
        val status = git.status().call()
        if (status.isClean) return false

        val changed = status.untracked + status.modified + status.conflicting
        if (changed.isNotEmpty()) {
            val add = git.add()
            changed.forEach { add.addFilepattern(it) }
            add.call()
        }
        if (status.missing.isNotEmpty()) {
            val rm = git.rm()
            status.missing.forEach { rm.addFilepattern(it) }
            rm.call()
        }
        return true
    }

    /**
     * Commits pending changes and, when the space has a remote configured, pushes
     * them. Spaces without a remote commit into their lazily-initialized local
     * repository — every space is versioned, only the push is conditional.
     * [beforePush] runs once the commit is in, so a progress display can tell the
     * two apart — the push is usually the slower half.
     * @throws GitOperationException with specific error codes on failure
     */
    fun commitAndPush(
        space: Space,
        message: String,
        authorName: String,
        authorEmail: String,
        beforePush: () -> Unit = {}
    ) {
        val hasRemote = !space.gitlabUrl.isNullOrBlank()
        if (hasRemote) validateConfiguration(space)

        val repoDir = getRepoPath(space.id!!).toFile()

        if (!repoDir.exists() || !File(repoDir, ".git").exists()) {
            if (hasRemote) {
                throw GitOperationException(
                    GitErrorCode.REPO_NOT_FOUND,
                    "Repository not found. Please sync from Git first."
                )
            }
            ensureLocalRepo(space)
        }

        logger.info("Committing changes for space '${space.name}' by $authorName (push: $hasRemote)")

        try {
            val started = System.nanoTime()
            var committedAt: Long
            synchronized(lockFor(space.id!!)) {
                Git.open(repoDir).use { git ->
                    if (stageChanges(git)) {
                        git.commit()
                            .setMessage(message)
                            .setAuthor(authorName, authorEmail)
                            .call()
                    }
                    committedAt = System.nanoTime()

                    if (hasRemote) {
                        beforePush()
                        git.push()
                            .setCredentialsProvider(getCredentialsProvider())
                            .call()
                    }
                }
            }
            val done = System.nanoTime()
            logger.info(
                "Successfully committed changes for space '${space.name}' " +
                    "(commit ${(committedAt - started) / 1_000_000} ms, push ${(done - committedAt) / 1_000_000} ms)"
            )
        } catch (e: Exception) {
            logger.error("Failed to commit/push changes for space '${space.name}': ${e.message}", e)
            throw mapException(e, GitErrorCode.PUSH_FAILED, "push changes")
        }
    }

    /**
     * Validates that a resolved path stays within the repository directory.
     * Prevents path traversal attacks (e.g., ../../etc/passwd).
     */
    private fun validatePath(repoDir: Path, userPath: String): Path {
        val resolved = repoDir.resolve(userPath).normalize()
        if (!resolved.startsWith(repoDir.normalize())) {
            throw IllegalArgumentException("Path traversal detected: '$userPath' resolves outside repository")
        }
        return resolved
    }

    fun readFile(space: Space, path: String): String? {
        val repoDir = getRepoPath(space.id!!)
        val filePath = validatePath(repoDir, path)

        return if (Files.exists(filePath) && Files.isRegularFile(filePath)) {
            Files.readString(filePath)
        } else {
            null
        }
    }

    /** Baseline-snapshot local spaces before the first mutation so history diffs stay clean. */
    private fun ensureVersionedBeforeMutation(space: Space) {
        if (space.gitlabUrl.isNullOrBlank()) ensureLocalRepo(space)
    }

    fun writeFile(space: Space, path: String, content: String): Boolean {
        ensureVersionedBeforeMutation(space)
        val repoDir = getRepoPath(space.id!!)
        val filePath = validatePath(repoDir, path)

        return try {
            Files.createDirectories(filePath.parent)
            Files.writeString(filePath, content)
            true
        } catch (e: Exception) {
            logger.error("Failed to write file for space '${space.name}': ${e.message}", e)
            false
        }
    }

    fun writeBinaryFile(space: Space, path: String, bytes: ByteArray): Boolean {
        ensureVersionedBeforeMutation(space)
        val repoDir = getRepoPath(space.id!!)
        val filePath = validatePath(repoDir, path)

        return try {
            Files.createDirectories(filePath.parent)
            Files.write(filePath, bytes)
            true
        } catch (e: Exception) {
            logger.error("Failed to write binary file for space '${space.name}': ${e.message}", e)
            false
        }
    }

    fun deleteFile(space: Space, path: String): Boolean {
        ensureVersionedBeforeMutation(space)
        val repoDir = getRepoPath(space.id!!)
        val filePath = validatePath(repoDir, path)

        return try {
            Files.deleteIfExists(filePath)
            true
        } catch (e: Exception) {
            logger.error("Failed to delete file for space '${space.name}': ${e.message}", e)
            false
        }
    }

    /** How many regular files sit under a directory, at any depth. */
    fun countFilesIn(space: Space, path: String): Int {
        val repoDir = getRepoPath(space.id!!)
        return try {
            val dirPath = validatePath(repoDir, path)
            if (!Files.isDirectory(dirPath)) return 0
            Files.walk(dirPath).use { stream -> stream.filter { Files.isRegularFile(it) }.count().toInt() }
        } catch (e: Exception) {
            logger.warn("Failed to count files under '$path' for space '${space.name}': ${e.message}")
            0
        }
    }

    /**
     * Deletes a directory and everything inside it. Children are removed before
     * their parents, since a directory has to be empty before it can go.
     */
    fun deleteDirectory(space: Space, path: String): Boolean {
        ensureVersionedBeforeMutation(space)
        val repoDir = getRepoPath(space.id!!)
        val dirPath = validatePath(repoDir, path)

        // Refuse to wipe the repository itself — only paths below it.
        if (dirPath == repoDir.normalize()) {
            logger.warn("Refused to delete the repository root of space '${space.name}'")
            return false
        }

        return try {
            if (!Files.exists(dirPath)) return true
            Files.walk(dirPath).use { stream ->
                stream.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
            }
            true
        } catch (e: Exception) {
            logger.error("Failed to delete directory '$path' for space '${space.name}': ${e.message}", e)
            false
        }
    }

    fun listFiles(space: Space, directory: String = ""): List<FileNode> {
        val repoDir = getRepoPath(space.id!!)
        val targetDir = if (directory.isBlank()) repoDir else validatePath(repoDir, directory)

        if (!Files.exists(targetDir) || !Files.isDirectory(targetDir)) {
            return emptyList()
        }

        return Files.list(targetDir)
            .filter { !it.fileName.toString().startsWith(".git") }
            .map { path ->
                val relativePath = repoDir.relativize(path).toString()
                FileNode(
                    name = path.fileName.toString(),
                    path = relativePath,
                    isDirectory = Files.isDirectory(path),
                    children = if (Files.isDirectory(path)) emptyList() else null
                )
            }
            .sorted(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
            .toList()
    }

    fun getFileTree(space: Space): List<FileNode> {
        return buildFileTree(space, "")
    }

    private fun buildFileTree(space: Space, directory: String): List<FileNode> {
        val repoDir = getRepoPath(space.id!!)
        val nodes = listFiles(space, directory)
        return nodes.mapNotNull { node ->
            if (node.isDirectory) {
                val children = buildFileTree(space, node.path)
                if (children.isEmpty() && !Files.exists(validatePath(repoDir, "${node.path}/.gitkeep"))) {
                    null
                } else {
                    node.copy(children = children)
                }
            } else {
                node
            }
        }
    }

    fun createFolder(space: Space, path: String): Boolean {
        return writeFile(space, "$path/.gitkeep", "")
    }

    fun renameItem(space: Space, oldPath: String, newPath: String): Boolean {
        ensureVersionedBeforeMutation(space)
        val repoDir = getRepoPath(space.id!!)
        val sourcePath = validatePath(repoDir, oldPath)
        val targetPath = validatePath(repoDir, newPath)

        return try {
            Files.createDirectories(targetPath.parent)
            Files.move(sourcePath, targetPath)
            true
        } catch (e: Exception) {
            logger.error("Failed to rename '$oldPath' to '$newPath' for space '${space.name}': ${e.message}", e)
            false
        }
    }

    /**
     * Whether anything at all — file or directory — sits at [path]. Used to pick
     * a free name before a transfer rather than overwriting what is already there.
     */
    fun itemExists(space: Space, path: String): Boolean {
        val repoDir = getRepoPath(space.id!!)
        val resolved = try {
            validatePath(repoDir, path)
        } catch (_: IllegalArgumentException) {
            return false
        }
        return Files.exists(resolved)
    }

    /**
     * Copy a file or a whole directory from one space's working tree into
     * another's. Byte-level throughout — a `readString`/`writeString` round trip
     * would corrupt every image, PDF and archive in the tree.
     *
     * Both endpoints are validated against their own repository root, so neither
     * side of the transfer can be talked into escaping its space. [onFileCopied]
     * runs after each file, for a progress display.
     */
    fun copyItemAcrossSpaces(
        sourceSpace: Space,
        sourcePath: String,
        targetSpace: Space,
        targetPath: String,
        onFileCopied: () -> Unit = {}
    ): Boolean {
        ensureVersionedBeforeMutation(targetSpace)
        val from = validatePath(getRepoPath(sourceSpace.id!!), sourcePath)
        val to = validatePath(getRepoPath(targetSpace.id!!), targetPath)

        return try {
            if (!Files.exists(from)) return false
            Files.createDirectories(to.parent)
            if (Files.isDirectory(from)) {
                Files.walk(from).use { stream ->
                    stream.forEach { entry ->
                        val destination = to.resolve(from.relativize(entry).toString())
                        if (Files.isDirectory(entry)) {
                            Files.createDirectories(destination)
                        } else {
                            Files.createDirectories(destination.parent)
                            Files.copy(entry, destination, StandardCopyOption.REPLACE_EXISTING)
                            onFileCopied()
                        }
                    }
                }
            } else {
                Files.copy(from, to, StandardCopyOption.REPLACE_EXISTING)
                onFileCopied()
            }
            true
        } catch (e: Exception) {
            logger.error(
                "Failed to copy '$sourcePath' from space '${sourceSpace.name}' " +
                    "to '$targetPath' in space '${targetSpace.name}': ${e.message}", e
            )
            false
        }
    }

    /**
     * Remove a file or directory from a space's working tree. The counterpart to
     * {@link copyItemAcrossSpaces} for a move, run only once the copy succeeded
     * so a failure part-way leaves the original in place rather than nothing.
     */
    fun removeItem(space: Space, path: String): Boolean {
        ensureVersionedBeforeMutation(space)
        val resolved = validatePath(getRepoPath(space.id!!), path)
        return try {
            if (!Files.exists(resolved)) return false
            if (Files.isDirectory(resolved)) {
                Files.walk(resolved).use { stream ->
                    stream.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
                }
            } else {
                Files.deleteIfExists(resolved)
            }
            true
        } catch (e: Exception) {
            logger.error("Failed to remove '$path' from space '${space.name}': ${e.message}", e)
            false
        }
    }

    /** Every regular file under [path], as space-relative paths. */
    fun listFilesUnder(space: Space, path: String): List<String> {
        val repoDir = getRepoPath(space.id!!)
        val resolved = try {
            validatePath(repoDir, path)
        } catch (_: IllegalArgumentException) {
            return emptyList()
        }
        if (!Files.exists(resolved)) return emptyList()
        if (Files.isRegularFile(resolved)) return listOf(path)
        return try {
            Files.walk(resolved).use { stream ->
                stream.filter { Files.isRegularFile(it) }
                    .map { repoDir.relativize(it).joinToString("/") }
                    .filter { !it.startsWith(".git/") }
                    .sorted()
                    .toList()
            }
        } catch (e: Exception) {
            logger.error("Failed to list files under '$path' in space '${space.name}': ${e.message}", e)
            emptyList()
        }
    }

    fun getUncommittedFiles(spaceId: UUID): List<String> {
        val repoDir = getRepoPath(spaceId).toFile()
        if (!repoDir.exists()) return emptyList()

        return try {
            Git.open(repoDir).use { git ->
                val status = git.status().call()
                val files = mutableListOf<String>()
                files.addAll(status.untracked)
                files.addAll(status.modified)
                files.addAll(status.added)
                files.addAll(status.changed)
                files.addAll(status.removed)
                files.addAll(status.missing)
                files.sorted()
            }
        } catch (e: Exception) {
            logger.error("Failed to get git status for space $spaceId: ${e.message}", e)
            emptyList()
        }
    }

    fun isDirectory(space: Space, path: String): Boolean {
        val repoDir = getRepoPath(space.id!!)
        val filePath = validatePath(repoDir, path)
        return Files.isDirectory(filePath)
    }

    /**
     * Whether the space's working tree still holds a regular file at [path].
     * A path that escapes the repository counts as absent rather than throwing,
     * so callers reconciling stored paths against disk can't be derailed by one
     * bad row.
     */
    fun regularFileExists(space: Space, path: String): Boolean {
        val repoDir = getRepoPath(space.id!!)
        val filePath = try {
            validatePath(repoDir, path)
        } catch (_: IllegalArgumentException) {
            return false
        }
        return Files.isRegularFile(filePath)
    }

    fun deleteRepository(spaceId: UUID): Boolean {
        val repoDir = getRepoPath(spaceId).toFile()
        return try {
            if (repoDir.exists()) {
                repoDir.deleteRecursively()
            }
            logger.info("Deleted repository for space $spaceId")
            true
        } catch (e: Exception) {
            logger.error("Failed to delete repository for space $spaceId: ${e.message}", e)
            false
        }
    }

    /**
     * Validates that Git is properly configured for the space.
     */
    private fun validateConfiguration(space: Space) {
        if (settingsService.getGitlabToken().isBlank()) {
            throw GitOperationException(
                GitErrorCode.NOT_CONFIGURED,
                "GitLab token is not configured. Please set up your GitLab connection in Admin Settings."
            )
        }

        if (space.gitlabUrl.isNullOrBlank()) {
            throw GitOperationException(
                GitErrorCode.INVALID_URL,
                "No Git repository URL configured for this workspace."
            )
        }
    }

    /**
     * Maps common exceptions to GitOperationException with appropriate error codes.
     */
    private fun mapException(e: Exception, defaultCode: GitErrorCode, operation: String): GitOperationException {
        val message = e.message ?: "Unknown error"

        // Check for specific exception types
        return when {
            e is TransportException -> {
                when {
                    message.contains("not authorized", ignoreCase = true) ||
                    message.contains("authentication", ignoreCase = true) ||
                    message.contains("401", ignoreCase = true) ||
                    message.contains("403", ignoreCase = true) ->
                        GitOperationException(GitErrorCode.AUTH_FAILED, "Authentication failed. Please verify your GitLab token.", e)

                    message.contains("not found", ignoreCase = true) ||
                    message.contains("404", ignoreCase = true) ->
                        GitOperationException(GitErrorCode.REPO_NOT_FOUND, "Repository not found. Please verify the URL and your access.", e)

                    message.contains("timeout", ignoreCase = true) ->
                        GitOperationException(GitErrorCode.CONNECTION_TIMEOUT, "Connection timed out. Please try again.", e)

                    else ->
                        GitOperationException(GitErrorCode.NETWORK_ERROR, "Network error while trying to $operation: $message", e)
                }
            }

            e.cause is UnknownHostException || message.contains("unknown host", ignoreCase = true) ->
                GitOperationException(GitErrorCode.HOST_UNREACHABLE, "Cannot reach GitLab server. Please verify the GitLab URL.", e)

            message.contains("no space", ignoreCase = true) || message.contains("disk full", ignoreCase = true) ->
                GitOperationException(GitErrorCode.DISK_FULL, "Disk space is full. Please free up some space.", e)

            message.contains("conflict", ignoreCase = true) ->
                GitOperationException(GitErrorCode.MERGE_CONFLICT, "Merge conflict detected. Manual resolution may be required.", e)

            message.contains("permission denied", ignoreCase = true) ->
                GitOperationException(GitErrorCode.PERMISSION_DENIED, "Permission denied. You don't have access to this repository.", e)

            else ->
                GitOperationException(defaultCode, "Failed to $operation: $message", e)
        }
    }
}

data class FileNode(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val children: List<FileNode>? = null
)

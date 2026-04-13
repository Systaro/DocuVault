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
import java.util.*

@Service
class GitService(
    @Value("\${git.repos-path}") private val reposPath: String,
    private val settingsService: SettingsService
) {
    private val logger = LoggerFactory.getLogger(GitService::class.java)

    private fun getCredentialsProvider(): UsernamePasswordCredentialsProvider {
        return UsernamePasswordCredentialsProvider("oauth2", settingsService.getGitlabToken())
    }

    fun getRepoPath(spaceId: UUID): Path = Path.of(reposPath, spaceId.toString())

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
                    if (!snapshotDirtyWorkingTree(git, space)) {
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
    private fun snapshotDirtyWorkingTree(git: Git, space: Space): Boolean {
        val status = git.status().call()
        if (status.isClean) return false

        // Stage everything: new files + modifications, then deletions.
        git.add().addFilepattern(".").call()
        git.add().addFilepattern(".").setUpdate(true).call()

        git.commit()
            .setMessage("DocuVault: snapshot local changes before conflict resolution in '${space.name}'")
            .setAuthor("docuvault-bot", "bot@docuvault.systaro.de")
            .call()
        return true
    }

    /**
     * Commits and pushes changes to the remote repository.
     * @throws GitOperationException with specific error codes on failure
     */
    fun commitAndPush(space: Space, message: String, authorName: String, authorEmail: String) {
        validateConfiguration(space)

        val repoDir = getRepoPath(space.id!!).toFile()

        if (!repoDir.exists()) {
            throw GitOperationException(
                GitErrorCode.REPO_NOT_FOUND,
                "Repository not found. Please sync from Git first."
            )
        }

        logger.info("Committing and pushing changes for space '${space.name}' by $authorName")

        try {
            Git.open(repoDir).use { git ->
                git.add().addFilepattern(".").call()

                git.commit()
                    .setMessage(message)
                    .setAuthor(authorName, authorEmail)
                    .call()

                git.push()
                    .setCredentialsProvider(getCredentialsProvider())
                    .call()
            }
            logger.info("Successfully pushed changes for space '${space.name}'")
        } catch (e: Exception) {
            logger.error("Failed to push changes for space '${space.name}': ${e.message}", e)
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

    fun writeFile(space: Space, path: String, content: String): Boolean {
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

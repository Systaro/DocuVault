package com.docuvault.service.git

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SyncStatus
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.service.SettingsService
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.api.ResetCommand
import org.eclipse.jgit.transport.RefSpec
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.*

/**
 * Handles the "sync is in conflict" recovery flow: opens a GitLab MR from a
 * conflict branch based off the last successfully pulled ref, and restores
 * normal sync once the MR is merged.
 */
@Service
class GitConflictService(
    @Value("\${git.repos-path}") private val reposPath: String,
    private val settingsService: SettingsService,
    private val gitLabService: GitLabService,
    private val spaceRepository: SpaceRepository
) {
    private val logger = LoggerFactory.getLogger(GitConflictService::class.java)
    private val timestampFormatter = DateTimeFormatter
        .ofPattern("yyyyMMdd-HHmm")
        .withZone(ZoneOffset.UTC)

    private fun getRepoPath(spaceId: UUID): Path = Path.of(reposPath, spaceId.toString())

    private fun credentials(): UsernamePasswordCredentialsProvider =
        UsernamePasswordCredentialsProvider("oauth2", settingsService.getGitlabToken())

    /**
     * Creates a conflict-resolution branch off `space.conflictBaseRef`, pushes it,
     * and opens a GitLab MR against `space.branch`. Idempotent: if an MR already
     * exists for the current conflict, returns it unchanged.
     */
    fun createConflictMr(space: Space): ConflictMrResult {
        check(space.syncStatus == SyncStatus.IN_CONFLICT) {
            "Space '${space.name}' is not in conflict state (status=${space.syncStatus})"
        }
        space.conflictMrUrl?.let { existing ->
            return ConflictMrResult(existing, space.conflictBranch ?: "", alreadyExisted = true)
        }

        val baseRef = space.conflictBaseRef
            ?: throw IllegalStateException("Space '${space.name}' is IN_CONFLICT but has no baseRef recorded")
        val projectId = space.gitlabProjectId?.toLong()
            ?: throw IllegalStateException("Space '${space.name}' has no gitlabProjectId configured")

        val repoDir = getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) {
            throw IllegalStateException("Local repository clone missing for space ${space.id}")
        }

        val shortSha = baseRef.take(7)
        val timestamp = timestampFormatter.format(Instant.now())
        val branchName = "docuvault/conflict-$timestamp-$shortSha"

        Git.open(repoDir).use { git ->
            git.branchCreate()
                .setName(branchName)
                .setStartPoint(baseRef)
                .setForce(true)
                .call()

            val refSpec = RefSpec("refs/heads/$branchName:refs/heads/$branchName")
            git.push()
                .setRemote("origin")
                .setRefSpecs(refSpec)
                .setCredentialsProvider(credentials())
                .call()
        }

        val title = "DocuVault: resolve sync conflict in ${space.name}"
        val body = buildString {
            appendLine("Automated conflict-resolution MR opened by DocuVault.")
            appendLine()
            appendLine("- Space: `${space.name}` (`${space.id}`)")
            appendLine("- Target branch: `${space.branch}`")
            appendLine("- Base commit: `$baseRef`")
            space.conflictDetectedAt?.let { appendLine("- Conflict detected at: $it") }
            appendLine()
            appendLine("DocuVault's local changes diverged from `${space.branch}` and could not be merged automatically. Review the diff, resolve any conflicts, and merge to let DocuVault resume syncing this space.")
        }

        val mr = gitLabService.createMergeRequest(projectId, branchName, space.branch, title, body)
            ?: throw IllegalStateException("Failed to open merge request on GitLab for space '${space.name}'")

        space.conflictBranch = branchName
        space.conflictMrUrl = mr.webUrl
        space.conflictMrIid = mr.iid
        space.conflictMrProjectId = projectId
        space.updatedAt = Instant.now()
        spaceRepository.save(space)

        logger.info("Opened conflict MR ${mr.webUrl} for space '${space.name}'")
        return ConflictMrResult(mr.webUrl, branchName, alreadyExisted = false)
    }

    /**
     * Polls the tracked conflict MR for a space and, if merged, restores the
     * local clone to the new target-branch HEAD and clears the IN_CONFLICT state.
     * If the MR was closed without merging, clears the MR pointer so the user
     * can open a fresh one.
     */
    fun checkConflictMrStatus(space: Space) {
        val iid = space.conflictMrIid ?: return
        val projectId = space.conflictMrProjectId ?: return
        val mr = gitLabService.getMergeRequest(projectId, iid) ?: return

        when (mr.state) {
            "merged" -> recoverAfterMerge(space)
            "closed" -> {
                logger.info("Conflict MR !$iid for space '${space.name}' was closed without merging")
                space.lastSyncError = "Conflict MR was closed without merging"
                space.conflictMrUrl = null
                space.conflictMrIid = null
                space.conflictMrProjectId = null
                space.conflictBranch = null
                space.updatedAt = Instant.now()
                spaceRepository.save(space)
            }
            else -> Unit
        }
    }

    private fun recoverAfterMerge(space: Space) {
        val repoDir = getRepoPath(space.id!!).toFile()
        if (!repoDir.exists()) {
            logger.warn("Cannot recover after merge for space '${space.name}': local repo missing")
            return
        }

        try {
            Git.open(repoDir).use { git ->
                git.fetch()
                    .setRemote("origin")
                    .setCredentialsProvider(credentials())
                    .call()

                val remoteRef = git.repository.resolve("origin/${space.branch}")
                    ?: throw IllegalStateException("origin/${space.branch} not resolvable after fetch")

                git.reset()
                    .setMode(ResetCommand.ResetType.HARD)
                    .setRef(remoteRef.name)
                    .call()
            }
        } catch (e: Exception) {
            logger.error("Failed to recover after merge for space '${space.name}': ${e.message}", e)
            return
        }

        space.syncStatus = SyncStatus.OK
        space.conflictBaseRef = null
        space.conflictBranch = null
        space.conflictMrUrl = null
        space.conflictMrIid = null
        space.conflictMrProjectId = null
        space.conflictDetectedAt = null
        space.lastSyncError = null
        space.lastSyncedAt = Instant.now()
        space.updatedAt = Instant.now()
        spaceRepository.save(space)

        logger.info("Space '${space.name}' recovered from conflict; sync resumed")
    }
}

data class ConflictMrResult(
    val mrUrl: String,
    val branch: String,
    val alreadyExisted: Boolean
)

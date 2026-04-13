package com.docuvault.api.git

import com.docuvault.domain.space.SyncStatus
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.SyncScheduler
import com.docuvault.service.git.*
import java.time.Instant
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/git")
class GitController(
    private val gitLabService: GitLabService,
    private val gitService: GitService,
    private val gitConflictService: GitConflictService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val syncScheduler: SyncScheduler
) {
    private val logger = LoggerFactory.getLogger(GitController::class.java)

    @GetMapping("/status")
    fun getStatus(): ResponseEntity<GitStatusResponse> {
        return ResponseEntity.ok(
            GitStatusResponse(
                configured = gitLabService.isConfigured(),
                connected = gitLabService.testConnection()
            )
        )
    }

    @GetMapping("/projects")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun listProjects(): ResponseEntity<List<GitLabProject>> {
        val projects = gitLabService.listProjects()
        return ResponseEntity.ok(projects)
    }

    @GetMapping("/projects/{projectId}")
    fun getProject(@PathVariable projectId: Int): ResponseEntity<GitLabProject> {
        val project = gitLabService.getProject(projectId)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(project)
    }

    @GetMapping("/projects/{projectId}/branches")
    fun getProjectBranches(@PathVariable projectId: Int): ResponseEntity<List<String>> {
        val branches = gitLabService.getProjectBranches(projectId)
        return ResponseEntity.ok(branches)
    }

    @PostMapping("/spaces/{spaceId}/pull")
    fun pullChanges(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<GitOperationResponse> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        // Check space access (with hierarchy inheritance)
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (space.syncStatus == SyncStatus.IN_CONFLICT) {
            // Poll the tracked MR first — if it's been merged, this clears the conflict
            // state so the regular pull below can proceed. Otherwise, return early with
            // the current MR link so the UI can keep showing the banner.
            try {
                gitConflictService.checkConflictMrStatus(space)
            } catch (e: Exception) {
                logger.warn("Failed to poll conflict MR for space '${space.name}': ${e.message}")
            }
            if (space.syncStatus == SyncStatus.IN_CONFLICT) {
                return ResponseEntity.ok(
                    GitOperationResponse(
                        success = false,
                        message = "Space is in conflict; resolve the open merge request before pulling again.",
                        errorCode = GitErrorCode.MERGE_CONFLICT.name,
                        userMessage = GitErrorCode.MERGE_CONFLICT.toUserMessage(),
                        requiresSetup = false,
                        conflictMrUrl = space.conflictMrUrl
                    )
                )
            }
            // State was cleared by checkConflictMrStatus — fall through to the normal pull path.
        }

        return try {
            gitService.pullChanges(space)
            val filesChanged = syncScheduler.indexDocuments(space)

            // Update last synced timestamp and clear error
            space.lastSyncedAt = Instant.now()
            space.lastSyncError = null
            space.lastSyncFilesChanged = filesChanged
            space.syncStatus = SyncStatus.OK
            spaceRepository.save(space)

            logger.info("Successfully pulled changes for space '${space.name}' (${space.id})")
            ResponseEntity.ok(
                GitOperationResponse(
                    success = true,
                    message = "Successfully synced from Git"
                )
            )
        } catch (e: MergeConflictException) {
            logger.warn("Merge conflict detected for space '${space.name}'")
            space.syncStatus = SyncStatus.IN_CONFLICT
            space.conflictBaseRef = e.baseRef
            space.conflictDetectedAt = Instant.now()
            space.lastSyncError = e.message
            spaceRepository.save(space)
            ResponseEntity.ok(
                GitOperationResponse(
                    success = false,
                    message = e.message,
                    errorCode = e.errorCode.name,
                    userMessage = e.errorCode.toUserMessage(),
                    requiresSetup = false,
                    conflictMrUrl = null
                )
            )
        } catch (e: GitOperationException) {
            logger.warn("Git pull failed for space '${space.name}': ${e.message}")
            space.lastSyncError = e.message ?: "Sync failed"
            space.syncStatus = SyncStatus.SYNC_ERROR
            spaceRepository.save(space)
            ResponseEntity.ok(
                GitOperationResponse(
                    success = false,
                    message = e.message,
                    errorCode = e.errorCode.name,
                    userMessage = e.errorCode.toUserMessage(),
                    requiresSetup = e.errorCode.requiresSetup()
                )
            )
        } catch (e: Exception) {
            logger.error("Unexpected error during pull for space '${space.name}': ${e.message}", e)
            space.lastSyncError = e.message?.take(500) ?: "Unexpected sync error"
            spaceRepository.save(space)
            ResponseEntity.ok(
                GitOperationResponse(
                    success = false,
                    message = "An unexpected error occurred",
                    errorCode = GitErrorCode.UNKNOWN_ERROR.name,
                    userMessage = GitErrorCode.UNKNOWN_ERROR.toUserMessage(),
                    requiresSetup = false
                )
            )
        }
    }

    @GetMapping("/spaces/{spaceId}/uncommitted")
    fun getUncommittedFiles(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<UncommittedFilesResponse> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        val files = gitService.getUncommittedFiles(spaceId)
        return ResponseEntity.ok(UncommittedFilesResponse(
            files = files,
            lastPushError = space.lastPushError
        ))
    }

    @PostMapping("/spaces/{spaceId}/push")
    fun pushChanges(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestBody request: PushRequest
    ): ResponseEntity<GitOperationResponse> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        // Check space edit permissions (with hierarchy inheritance)
        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return try {
            gitService.commitAndPush(
                space = space,
                message = request.message,
                authorName = user.name,
                authorEmail = user.email
            )

            // Clear push error on success
            if (space.lastPushError != null) {
                space.lastPushError = null
                spaceRepository.save(space)
            }

            logger.info("Successfully pushed changes for space '${space.name}' (${space.id})")
            ResponseEntity.ok(
                GitOperationResponse(
                    success = true,
                    message = "Successfully pushed to Git"
                )
            )
        } catch (e: GitOperationException) {
            logger.warn("Git push failed for space '${space.name}': ${e.message}")
            space.lastPushError = e.errorCode.toUserMessage()
            spaceRepository.save(space)
            ResponseEntity.ok(
                GitOperationResponse(
                    success = false,
                    message = e.message,
                    errorCode = e.errorCode.name,
                    userMessage = e.errorCode.toUserMessage(),
                    requiresSetup = e.errorCode.requiresSetup()
                )
            )
        } catch (e: Exception) {
            logger.error("Unexpected error during push for space '${space.name}': ${e.message}", e)
            space.lastPushError = e.message?.take(1000) ?: "Unexpected error"
            spaceRepository.save(space)
            ResponseEntity.ok(
                GitOperationResponse(
                    success = false,
                    message = "An unexpected error occurred",
                    errorCode = GitErrorCode.UNKNOWN_ERROR.name,
                    userMessage = GitErrorCode.UNKNOWN_ERROR.toUserMessage(),
                    requiresSetup = false
                )
            )
        }
    }

    @PostMapping("/spaces/{spaceId}/conflict/create-mr")
    fun createConflictMr(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        if (space.syncStatus != SyncStatus.IN_CONFLICT) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(
                GitOperationResponse(
                    success = false,
                    message = "Space is not in a conflict state",
                    errorCode = "NOT_IN_CONFLICT"
                )
            )
        }

        return try {
            val result = gitConflictService.createConflictMr(space)
            ResponseEntity.ok(ConflictMrResponse(result.mrUrl, result.branch, result.alreadyExisted))
        } catch (e: Exception) {
            logger.error("Failed to open conflict MR for space '${space.name}': ${e.message}", e)
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                GitOperationResponse(
                    success = false,
                    message = e.message ?: "Failed to open merge request",
                    errorCode = GitErrorCode.UNKNOWN_ERROR.name,
                    userMessage = "Could not open the conflict merge request. Check the backend logs."
                )
            )
        }
    }
}

data class GitStatusResponse(
    val configured: Boolean,
    val connected: Boolean
)

data class GitOperationResponse(
    val success: Boolean,
    val message: String? = null,
    val errorCode: String? = null,
    val userMessage: String? = null,
    val requiresSetup: Boolean = false,
    val conflictMrUrl: String? = null
)

data class ConflictMrResponse(
    val mrUrl: String,
    val branch: String,
    val alreadyExisted: Boolean
)

data class PushRequest(
    val message: String,
    val authorName: String,
    val authorEmail: String
)

data class UncommittedFilesResponse(
    val files: List<String>,
    val lastPushError: String? = null
)

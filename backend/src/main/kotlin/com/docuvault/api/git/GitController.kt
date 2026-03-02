package com.docuvault.api.git

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.SyncScheduler
import com.docuvault.service.git.*
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

        return try {
            gitService.pullChanges(space)
            val filesChanged = syncScheduler.indexDocuments(space)

            // Update last synced timestamp and clear error
            space.lastSyncedAt = java.time.Instant.now()
            space.lastSyncError = null
            space.lastSyncFilesChanged = filesChanged
            spaceRepository.save(space)

            logger.info("Successfully pulled changes for space '${space.name}' (${space.id})")
            ResponseEntity.ok(
                GitOperationResponse(
                    success = true,
                    message = "Successfully synced from Git"
                )
            )
        } catch (e: GitOperationException) {
            logger.warn("Git pull failed for space '${space.name}': ${e.message}")
            space.lastSyncError = e.message ?: "Sync failed"
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

            logger.info("Successfully pushed changes for space '${space.name}' (${space.id})")
            ResponseEntity.ok(
                GitOperationResponse(
                    success = true,
                    message = "Successfully pushed to Git"
                )
            )
        } catch (e: GitOperationException) {
            logger.warn("Git push failed for space '${space.name}': ${e.message}")
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
    val requiresSetup: Boolean = false
)

data class PushRequest(
    val message: String,
    val authorName: String,
    val authorEmail: String
)

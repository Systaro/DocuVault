package com.docuvault.api.spaces

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpacePermission
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.git.GitLabService
import com.docuvault.service.git.GitOperationException
import com.docuvault.service.git.GitService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces")
class SpaceController(
    private val spaceRepository: SpaceRepository,
    private val spacePermissionRepository: SpacePermissionRepository,
    private val userRepository: UserRepository,
    private val documentRepository: DocumentRepository,
    private val gitLabService: GitLabService,
    private val gitService: GitService,
    private val s3Client: S3Client,
    @Value("\${minio.bucket}") private val logoBucket: String
) {
    private val logger = org.slf4j.LoggerFactory.getLogger(SpaceController::class.java)
    @GetMapping
    fun listSpaces(@AuthenticationPrincipal userDetails: UserDetails): ResponseEntity<List<SpaceDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val spaces = if (user.role == UserRole.SUPER_ADMIN) {
            spaceRepository.findAll()
        } else {
            spaceRepository.findAllByUserId(user.id!!)
        }

        return ResponseEntity.ok(spaces.map { it.toDto(documentCount = documentRepository.countBySpaceId(it.id!!)) })
    }

    @GetMapping("/{id}")
    fun getSpace(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(space.toDto(documentCount = documentRepository.countBySpaceId(space.id!!)))
    }

    @GetMapping("/slug/{slug}")
    fun getSpaceBySlug(
        @PathVariable slug: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findBySlug(slug)
            ?: return ResponseEntity.notFound().build()

        if (!hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(space.toDto(documentCount = documentRepository.countBySpaceId(space.id!!)))
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun createSpace(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: CreateSpaceRequest
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (spaceRepository.existsBySlug(request.slug)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build()
        }

        val gitlabProject = request.gitlabProjectId?.let { gitLabService.getProject(it) }

        val space = Space(
            name = request.name,
            slug = request.slug,
            description = request.description,
            gitlabProjectId = request.gitlabProjectId,
            gitlabUrl = gitlabProject?.httpUrlToRepo ?: request.gitlabUrl,
            branch = request.branch ?: gitlabProject?.defaultBranch ?: "main",
            syncEnabled = request.syncEnabled ?: true,
            createdBy = user
        )

        val savedSpace = spaceRepository.save(space)

        // Grant admin permission to creator
        val permission = SpacePermission(
            user = user,
            space = savedSpace,
            permissionLevel = PermissionLevel.ADMIN
        )
        spacePermissionRepository.save(permission)

        // Clone the repository if GitLab URL is provided
        if (savedSpace.gitlabUrl != null) {
            try {
                gitService.cloneRepository(savedSpace)
                logger.info("Successfully cloned repository for new space '${savedSpace.name}'")
            } catch (e: GitOperationException) {
                logger.warn("Failed to clone repository for space '${savedSpace.name}': ${e.message}")
                savedSpace.lastSyncError = e.message ?: "Failed to clone repository"
                spaceRepository.save(savedSpace)
            } catch (e: Exception) {
                logger.error("Unexpected error cloning repository for space '${savedSpace.name}': ${e.message}", e)
                savedSpace.lastSyncError = "Failed to clone repository"
                spaceRepository.save(savedSpace)
            }
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(savedSpace.toDto())
    }

    @PutMapping("/{id}")
    fun updateSpace(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: UpdateSpaceRequest
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        request.name?.let { space.name = it }
        request.description?.let { space.description = it }
        request.branch?.let { space.branch = it }
        request.syncEnabled?.let { space.syncEnabled = it }
        request.syncIntervalMinutes?.let { space.syncIntervalMinutes = it }
        space.updatedAt = Instant.now()

        val updated = spaceRepository.save(space)
        return ResponseEntity.ok(updated.toDto())
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun deleteSpace(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Delete local repository
        gitService.deleteRepository(space.id!!)

        spaceRepository.delete(space)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{id}/permissions")
    fun getSpacePermissions(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SpacePermissionDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!spaceRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        if (!hasEditAccess(user.id!!, id, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val permissions = spacePermissionRepository.findAllBySpaceId(id)
        return ResponseEntity.ok(permissions.map { it.toDto() })
    }

    @PostMapping("/{id}/permissions")
    fun addSpacePermission(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: AddPermissionRequest
    ): ResponseEntity<SpacePermissionDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val targetUser = userRepository.findById(request.userId).orElse(null)
            ?: return ResponseEntity.badRequest().build()

        val existingPermission = spacePermissionRepository.findByUserIdAndSpaceId(request.userId, id)
        if (existingPermission != null) {
            existingPermission.permissionLevel = PermissionLevel.valueOf(request.permissionLevel)
            val updated = spacePermissionRepository.save(existingPermission)
            return ResponseEntity.ok(updated.toDto())
        }

        val permission = SpacePermission(
            user = targetUser,
            space = space,
            permissionLevel = PermissionLevel.valueOf(request.permissionLevel)
        )

        val saved = spacePermissionRepository.save(permission)
        return ResponseEntity.status(HttpStatus.CREATED).body(saved.toDto())
    }

    @DeleteMapping("/{id}/permissions/{userId}")
    fun removeSpacePermission(
        @PathVariable id: UUID,
        @PathVariable userId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!spaceRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        if (!hasEditAccess(user.id!!, id, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        spacePermissionRepository.deleteByUserIdAndSpaceId(userId, id)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/{id}/logo", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun uploadLogo(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam("file") file: MultipartFile
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val allowedTypes = setOf("image/png", "image/jpeg", "image/svg+xml", "image/webp")
        if (file.contentType !in allowedTypes) {
            return ResponseEntity.badRequest().build()
        }
        if (file.size > 2 * 1024 * 1024) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build()
        }

        val ext = when (file.contentType) {
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            "image/svg+xml" -> "svg"
            "image/webp" -> "webp"
            else -> "png"
        }
        val key = "${space.id}.$ext"

        // Delete old logo if it exists with different extension
        space.logoUrl?.let { oldUrl ->
            val oldKey = oldUrl.substringAfterLast("/")
            if (oldKey != key) {
                try { s3Client.deleteObject(DeleteObjectRequest.builder().bucket(logoBucket).key(oldKey).build()) } catch (_: Exception) {}
            }
        }

        s3Client.putObject(
            PutObjectRequest.builder()
                .bucket(logoBucket)
                .key(key)
                .contentType(file.contentType)
                .build(),
            software.amazon.awssdk.core.sync.RequestBody.fromBytes(file.bytes)
        )

        space.logoUrl = "/api/spaces/${space.id}/logo"
        space.updatedAt = Instant.now()
        val updated = spaceRepository.save(space)
        return ResponseEntity.ok(updated.toDto(documentCount = documentRepository.countBySpaceId(space.id!!)))
    }

    @GetMapping("/{id}/logo")
    fun getLogo(@PathVariable id: UUID): ResponseEntity<ByteArray> {
        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (space.logoUrl == null) {
            return ResponseEntity.notFound().build()
        }

        // Find the logo object by trying known extensions
        for (ext in listOf("png", "jpg", "svg", "webp")) {
            val key = "${space.id}.$ext"
            try {
                val response = s3Client.getObject(GetObjectRequest.builder().bucket(logoBucket).key(key).build())
                val bytes = response.readAllBytes()
                val contentType = when (ext) {
                    "png" -> MediaType.IMAGE_PNG
                    "jpg" -> MediaType.IMAGE_JPEG
                    "svg" -> MediaType.valueOf("image/svg+xml")
                    "webp" -> MediaType.valueOf("image/webp")
                    else -> MediaType.APPLICATION_OCTET_STREAM
                }
                return ResponseEntity.ok().contentType(contentType).body(bytes)
            } catch (_: Exception) {
                continue
            }
        }
        return ResponseEntity.notFound().build()
    }

    @DeleteMapping("/{id}/logo")
    fun deleteLogo(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Delete all possible logo files
        for (ext in listOf("png", "jpg", "svg", "webp")) {
            try { s3Client.deleteObject(DeleteObjectRequest.builder().bucket(logoBucket).key("${space.id}.$ext").build()) } catch (_: Exception) {}
        }

        space.logoUrl = null
        space.updatedAt = Instant.now()
        val updated = spaceRepository.save(space)
        return ResponseEntity.ok(updated.toDto(documentCount = documentRepository.countBySpaceId(space.id!!)))
    }

    private fun hasAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return spacePermissionRepository.findByUserIdAndSpaceId(userId, spaceId) != null
    }

    private fun hasEditAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return spacePermissionRepository.existsByUserIdAndSpaceIdAndPermissionLevelIn(
            userId,
            spaceId,
            listOf(PermissionLevel.EDIT, PermissionLevel.ADMIN)
        )
    }
}

data class CreateSpaceRequest(
    @field:NotBlank(message = "Name is required")
    val name: String,

    @field:NotBlank(message = "Slug is required")
    val slug: String,

    val description: String? = null,
    val gitlabProjectId: Int? = null,
    val gitlabUrl: String? = null,
    val branch: String? = null,
    val syncEnabled: Boolean? = true
)

data class UpdateSpaceRequest(
    val name: String? = null,
    val description: String? = null,
    val branch: String? = null,
    val syncEnabled: Boolean? = null,
    val syncIntervalMinutes: Int? = null
)

data class AddPermissionRequest(
    val userId: UUID,
    val permissionLevel: String
)

data class SpaceDto(
    val id: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val gitlabProjectId: Int?,
    val gitlabUrl: String?,
    val branch: String,
    val syncEnabled: Boolean,
    val syncIntervalMinutes: Int,
    val lastSyncedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val gitError: String? = null,
    val documentCount: Long = 0,
    val logoUrl: String? = null
)

data class SpacePermissionDto(
    val id: UUID,
    val userId: UUID,
    val userName: String,
    val userEmail: String,
    val permissionLevel: String
)

fun Space.toDto(gitError: String? = null, documentCount: Long = 0) = SpaceDto(
    id = this.id!!,
    name = this.name,
    slug = this.slug,
    description = this.description,
    gitlabProjectId = this.gitlabProjectId,
    gitlabUrl = this.gitlabUrl,
    branch = this.branch,
    syncEnabled = this.syncEnabled,
    syncIntervalMinutes = this.syncIntervalMinutes,
    lastSyncedAt = this.lastSyncedAt,
    createdAt = this.createdAt,
    updatedAt = this.updatedAt,
    gitError = gitError ?: this.lastSyncError,
    documentCount = documentCount,
    logoUrl = this.logoUrl
)

fun SpacePermission.toDto() = SpacePermissionDto(
    id = this.id!!,
    userId = this.user.id!!,
    userName = this.user.name,
    userEmail = this.user.email,
    permissionLevel = this.permissionLevel.name
)

package com.docuvault.api.annotations

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.AnnotationService
import com.docuvault.service.PermissionService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/spaces/{spaceId}/annotations")
class AnnotationController(
    private val annotationService: AnnotationService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {

    @GetMapping("/counts")
    fun getAnnotationCounts(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, Any>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val perFile = annotationService.getUnresolvedCounts(spaceId)
        val total = perFile.values.sum()
        return ResponseEntity.ok(
            mapOf(
                "total" to total,
                "perFile" to perFile,
                "unanchored" to annotationService.getUnanchoredCount(spaceId)
            )
        )
    }

    @GetMapping
    fun getAnnotations(
        @PathVariable spaceId: UUID,
        @RequestParam filePath: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<AnnotationDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val annotations = annotationService.getAnnotations(spaceId, filePath)
        return ResponseEntity.ok(annotations)
    }

    @PostMapping
    fun createAnnotation(
        @PathVariable spaceId: UUID,
        @RequestParam filePath: String,
        @Valid @RequestBody request: CreateAnnotationRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<AnnotationDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        val parent = request.parentId?.let { parentId ->
            annotationService.findById(parentId)
                ?: return ResponseEntity.badRequest().build()
        }

        val annotation = annotationService.createAnnotation(
            space = space,
            filePath = filePath,
            user = user,
            authorName = user.name,
            body = request.body,
            anchor = if (parent == null) request.anchor else null,
            parent = parent,
            docHash = if (parent == null) request.docHash else null
        )

        return ResponseEntity.status(HttpStatus.CREATED).body(annotation.toDto())
    }

    /**
     * Record where this comment currently lands in the document.
     *
     * Resolution happens in the browser, against the rendered text, so the
     * result has to travel back here to be cached — otherwise every reader
     * re-runs the same matching, and the space's unanchored count never
     * reflects reality. It is a cache write rather than content, so read access
     * is enough: a viewer who can see the document can refresh where its
     * comments sit.
     */
    @PatchMapping("/{annotationId}/anchor")
    fun updateAnchor(
        @PathVariable spaceId: UUID,
        @PathVariable annotationId: UUID,
        @Valid @RequestBody request: UpdateAnchorRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<AnnotationDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()
        if (annotation.space.id != spaceId) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val updated = annotationService.updateAnchor(
            annotationId, request.anchorCurrent, request.anchorState, request.docHash
        ) ?: return ResponseEntity.badRequest().build()

        return ResponseEntity.ok(updated.toDto())
    }

    @PatchMapping("/{annotationId}")
    fun updateAnnotation(
        @PathVariable spaceId: UUID,
        @PathVariable annotationId: UUID,
        @Valid @RequestBody request: UpdateAnnotationRequest,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<AnnotationDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()

        if (annotation.space.id != spaceId) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val isOwner = annotation.user?.id == user.id
        if (!isOwner && !permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val updated = annotationService.updateAnnotation(annotationId, request.body)
            ?: return ResponseEntity.notFound().build()

        return ResponseEntity.ok(updated.toDto())
    }

    @PatchMapping("/{annotationId}/resolve")
    fun toggleResolve(
        @PathVariable spaceId: UUID,
        @PathVariable annotationId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<AnnotationDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()

        if (annotation.space.id != spaceId) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val isOwner = annotation.user?.id == user.id
        if (!isOwner && !permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val updated = if (annotation.resolved) {
            annotationService.unresolveAnnotation(annotationId)
        } else {
            annotationService.resolveAnnotation(annotationId, user)
        } ?: return ResponseEntity.notFound().build()

        return ResponseEntity.ok(updated.toDto())
    }

    @DeleteMapping("/{annotationId}")
    fun deleteAnnotation(
        @PathVariable spaceId: UUID,
        @PathVariable annotationId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Void> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val annotation = annotationService.findById(annotationId)
            ?: return ResponseEntity.notFound().build()

        if (annotation.space.id != spaceId) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val isOwner = annotation.user?.id == user.id
        if (!isOwner && !permissionService.hasAdminAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        annotationService.deleteAnnotation(annotationId)
        return ResponseEntity.noContent().build()
    }
}

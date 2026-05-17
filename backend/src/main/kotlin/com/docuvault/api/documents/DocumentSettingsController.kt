package com.docuvault.api.documents

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentSettingsService
import com.docuvault.service.PermissionService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.*

/**
 * Per-document UI preferences (e.g. preferred content width).
 * VIEW access is enough to both read and write — these are low-impact,
 * easy-to-revert team preferences.
 */
@RestController
@RequestMapping("/spaces/{spaceId}/document-settings")
class DocumentSettingsController(
    private val service: DocumentSettingsService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService
) {
    @GetMapping
    fun getSettings(
        @PathVariable spaceId: UUID,
        @RequestParam filePath: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, Any>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        return ResponseEntity.ok(service.getSettings(spaceId, filePath))
    }

    @PutMapping
    fun updateSettings(
        @PathVariable spaceId: UUID,
        @RequestParam filePath: String,
        @RequestBody body: Map<String, Any>,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, Any>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        @Suppress("UNCHECKED_CAST")
        val settings = (body["settings"] as? Map<String, Any>) ?: emptyMap()
        val saved = service.upsertSettings(space, filePath, settings, user)
        return ResponseEntity.ok(saved)
    }
}

package com.docuvault.api.office

import com.docuvault.domain.space.Space
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.office.OfficeService
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import com.docuvault.service.requireSpaceWritable
import com.fasterxml.jackson.databind.JsonNode
import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.util.UUID

/**
 * Word documents in the office editor. The first two endpoints serve the
 * signed-in browser; `/office/file` and `/office/callback` serve the document
 * server, which has no session and proves itself with the signed links it was
 * handed and the shared secret.
 */
@RestController
class OfficeController(
    private val officeService: OfficeService,
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService
) {
    @GetMapping("/spaces/{spaceId}/office/config")
    fun editorConfig(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @RequestParam(required = false, defaultValue = "false") dark: Boolean,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, Any?>> {
        if (!officeService.enabled) return ResponseEntity.notFound().build()
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()
        if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        requireSpaceWritable(space)
        if (!OfficeService.isEditable(path)) return ResponseEntity.badRequest().build()

        val bytes = readFile(space, path) ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(officeService.editorConfig(space, path, bytes, user, dark))
    }

    /** Whether the file has an editing session open, and whether a requested save is still on its way. */
    @GetMapping("/spaces/{spaceId}/office/session")
    fun session(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<OfficeService.SessionState> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        return ResponseEntity.ok(officeService.sessionState(OfficeService.DocRef(spaceId, path)))
    }

    /** Saves the file from the open session now, as a commit; `saving` says whether one is coming. */
    @PostMapping("/spaces/{spaceId}/office/save")
    fun save(
        @PathVariable spaceId: UUID,
        @RequestParam path: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, Boolean>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasEditAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        return ResponseEntity.ok(mapOf("saving" to officeService.requestSave(OfficeService.DocRef(spaceId, path))))
    }

    @GetMapping("/office/file")
    fun file(@RequestParam t: String): ResponseEntity<ByteArray> {
        val ref = officeService.fileRef(t) ?: return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        val space = spaceRepository.findById(ref.spaceId).orElse(null) ?: return ResponseEntity.notFound().build()
        val bytes = readFile(space, ref.path) ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .cacheControl(CacheControl.noStore())
            .body(bytes)
    }

    /** Always answers 200: the document server reads success or failure from `error`. */
    @PostMapping("/office/callback")
    fun callback(
        @RequestParam t: String,
        @RequestBody body: JsonNode,
        @RequestHeader(HttpHeaders.AUTHORIZATION, required = false) authorization: String?
    ): Map<String, Int> = mapOf("error" to officeService.handleCallback(t, body, authorization))

    /** Null for a missing file and for a path that leaves the space. */
    private fun readFile(space: Space, path: String): ByteArray? = try {
        gitService.readBinaryFile(space, path)
    } catch (_: IllegalArgumentException) {
        null
    }
}

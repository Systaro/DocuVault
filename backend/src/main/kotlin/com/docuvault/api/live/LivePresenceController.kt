package com.docuvault.api.live

import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.live.LiveHub
import com.docuvault.service.PermissionService
import com.fasterxml.jackson.databind.JsonNode
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/**
 * Live presence of a space for clients without the socket: the assistant and MCP
 * clients ask it before they write, the way a person glances at the sidebar.
 */
@RestController
@RequestMapping("/spaces/{spaceId}/presence")
class LivePresenceController(
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val liveHub: LiveHub
) {
    @GetMapping
    fun presence(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<JsonNode> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        if (!permissionService.hasAccess(user.id!!, spaceId, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }
        return ResponseEntity.ok(liveHub.presence(spaceId))
    }
}

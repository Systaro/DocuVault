package com.docuvault.api.notifications

import com.docuvault.service.notification.NotificationRolloutService
import com.docuvault.service.notification.RolloutResult
import com.docuvault.service.notification.RolloutStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/notifications")
class NotificationAdminController(
    private val rolloutService: NotificationRolloutService
) {
    @GetMapping("/rollout/status")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun status(): ResponseEntity<RolloutStatus> = ResponseEntity.ok(rolloutService.status())

    /** Flip existing NONE users to DAILY and send the one-time announcement. Idempotent. */
    @PostMapping("/rollout")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    fun rollout(
        @RequestParam(name = "force", required = false, defaultValue = "false") force: Boolean
    ): ResponseEntity<RolloutResult> = ResponseEntity.ok(rolloutService.runOnce(force))
}

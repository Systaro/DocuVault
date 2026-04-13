package com.docuvault.service

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SyncStatus

/**
 * Thrown when a caller attempts to mutate a space that is currently in the
 * IN_CONFLICT sync state. Mapped to HTTP 409 by [com.docuvault.config.GlobalExceptionHandler].
 */
class SpaceInConflictException(
    val spaceId: String,
    val conflictMrUrl: String?
) : RuntimeException("Space is in conflict and cannot be modified until the resolution MR is merged")

/**
 * Throws [SpaceInConflictException] if the given space is in the IN_CONFLICT state.
 * Call at the top of any controller handler that mutates repository contents.
 */
fun requireSpaceWritable(space: Space) {
    if (space.syncStatus == SyncStatus.IN_CONFLICT) {
        throw SpaceInConflictException(
            spaceId = space.id?.toString() ?: "unknown",
            conflictMrUrl = space.conflictMrUrl
        )
    }
}

package com.docuvault.infrastructure.repository

import com.docuvault.domain.meeting.MeetingInvite
import org.springframework.data.jpa.repository.JpaRepository
import java.util.*

interface MeetingInviteRepository : JpaRepository<MeetingInvite, UUID> {
    fun findBySpaceIdOrderByCreatedAtDesc(spaceId: UUID): List<MeetingInvite>
    fun findByTokenHash(tokenHash: String): MeetingInvite?
}

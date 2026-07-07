package com.docuvault.infrastructure.repository

import com.docuvault.domain.inbox.InboxNote
import com.docuvault.domain.inbox.NoteStatus
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

interface SpaceNoteCount {
    val spaceId: UUID
    val count: Long
}

@Repository
interface InboxNoteRepository : JpaRepository<InboxNote, UUID> {
    fun findBySpaceIdAndStatusOrderByCreatedAtDesc(spaceId: UUID, status: NoteStatus): List<InboxNote>
    fun countBySpaceIdAndStatus(spaceId: UUID, status: NoteStatus): Long

    @Query(
        """
        SELECT n.space.id AS spaceId, COUNT(n) AS count
        FROM InboxNote n
        WHERE n.space.id IN :spaceIds AND n.status = com.docuvault.domain.inbox.NoteStatus.UNSORTED
        GROUP BY n.space.id
        """
    )
    fun countUnsortedBySpaceIds(spaceIds: List<UUID>): List<SpaceNoteCount>
}

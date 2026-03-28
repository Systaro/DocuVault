package com.docuvault.infrastructure.repository

import com.docuvault.domain.inbox.InboxNote
import com.docuvault.domain.inbox.NoteStatus
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface InboxNoteRepository : JpaRepository<InboxNote, UUID> {
    fun findBySpaceIdAndStatusOrderByCreatedAtDesc(spaceId: UUID, status: NoteStatus): List<InboxNote>
    fun countBySpaceIdAndStatus(spaceId: UUID, status: NoteStatus): Long
}

package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.NotificationChannel
import com.docuvault.domain.space.NotificationDispatch
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface NotificationDispatchRepository : JpaRepository<NotificationDispatch, UUID> {
    fun existsByEventIdAndUserIdAndChannel(eventId: UUID, userId: UUID, channel: NotificationChannel): Boolean
}

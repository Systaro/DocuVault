package com.docuvault.infrastructure.repository

import com.docuvault.domain.user.Invitation
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface InvitationRepository : JpaRepository<Invitation, UUID> {
    fun findByToken(token: String): Invitation?
    fun findByEmailAndAcceptedAtIsNull(email: String): List<Invitation>
    fun findByExpiresAtBeforeAndAcceptedAtIsNull(date: Instant): List<Invitation>
}

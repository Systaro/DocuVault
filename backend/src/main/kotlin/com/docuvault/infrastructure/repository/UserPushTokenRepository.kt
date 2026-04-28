package com.docuvault.infrastructure.repository

import com.docuvault.domain.user.UserPushToken
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface UserPushTokenRepository : JpaRepository<UserPushToken, UUID> {
    fun findByUserIdAndToken(userId: UUID, token: String): UserPushToken?
    fun findByUserIdOrderByLastSeenAtDesc(userId: UUID): List<UserPushToken>
    fun deleteByUserIdAndId(userId: UUID, id: UUID): Long
    fun deleteByToken(token: String): Long
}

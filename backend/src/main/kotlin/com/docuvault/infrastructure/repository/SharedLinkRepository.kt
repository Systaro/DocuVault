package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SharedLink
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface SharedLinkRepository : JpaRepository<SharedLink, UUID> {
    fun findByToken(token: String): SharedLink?
    fun findBySpaceIdAndFilePath(spaceId: UUID, filePath: String): List<SharedLink>
    fun findBySpaceId(spaceId: UUID): List<SharedLink>
}

package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SharedLinkAccessDenial
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface SharedLinkAccessDenialRepository : JpaRepository<SharedLinkAccessDenial, UUID> {
    fun findTop200ByTokenOrderByCreatedAtDesc(token: String): List<SharedLinkAccessDenial>
}

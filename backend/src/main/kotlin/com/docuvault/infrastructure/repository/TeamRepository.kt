package com.docuvault.infrastructure.repository

import com.docuvault.domain.team.Team
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface TeamRepository : JpaRepository<Team, UUID> {
    fun findBySlug(slug: String): Team?
    fun existsBySlug(slug: String): Boolean
}

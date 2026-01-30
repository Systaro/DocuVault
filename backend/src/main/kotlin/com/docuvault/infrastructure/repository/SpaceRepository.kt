package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Space
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface SpaceRepository : JpaRepository<Space, UUID> {
    fun findBySlug(slug: String): Space?
    fun existsBySlug(slug: String): Boolean

    @Query("SELECT s FROM Space s JOIN s.permissions p WHERE p.user.id = :userId")
    fun findAllByUserId(userId: UUID): List<Space>

    @Query("SELECT s FROM Space s WHERE s.syncEnabled = true")
    fun findAllWithSyncEnabled(): List<Space>
}

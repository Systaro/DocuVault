package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface SpaceRepository : JpaRepository<Space, UUID> {
    fun findBySlug(slug: String): Space?
    fun existsBySlug(slug: String): Boolean

    // Hierarchy queries
    fun findByParentId(parentId: UUID): List<Space>

    @Query("SELECT s FROM Space s WHERE s.parent IS NULL")
    fun findByParentIdIsNull(): List<Space>

    fun findBySlugAndParentId(slug: String, parentId: UUID?): Space?

    @Query("SELECT s FROM Space s WHERE s.slug = :slug AND s.parent IS NULL")
    fun findBySlugAndParentIsNull(slug: String): Space?

    @Query("SELECT COUNT(s) FROM Space s WHERE s.parent.id = :parentId")
    fun countChildren(parentId: UUID): Long

    // User access queries
    @Query("SELECT s FROM Space s JOIN s.permissions p WHERE p.user.id = :userId")
    fun findAllByUserId(userId: UUID): List<Space>

    @Query("SELECT s FROM Space s JOIN s.permissions p WHERE p.user.id = :userId AND s.parent IS NULL")
    fun findTopLevelByUserId(userId: UUID): List<Space>

    // Sync queries - only for repositories
    @Query("SELECT s FROM Space s WHERE s.syncEnabled = true AND s.type = 'REPOSITORY'")
    fun findAllRepositoriesWithSyncEnabled(): List<Space>

    @Query("SELECT s FROM Space s WHERE s.syncEnabled = true")
    fun findAllWithSyncEnabled(): List<Space>

    @Modifying
    @Query("UPDATE Space s SET s.lastSyncedAt = :syncedAt, s.lastSyncError = :error WHERE s.id = :id")
    fun updateSyncStatus(id: UUID, syncedAt: Instant?, error: String?)

    // Type-based queries
    fun findByType(type: SpaceType): List<Space>

    @Query("SELECT s FROM Space s WHERE s.type = :type AND s.parent IS NULL")
    fun findTopLevelByType(type: SpaceType): List<Space>
}

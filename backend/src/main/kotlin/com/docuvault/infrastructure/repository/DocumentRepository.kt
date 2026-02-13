package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Document
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface DocumentRepository : JpaRepository<Document, UUID> {
    fun findBySpaceId(spaceId: UUID): List<Document>
    fun findBySpaceIdAndPath(spaceId: UUID, path: String): Document?
    fun deleteBySpaceIdAndPathStartingWith(spaceId: UUID, pathPrefix: String)
    fun countBySpaceId(spaceId: UUID): Long

    @Query("""
        SELECT d FROM Document d
        WHERE d.space.id IN :spaceIds
        AND (LOWER(d.title) LIKE LOWER(CONCAT('%', :query, '%'))
             OR LOWER(d.path) LIKE LOWER(CONCAT('%', :query, '%')))
        ORDER BY d.updatedAt DESC
    """)
    fun searchByTitleOrPath(spaceIds: List<UUID>, query: String): List<Document>
}

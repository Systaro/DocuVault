package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Document
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import java.util.*

@Repository
interface DocumentRepository : JpaRepository<Document, UUID>, DocumentRepositoryCustom {
    fun findBySpaceId(spaceId: UUID): List<Document>
    fun findBySpaceIdAndPath(spaceId: UUID, path: String): Document?

    /** Derived delete — needs its own transaction when called outside one. */
    @Transactional
    fun deleteBySpaceIdAndPathStartingWith(spaceId: UUID, pathPrefix: String)
    fun countBySpaceId(spaceId: UUID): Long
}

package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Document
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import java.util.*

class DocumentRepositoryImpl(
    @PersistenceContext private val entityManager: EntityManager
) : DocumentRepositoryCustom {

    override fun searchByTerms(spaceIds: List<UUID>, query: String, limit: Int): List<Document> {
        if (spaceIds.isEmpty()) return emptyList()

        val terms = query.trim()
            .split(WHITESPACE)
            .filter { it.isNotBlank() }
            .take(MAX_TERMS)
        if (terms.isEmpty()) return emptyList()

        // One AND clause per term; each term matches title, path, or any chunk.
        // EXISTS (instead of a JOIN) keeps content matches per-document so two
        // terms can live in different chunks, and avoids DISTINCT fan-out.
        val clauses = terms.indices.joinToString(" AND ") { i ->
            """
            (LOWER(d.title) LIKE :term$i ESCAPE '\'
             OR LOWER(d.path) LIKE :term$i ESCAPE '\'
             OR EXISTS (SELECT 1 FROM DocumentEmbedding de
                        WHERE de.document = d
                        AND LOWER(de.content) LIKE :term$i ESCAPE '\'))
            """.trimIndent()
        }

        // Relevance: where a term matches matters more than recency. A term in
        // the title far outweighs one in the path, which outweighs a body-only
        // hit; the whole query appearing verbatim in the title gets an extra
        // boost so exact-title hits beat scattered per-term matches.
        val termScores = terms.indices.joinToString(" + ") { i ->
            """
            (CASE WHEN LOWER(d.title) LIKE :term$i ESCAPE '\' THEN 100 ELSE 0 END)
            + (CASE WHEN LOWER(d.path) LIKE :term$i ESCAPE '\' THEN 40 ELSE 0 END)
            + (CASE WHEN EXISTS (SELECT 1 FROM DocumentEmbedding de
                                 WHERE de.document = d
                                 AND LOWER(de.content) LIKE :term$i ESCAPE '\') THEN 10 ELSE 0 END)
            """.trimIndent()
        }
        val scoreExpr =
            "(CASE WHEN LOWER(d.title) LIKE :phrase ESCAPE '\\' THEN 50 ELSE 0 END) + $termScores"

        val jpql = """
            SELECT d FROM Document d
            WHERE d.space.id IN :spaceIds
            AND $clauses
            ORDER BY $scoreExpr DESC, d.updatedAt DESC
        """.trimIndent()

        val typedQuery = entityManager.createQuery(jpql, Document::class.java)
        typedQuery.setParameter("spaceIds", spaceIds)
        typedQuery.setParameter("phrase", "%${escapeLike(query.trim().lowercase())}%")
        terms.forEachIndexed { i, term ->
            typedQuery.setParameter("term$i", "%${escapeLike(term.lowercase())}%")
        }
        typedQuery.maxResults = limit

        return typedQuery.resultList
    }

    /** Escape LIKE wildcards so a literal % or _ in the term doesn't widen the match. */
    private fun escapeLike(value: String): String =
        value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    companion object {
        private val WHITESPACE = Regex("\\s+")
        private const val MAX_TERMS = 10
    }
}

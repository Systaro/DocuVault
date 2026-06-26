package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.Document
import java.util.*

interface DocumentRepositoryCustom {
    /**
     * Literal substring search over title, path, and embedded content.
     *
     * The raw query is split on whitespace and every term must match (AND),
     * each term matching any of title / path / content (OR). This is what lets
     * "ava local" find a doc that has "ava" in the title and "local" in the
     * body — a plain LIKE '%ava local%' only matches the contiguous phrase and
     * returns nothing for almost every multi-word query.
     */
    fun searchByTerms(spaceIds: List<UUID>, query: String, limit: Int): List<Document>
}

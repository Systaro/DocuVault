package com.docuvault.infrastructure.repository

import com.docuvault.domain.inbox.RoutingRule
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface RoutingRuleRepository : JpaRepository<RoutingRule, UUID> {
    fun findBySpaceIdOrderByCreatedAtAsc(spaceId: UUID): List<RoutingRule>
}

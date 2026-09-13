package com.docuvault.infrastructure.repository

import com.docuvault.domain.oauth.OauthClient
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface OauthClientRepository : JpaRepository<OauthClient, UUID> {
    fun findByClientId(clientId: String): OauthClient?
}

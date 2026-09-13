package com.docuvault.domain.oauth

import jakarta.persistence.*
import java.time.Instant
import java.util.*

/**
 * An MCP client that registered itself (RFC 7591). Claude Code registers a new
 * one per connection because its callback port is random; that is one row per
 * setup, not per request.
 */
@Entity
@Table(name = "oauth_clients")
class OauthClient(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: UUID? = null,

    @Column(name = "client_id", nullable = false, unique = true, columnDefinition = "TEXT")
    val clientId: String,

    /** Only confidential clients carry a secret; public clients rely on PKCE. */
    @Column(name = "client_secret_hash", columnDefinition = "TEXT")
    val clientSecretHash: String? = null,

    @Column(name = "client_name", nullable = false, columnDefinition = "TEXT")
    val clientName: String,

    @Convert(converter = StringListJsonConverter::class)
    @Column(name = "redirect_uris", nullable = false, columnDefinition = "TEXT")
    val redirectUris: List<String>,

    @Column(name = "token_endpoint_auth_method", nullable = false, columnDefinition = "TEXT")
    val tokenEndpointAuthMethod: String,

    @Convert(converter = StringListJsonConverter::class)
    @Column(name = "grant_types", nullable = false, columnDefinition = "TEXT")
    val grantTypes: List<String>,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)

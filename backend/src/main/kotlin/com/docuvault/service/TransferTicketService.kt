package com.docuvault.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Service
import java.security.SecureRandom
import java.time.Duration
import java.util.*

enum class TransferKind { UPLOAD, DOWNLOAD }

/** Who may move which file where. Issued after the permission check, redeemed once. */
data class TransferTicket(
    val kind: TransferKind,
    val userId: UUID,
    val spaceId: UUID,
    val path: String
)

/**
 * Short-lived, single-use tickets that let a client move file bytes with a
 * plain HTTP request instead of through an MCP tool call. The MCP server
 * cannot read the client's disk and a binary file must not travel through
 * the model, so the tool hands out a URL and `curl` does the transfer.
 *
 * Tickets live in Redis under the hash of the raw token; the raw token only
 * exists in the URL given to the client.
 */
@Service
class TransferTicketService(
    private val redis: StringRedisTemplate,
    private val objectMapper: ObjectMapper
) {
    companion object {
        val TTL: Duration = Duration.ofMinutes(10)
        private const val KEY_PREFIX = "docuvault:transfer:"
    }

    private val secureRandom = SecureRandom()

    /** Returns the raw token to put into the URL. */
    fun issue(ticket: TransferTicket): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        val raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        redis.opsForValue().set(KEY_PREFIX + TokenHashing.sha256Hex(raw), objectMapper.writeValueAsString(ticket), TTL)
        return raw
    }

    /** The ticket behind [raw], removed in the same step so it cannot be used twice. */
    fun redeem(raw: String): TransferTicket? {
        if (raw.isBlank() || raw.length > 128) return null
        val json = redis.opsForValue().getAndDelete(KEY_PREFIX + TokenHashing.sha256Hex(raw)) ?: return null
        return runCatching { objectMapper.readValue<TransferTicket>(json) }.getOrNull()
    }
}

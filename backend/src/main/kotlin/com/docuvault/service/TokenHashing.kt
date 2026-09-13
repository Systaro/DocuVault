package com.docuvault.service

import java.security.MessageDigest

/**
 * Credentials handed out by DocuVault (API tokens, OAuth codes and tokens) are
 * stored as SHA-256 hex digests. The raw value only ever lives in the response
 * that issued it.
 */
object TokenHashing {
    fun sha256Hex(raw: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}

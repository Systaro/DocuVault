package com.docuvault.service.mcp

import com.docuvault.domain.user.User

/**
 * Who is calling and with what. The tool handlers replay the caller's own
 * credential against the REST API, so permissions are checked exactly once,
 * in the controllers that already do it for the web UI.
 */
data class McpContext(val user: User, val authorizationHeader: String)

/** A tool ran and failed; reported as a result with `isError: true` so the model can react. */
class McpToolException(message: String) : RuntimeException(message)

/** The request itself is wrong (unknown tool, no tool name); reported as JSON-RPC error -32602. */
class McpInvalidParamsException(message: String) : RuntimeException(message)

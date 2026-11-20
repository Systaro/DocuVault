package com.docuvault.service.git

import java.util.UUID

/**
 * A text file in a space was written, by whatever path: the editor, an MCP client,
 * an AI edit, a restore from history, the inbox. Published synchronously on the
 * writing thread right after the bytes are on disk.
 */
data class TextFileWritten(val spaceId: UUID, val path: String, val content: String)

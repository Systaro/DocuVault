package com.docuvault.live

import com.docuvault.domain.user.User
import com.fasterxml.jackson.databind.node.ObjectNode
import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import java.util.UUID

enum class LiveMode { VIEW, EDIT }

/** A document of a space; the path is normalized (see [LiveHub.normalizePath]). */
data class DocKey(val spaceId: UUID, val path: String)

/** One browser tab's socket, its signed-in user and where that tab is. */
class LiveConnection(val id: String, private val session: WebSocketSession) {
    @Volatile var user: User? = null
    /** The space whose presence this tab watches (its sidebar). */
    @Volatile var watchedSpace: UUID? = null
    @Volatile var room: LiveRoom? = null
    @Volatile var mode: LiveMode = LiveMode.VIEW
    /** The Yjs client id of this tab's document copy, bound by its first awareness update. */
    @Volatile var clientId: Long? = null
    /** The heading this tab is reading or writing under. */
    @Volatile var section: String? = null
    @Volatile var editCheckedAt: Long = 0

    fun send(text: String) {
        try {
            if (session.isOpen) session.sendMessage(TextMessage(text))
        } catch (e: Exception) {
            // Gone or too slow to drain its buffer: the close handler tidies up.
            logger.debug("Dropped a live message to {}: {}", id, e.message)
        }
    }

    fun close(status: CloseStatus) {
        try {
            session.close(status)
        } catch (_: Exception) {
        }
    }

    private companion object {
        val logger = LoggerFactory.getLogger(LiveConnection::class.java)
    }
}

/**
 * Everyone in one document. Viewers only count for presence; editors share a Yjs
 * document whose updates the room keeps as an opaque log, so a late joiner can
 * catch up without the server understanding the format.
 *
 * Every field is guarded by the room's own monitor.
 */
class LiveRoom(val key: DocKey) {
    /** In join order, which is also the order leaders are chosen in. */
    val members = LinkedHashMap<String, LiveConnection>()

    /** Identifies the shared Yjs document. Null until its first editor seeded it. */
    var lineage: String? = null
    /** The editor expected to seed the document from the file. */
    var seeder: String? = null
    /** The one editor that autosaves for everyone. */
    var leader: String? = null

    /** Base64 Yjs updates since the document was seeded (or last compacted). */
    val updates = ArrayList<String>()
    var updateChars = 0L
    var compactPending = false

    /** What the file holds as far as the room knows: body, raw, content, hash, title. */
    var base: ObjectNode? = null
    /** A remote-backed space has saves that were written but not committed yet. */
    var pendingCommit = false
    var lastSaver: User? = null
    var lastTitle: String? = null

    /** Last awareness state per Yjs client: a joining editor sees every cursor at once. */
    val awareness = HashMap<Long, AwarenessCodec.Entry>()

    /** Serializes saves, so the order of `saved` broadcasts is the order the writes happened in. */
    val saveLock = Any()

    fun editors(): List<LiveConnection> = members.values.filter { it.mode == LiveMode.EDIT }
}

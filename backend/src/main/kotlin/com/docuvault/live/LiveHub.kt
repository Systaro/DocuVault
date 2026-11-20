package com.docuvault.live

import com.docuvault.config.BearerUserResolver
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.PermissionService
import com.docuvault.service.SpaceInConflictException
import com.docuvault.service.git.GitService
import com.docuvault.service.git.TextFileWritten
import com.docuvault.service.requireSpaceWritable
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.WebSocketSession
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Live presence and collaborative editing over one socket per browser tab.
 *
 * - **Presence:** a tab watches a space and learns who is online there and who is
 *   in which document; inside a document it sees every other reader and editor.
 * - **Editing:** the editors of a Markdown document share a Yjs document. The server
 *   relays its updates without reading them and keeps them as a log for late joiners.
 *   One editor seeds the shared document from the file; one editor (the leader)
 *   autosaves it, so concurrent writes cannot clobber each other.
 * - **Saving** runs through here rather than the REST endpoint, so a write by the
 *   room is told apart from one made elsewhere (MCP, AI edit, restore), which the
 *   room is notified of and merges.
 *
 * State lives in memory: one backend instance per installation, as everywhere else
 * in DocuVault. A restart drops the rooms; the tabs reconnect and rebuild them.
 */
@Component
class LiveHub(
    private val objectMapper: ObjectMapper,
    private val userRepository: UserRepository,
    private val spaceRepository: SpaceRepository,
    private val permissionService: PermissionService,
    private val documentPersistService: DocumentPersistService,
    private val gitService: GitService,
    private val bearerUserResolver: BearerUserResolver
) {
    private val logger = LoggerFactory.getLogger(LiveHub::class.java)

    private val connections = ConcurrentHashMap<String, LiveConnection>()
    private val rooms = ConcurrentHashMap<DocKey, LiveRoom>()

    /** Spaces whose presence changed since the last flush. */
    private val dirtySpaces = ConcurrentHashMap.newKeySet<UUID>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "live-presence").apply { isDaemon = true }
    }
    /** Saves and commits: file and Git work, kept off the socket threads. */
    private val writers = Executors.newCachedThreadPool { r ->
        Thread(r, "live-save").apply { isDaemon = true }
    }

    /** Set while the room itself writes its document, so its own write is not "external". */
    private val selfWrite = ThreadLocal<DocKey?>()

    init {
        scheduler.scheduleWithFixedDelay(::flushPresence, PRESENCE_FLUSH_MS, PRESENCE_FLUSH_MS, TimeUnit.MILLISECONDS)
    }

    @PreDestroy
    fun shutdown() {
        scheduler.shutdownNow()
        writers.shutdown()
    }

    // --- Connection lifecycle ------------------------------------------------

    fun connect(session: WebSocketSession, socket: WebSocketSession = session) {
        val conn = LiveConnection(session.id, socket)
        connections[conn.id] = conn
        // A browser brings its session cookie to the handshake; the native app
        // authenticates with a bearer token as its first message instead.
        val email = session.principal?.name
        val user = email?.let { userRepository.findByEmail(it) }?.takeIf { it.enabled }
        if (user != null) greet(conn, user)
    }

    fun disconnect(sessionId: String) {
        val conn = connections.remove(sessionId) ?: return
        leaveRoom(conn)
        conn.watchedSpace?.let { markPresence(it) }
    }

    fun handle(sessionId: String, text: String) {
        val conn = connections[sessionId] ?: return
        val msg = try {
            objectMapper.readTree(text) as? ObjectNode
        } catch (_: Exception) {
            null
        } ?: return
        val type = msg.path("t").asText()

        val user = conn.user
        if (user == null) {
            if (type == "auth") authenticate(conn, msg) else deny(conn, "Sign in first.", close = true)
            return
        }

        when (type) {
            "ping" -> conn.send(message("pong"))
            "space" -> watchSpace(conn, user, msg)
            "open" -> open(conn, user, msg)
            "mode" -> changeMode(conn, user, msg)
            "close" -> leaveRoom(conn)
            "where" -> where(conn, msg)
            "init" -> init(conn, msg)
            "update" -> update(conn, user, msg)
            "awareness" -> awareness(conn, user, msg)
            "compacted" -> compacted(conn, msg)
            "base" -> base(conn, msg)
            "save" -> save(conn, user, msg)
            else -> logger.debug("Unknown live message type '{}'", type)
        }
    }

    private fun authenticate(conn: LiveConnection, msg: ObjectNode) {
        val user = bearerUserResolver.userFor(msg.path("token").asText())?.takeIf { it.enabled }
        if (user == null) {
            deny(conn, "The token is not valid.", close = true)
            return
        }
        greet(conn, user)
    }

    private fun greet(conn: LiveConnection, user: User) {
        conn.user = user
        conn.send(message("hello") {
            put("sid", conn.id)
            put("userId", user.id.toString())
            put("name", user.name)
        })
    }

    // --- Presence ------------------------------------------------------------

    private fun watchSpace(conn: LiveConnection, user: User, msg: ObjectNode) {
        val previous = conn.watchedSpace
        val spaceId = msg.uuid("spaceId")
        if (spaceId != null && loadReadable(spaceId, user) == null) {
            deny(conn, "You have no access to this space.")
            return
        }
        conn.watchedSpace = spaceId
        previous?.let { markPresence(it) }
        if (spaceId != null) {
            markPresence(spaceId)
            conn.send(presenceMessage(spaceId))
        }
    }

    private fun markPresence(spaceId: UUID) {
        dirtySpaces.add(spaceId)
    }

    private fun flushPresence() {
        try {
            val spaces = dirtySpaces.toList()
            dirtySpaces.removeAll(spaces.toSet())
            for (spaceId in spaces) {
                val watchers = connections.values.filter { it.watchedSpace == spaceId }
                if (watchers.isEmpty()) continue
                val text = presenceMessage(spaceId)
                watchers.forEach { it.send(text) }
            }
        } catch (e: Exception) {
            logger.warn("Live presence flush failed: {}", e.message)
        }
    }

    /** Who is online in [spaceId] and who is in which of its documents, as the sidebar shows it. */
    private fun presenceMessage(spaceId: UUID): String = message("presence") { setAll<ObjectNode>(presence(spaceId)) }

    /**
     * Who is online in [spaceId] and who is in which of its documents. Callers check
     * that the asking user may see the space; this lists everyone in it.
     */
    fun presence(spaceId: UUID): ObjectNode = objectMapper.createObjectNode().apply {
        put("spaceId", spaceId.toString())
        val online = connections.values
            .filter { it.watchedSpace == spaceId || it.room?.key?.spaceId == spaceId }
            .mapNotNull { it.user }
            .distinctBy { it.id }
            .sortedBy { it.name.lowercase() }
        putArray("online").apply {
            online.forEach { u -> addObject().put("userId", u.id.toString()).put("name", u.name) }
        }
        val docs = putArray("docs")
        for (room in rooms.values.filter { it.key.spaceId == spaceId }) {
            val people = synchronized(room) {
                room.members.values.mapNotNull { c -> c.user?.let { it to c.mode } }
            }
            if (people.isEmpty()) continue
            val doc = docs.addObject().put("path", room.key.path)
            val users = doc.putArray("users")
            people.groupBy { it.first.id }.values.forEach { sessions ->
                val u = sessions.first().first
                val editing = sessions.any { it.second == LiveMode.EDIT }
                users.addObject()
                    .put("userId", u.id.toString())
                    .put("name", u.name)
                    .put("mode", if (editing) "edit" else "view")
            }
        }
    }

    /** Everyone in the room, for its own members. Call while holding the room. */
    private fun broadcastPeers(room: LiveRoom) {
        val text = message("peers") {
            put("spaceId", room.key.spaceId.toString())
            put("path", room.key.path)
            val peers = putArray("peers")
            room.members.values.forEach { c ->
                val u = c.user ?: return@forEach
                peers.addObject()
                    .put("sid", c.id)
                    .put("userId", u.id.toString())
                    .put("name", u.name)
                    .put("mode", if (c.mode == LiveMode.EDIT) "edit" else "view")
                    .put("section", c.section)
                    .put("leader", room.leader == c.id)
                    .apply { c.clientId?.let { put("clientId", it) } ?: putNull("clientId") }
            }
        }
        room.members.values.forEach { it.send(text) }
    }

    private fun where(conn: LiveConnection, msg: ObjectNode) {
        val room = conn.room ?: return
        conn.section = msg.path("section").takeIf { it.isTextual }?.asText()?.take(MAX_SECTION_CHARS)
        synchronized(room) { broadcastPeers(room) }
    }

    // --- Joining and leaving a document ---------------------------------------

    private fun open(conn: LiveConnection, user: User, msg: ObjectNode) {
        val spaceId = msg.uuid("spaceId")
        val path = msg.path("path").asText().let(::normalizePath)
        if (spaceId == null || path == null) {
            deny(conn, "Unknown document.")
            return
        }
        val mode = parseMode(msg)
        val space = loadReadable(spaceId, user)
        if (space == null) {
            deny(conn, "You have no access to this space.")
            return
        }
        val key = DocKey(spaceId, path)
        if (conn.room?.key == key) {
            changeMode(conn, user, msg)
            return
        }
        if (mode == LiveMode.EDIT && !mayEdit(conn, user, space, path)) return

        leaveRoom(conn)
        conn.section = null
        conn.clientId = null
        while (true) {
            val room = rooms.computeIfAbsent(key) { LiveRoom(it) }
            synchronized(room) {
                // Removed while we waited for its monitor: take the fresh one.
                if (rooms[key] !== room) return@synchronized
                conn.mode = mode
                conn.room = room
                room.members[conn.id] = conn
                if (mode == LiveMode.EDIT) editorJoined(room, conn)
                broadcastPeers(room)
            }
            if (conn.room === room) break
        }
        markPresence(spaceId)
    }

    private fun changeMode(conn: LiveConnection, user: User, msg: ObjectNode) {
        val room = conn.room ?: return
        val mode = parseMode(msg)
        if (mode == conn.mode) return
        if (mode == LiveMode.EDIT) {
            val space = loadReadable(room.key.spaceId, user) ?: return deny(conn, "You have no access to this space.")
            if (!mayEdit(conn, user, space, room.key.path)) return
        }
        synchronized(room) {
            if (conn.room !== room) return
            conn.mode = mode
            if (mode == LiveMode.EDIT) editorJoined(room, conn) else editorLeft(room, conn)
            broadcastPeers(room)
        }
        markPresence(room.key.spaceId)
    }

    private fun leaveRoom(conn: LiveConnection) {
        val room = conn.room ?: return
        synchronized(room) {
            conn.room = null
            room.members.remove(conn.id)
            if (conn.mode == LiveMode.EDIT) editorLeft(room, conn)
            conn.mode = LiveMode.VIEW
            if (room.members.isEmpty()) rooms.remove(room.key, room) else broadcastPeers(room)
        }
        markPresence(room.key.spaceId)
    }

    /** Call while holding the room. */
    private fun editorJoined(room: LiveRoom, conn: LiveConnection) {
        if (room.lineage == null && room.seeder == null) room.seeder = conn.id
        if (room.leader == null) room.leader = conn.id
        val seeder = room.seeder == conn.id
        conn.send(message("welcome") {
            put("path", room.key.path)
            put("lineage", room.lineage)
            put("seeder", seeder)
            put("leader", room.leader == conn.id)
            put("pendingCommit", room.pendingCommit)
            set<JsonNode>("base", room.base)
            putArray("updates").apply { room.updates.forEach { add(it) } }
            // A seeder holding a copy from before (a reconnect after the room was
            // gone) may keep it only if the file has not moved on since.
            if (seeder) put("fileHash", currentFileHash(room.key))
        })
        val cursors = room.awareness.values.toList()
        if (cursors.isNotEmpty()) {
            val data = Base64.getEncoder().encodeToString(AwarenessCodec.encode(cursors))
            conn.send(message("awareness") { put("data", data) })
        }
    }

    /** Call while holding the room. */
    private fun editorLeft(room: LiveRoom, conn: LiveConnection) {
        retireAwareness(room, conn)
        val editors = room.editors().filter { it.id != conn.id }
        if (room.seeder == conn.id) {
            room.seeder = editors.firstOrNull()?.id
            editors.firstOrNull()?.send(message("seed"))
        }
        if (room.leader == conn.id) {
            room.leader = editors.firstOrNull()?.id
            editors.firstOrNull()?.send(message("leader"))
        }
        if (editors.isEmpty()) {
            // The last editor's final save is already through; the file is the
            // document now, and the next editor seeds a fresh copy from it.
            room.lineage = null
            room.seeder = null
            room.leader = null
            room.updates.clear()
            room.updateChars = 0
            room.compactPending = false
            room.awareness.clear()
            if (room.pendingCommit) commitLeftovers(room)
        }
    }

    /** Commits what a remote-backed space's room saved without committing, once nobody edits it any more. */
    private fun commitLeftovers(room: LiveRoom) {
        val saver = room.lastSaver ?: return
        val message = "Update ${room.lastTitle?.takeIf { it.isNotBlank() } ?: room.key.path}"
        room.pendingCommit = false
        writers.execute {
            val space = spaceRepository.findById(room.key.spaceId).orElse(null) ?: return@execute
            synchronized(room.saveLock) {
                documentPersistService.commitIfRequested(space, true, message, saver)
            }
        }
    }

    // --- Shared document -------------------------------------------------------

    private fun init(conn: LiveConnection, msg: ObjectNode) {
        val room = conn.room ?: return
        val lineage = msg.path("lineage").asText().takeIf { it.isNotBlank() } ?: return
        val data = msg.path("data").asText()
        if (data.isEmpty() || data.length > MAX_UPDATE_CHARS) return
        synchronized(room) {
            if (room.seeder != conn.id || room.lineage != null || conn.mode != LiveMode.EDIT) return
            room.lineage = lineage
            room.seeder = null
            room.updates.add(data)
            room.updateChars = data.length.toLong()
            (msg.get("base") as? ObjectNode)?.let { room.base = it }
            val text = message("lineage") {
                put("lineage", lineage)
                putArray("updates").add(data)
                set<JsonNode>("base", room.base)
            }
            room.editors().filter { it.id != conn.id }.forEach { it.send(text) }
        }
    }

    private fun update(conn: LiveConnection, user: User, msg: ObjectNode) {
        val room = conn.room ?: return
        if (conn.mode != LiveMode.EDIT || !stillMayEdit(conn, user, room)) return
        val data = msg.path("data").asText()
        if (data.isEmpty() || data.length > MAX_UPDATE_CHARS) return
        synchronized(room) {
            // A tab still holding a copy of an earlier document must not mix it in.
            if (room.lineage == null || msg.path("lineage").asText() != room.lineage) return
            room.updates.add(data)
            room.updateChars += data.length
            val text = message("update") { put("data", data) }
            room.editors().filter { it.id != conn.id }.forEach { it.send(text) }
            if (!room.compactPending && (room.updates.size > COMPACT_AFTER_UPDATES || room.updateChars > COMPACT_AFTER_CHARS)) {
                val leader = room.members[room.leader ?: ""]
                if (leader != null) {
                    room.compactPending = true
                    leader.send(message("compact") { put("upTo", room.updates.size) })
                }
            }
        }
    }

    /** The leader replaced the first [upTo] log entries by one state that contains them all. */
    private fun compacted(conn: LiveConnection, msg: ObjectNode) {
        val room = conn.room ?: return
        val data = msg.path("data").asText()
        val upTo = msg.path("upTo").asInt(-1)
        if (data.isEmpty() || data.length > MAX_UPDATE_CHARS) return
        synchronized(room) {
            room.compactPending = false
            if (room.leader != conn.id || msg.path("lineage").asText() != room.lineage) return
            if (upTo < 1 || upTo > room.updates.size) return
            val rest = room.updates.subList(upTo, room.updates.size).toList()
            room.updates.clear()
            room.updates.add(data)
            room.updates.addAll(rest)
            room.updateChars = room.updates.sumOf { it.length.toLong() }
        }
    }

    private fun awareness(conn: LiveConnection, user: User, msg: ObjectNode) {
        val room = conn.room ?: return
        if (conn.mode != LiveMode.EDIT) return
        val entries = try {
            AwarenessCodec.decode(Base64.getDecoder().decode(msg.path("data").asText()))
        } catch (_: Exception) {
            return
        }
        synchronized(room) {
            val accepted = entries.mapNotNull { entry ->
                // A tab speaks for its own document copy only.
                val bound = conn.clientId ?: entry.clientId.also { conn.clientId = it; broadcastPeers(room) }
                if (entry.clientId != bound) return@mapNotNull null
                entry.copy(stateJson = withVerifiedUser(entry.stateJson, user)).also { room.awareness[it.clientId] = it }
            }
            if (accepted.isEmpty()) return
            val data = Base64.getEncoder().encodeToString(AwarenessCodec.encode(accepted))
            val text = message("awareness") { put("data", data) }
            room.editors().filter { it.id != conn.id }.forEach { it.send(text) }
        }
    }

    /** The awareness state with its `user` set to who the server knows this tab is. */
    private fun withVerifiedUser(stateJson: String, user: User): String {
        val state = try {
            objectMapper.readTree(stateJson)
        } catch (_: Exception) {
            null
        }
        if (state !is ObjectNode) return "null"
        state.putObject("user").put("id", user.id.toString()).put("name", user.name)
        return objectMapper.writeValueAsString(state)
    }

    /** Tells the remaining editors that [conn]'s cursor is gone. Call while holding the room. */
    private fun retireAwareness(room: LiveRoom, conn: LiveConnection) {
        val clientId = conn.clientId ?: return
        val clock = (room.awareness.remove(clientId)?.clock ?: 0L) + 1
        val data = Base64.getEncoder().encodeToString(
            AwarenessCodec.encode(listOf(AwarenessCodec.Entry(clientId, clock, "null")))
        )
        val text = message("awareness") { put("data", data) }
        room.editors().filter { it.id != conn.id }.forEach { it.send(text) }
        conn.clientId = null
    }

    /** The leader took an external change into the document; this is what the file now holds. */
    private fun base(conn: LiveConnection, msg: ObjectNode) {
        val room = conn.room ?: return
        val base = msg.get("base") as? ObjectNode ?: return
        synchronized(room) {
            if (room.leader != conn.id) return
            room.base = base
            val text = message("base") { set<JsonNode>("base", base) }
            room.editors().filter { it.id != conn.id }.forEach { it.send(text) }
        }
    }

    // --- Saving -------------------------------------------------------------------

    private fun save(conn: LiveConnection, user: User, msg: ObjectNode) {
        val room = conn.room ?: return
        val req = msg.path("req").asText()
        val content = msg.path("content").asText()
        val title = msg.path("title").asText().takeIf { it.isNotBlank() }
        val commit = msg.path("commit").asBoolean(false)
        if (conn.mode != LiveMode.EDIT) return saveFailed(conn, req, 409, "This tab is not editing the document.")
        if (content.isBlank()) return saveFailed(conn, req, 400, "There is nothing to save.")

        writers.execute {
            val space = spaceRepository.findById(room.key.spaceId).orElse(null)
                ?: return@execute saveFailed(conn, req, 404, "The space no longer exists.")
            if (!permissionService.hasEditAccess(user.id!!, space.id!!, user.role)) {
                return@execute saveFailed(conn, req, 403, "You can no longer edit this space.")
            }
            try {
                requireSpaceWritable(space)
            } catch (e: SpaceInConflictException) {
                return@execute saveFailed(conn, req, 409, e.message ?: "The space has a sync conflict.")
            }

            synchronized(room.saveLock) {
                val saved = try {
                    selfWrite.set(room.key)
                    documentPersistService.persistDocument(
                        space = space,
                        user = user,
                        documentPath = room.key.path,
                        content = content,
                        title = title,
                        autoCommit = commit,
                        commitMessage = if (commit) "Update ${title ?: room.key.path}" else null
                    )
                } catch (e: Exception) {
                    logger.error("Live save of {} failed: {}", room.key, e.message, e)
                    null
                } finally {
                    selfWrite.remove()
                }
                if (saved == null) return@execute saveFailed(conn, req, 500, "The document could not be written.")

                val base = objectMapper.createObjectNode()
                    .put("body", msg.path("body").asText(content))
                    .put("raw", msg.path("raw").asText())
                    .put("content", content)
                    .put("hash", saved.contentHash)
                    .put("title", saved.title)
                synchronized(room) {
                    room.base = base
                    room.lastSaver = user
                    room.lastTitle = saved.title
                    room.pendingCommit = !commit && !space.gitlabUrl.isNullOrBlank()
                    // The final save of a tab that has just left: nobody is left to commit it.
                    if (room.pendingCommit && room.editors().isEmpty()) commitLeftovers(room)
                    val text = message("saved") {
                        put("req", req)
                        put("sid", conn.id)
                        put("by", user.name)
                        put("commit", commit)
                        put("pendingCommit", room.pendingCommit)
                        set<JsonNode>("base", base)
                    }
                    room.members.values.forEach { it.send(text) }
                }
            }
        }
    }

    private fun saveFailed(conn: LiveConnection, req: String, status: Int, message: String) {
        conn.send(message("saveFailed") {
            put("req", req)
            put("status", status)
            put("message", message)
        })
    }

    /** Somebody wrote the file outside the room: everyone in it gets the new text. */
    @EventListener
    fun onTextFileWritten(event: TextFileWritten) {
        val key = DocKey(event.spaceId, normalizePath(event.path) ?: return)
        if (selfWrite.get() == key) return
        val room = rooms[key] ?: return
        val hash = documentPersistService.hashContent(event.content)
        synchronized(room) {
            room.base = objectMapper.createObjectNode()
                .put("content", event.content)
                .put("hash", hash)
            val text = message("external") {
                put("content", event.content)
                put("hash", hash)
            }
            room.members.values.forEach { it.send(text) }
        }
    }

    // --- Helpers ----------------------------------------------------------------

    private fun parseMode(msg: ObjectNode) =
        if (msg.path("mode").asText() == "edit") LiveMode.EDIT else LiveMode.VIEW

    private fun loadReadable(spaceId: UUID, user: User): Space? {
        val space = spaceRepository.findById(spaceId).orElse(null) ?: return null
        return space.takeIf { permissionService.hasAccess(user.id!!, spaceId, user.role) }
    }

    /** Edit rights, a Markdown document and a space that takes writes. Tells the tab why not. */
    private fun mayEdit(conn: LiveConnection, user: User, space: Space, path: String): Boolean {
        val reason = when {
            !permissionService.hasEditAccess(user.id!!, space.id!!, user.role) -> "You can only read this space."
            !isMarkdown(path) -> "Live editing covers Markdown documents."
            else -> try {
                requireSpaceWritable(space)
                null
            } catch (e: SpaceInConflictException) {
                e.message ?: "The space has a sync conflict."
            }
        }
        if (reason != null) {
            deny(conn, reason)
            return false
        }
        conn.editCheckedAt = System.currentTimeMillis()
        return true
    }

    /** Rights can be taken away while a tab edits; checked again every so often, not per keystroke. */
    private fun stillMayEdit(conn: LiveConnection, user: User, room: LiveRoom): Boolean {
        if (System.currentTimeMillis() - conn.editCheckedAt < EDIT_RECHECK_MS) return true
        if (!permissionService.hasEditAccess(user.id!!, room.key.spaceId, user.role)) {
            deny(conn, "You can no longer edit this space.")
            leaveRoom(conn)
            return false
        }
        conn.editCheckedAt = System.currentTimeMillis()
        return true
    }

    private fun currentFileHash(key: DocKey): String? {
        val space = spaceRepository.findById(key.spaceId).orElse(null) ?: return null
        return try {
            gitService.readFile(space, key.path)?.let { documentPersistService.hashContent(it) }
        } catch (_: Exception) {
            null
        }
    }

    private fun deny(conn: LiveConnection, reason: String, close: Boolean = false) {
        conn.send(message("denied") { put("message", reason) })
        if (close) conn.close(CloseStatus.POLICY_VIOLATION)
    }

    private fun message(type: String, build: ObjectNode.() -> Unit = {}): String {
        val node = objectMapper.createObjectNode().put("t", type)
        node.build()
        return objectMapper.writeValueAsString(node)
    }

    private fun ObjectNode.uuid(field: String): UUID? =
        path(field).asText().takeIf { it.isNotBlank() }?.let { runCatching { UUID.fromString(it) }.getOrNull() }

    companion object {
        private const val PRESENCE_FLUSH_MS = 300L
        private const val EDIT_RECHECK_MS = 60_000L
        private const val MAX_SECTION_CHARS = 200
        /** One Yjs update, or a whole document's state when seeding or compacting. */
        const val MAX_UPDATE_CHARS = 3 * 1024 * 1024
        private const val COMPACT_AFTER_UPDATES = 500
        private const val COMPACT_AFTER_CHARS = 2L * 1024 * 1024

        fun isMarkdown(path: String) = path.substringAfterLast('.', "").lowercase() in setOf("md", "markdown")

        /** A space-relative path in the one spelling rooms are keyed by; null when it leaves the space. */
        fun normalizePath(raw: String): String? {
            val parts = raw.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }
            if (parts.isEmpty() || parts.any { it == ".." }) return null
            return parts.joinToString("/")
        }
    }
}

package com.docuvault.live

import com.docuvault.config.BearerUserResolver
import com.docuvault.domain.space.Document
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.DocumentPersistService
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import com.docuvault.service.git.TextFileWritten
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyBoolean
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import java.security.Principal
import java.util.Base64
import java.util.Optional
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The live hub decides who seeds a shared document, who saves it and who hears
 * what. These tests drive it through fake sockets, the way browser tabs would.
 */
class LiveHubTest {

    private val json = ObjectMapper()

    private val alice = User(id = UUID.randomUUID(), email = "alice@example.com", passwordHash = "x", name = "Alice", role = UserRole.EDITOR)
    private val bob = User(id = UUID.randomUUID(), email = "bob@example.com", passwordHash = "x", name = "Bob", role = UserRole.EDITOR)
    private val carol = User(id = UUID.randomUUID(), email = "carol@example.com", passwordHash = "x", name = "Carol", role = UserRole.VIEWER)
    private val space = Space(id = UUID.randomUUID(), name = "Handbook", slug = "handbook", createdBy = alice)
    private val path = "guides/setup.md"

    private val userRepository = mock(UserRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val permissionService = mock(PermissionService::class.java)
    private val persistService = mock(DocumentPersistService::class.java)
    private val gitService = mock(GitService::class.java)

    private val hub = LiveHub(
        json, userRepository, spaceRepository, permissionService, persistService, gitService,
        mock(BearerUserResolver::class.java)
    )

    init {
        for (u in listOf(alice, bob, carol)) {
            `when`(userRepository.findByEmail(u.email)).thenReturn(u)
            `when`(permissionService.hasAccess(u.id!!, space.id!!, u.role)).thenReturn(true)
            `when`(permissionService.hasEditAccess(u.id!!, space.id!!, u.role)).thenReturn(u.role != UserRole.VIEWER)
        }
        `when`(spaceRepository.findById(space.id!!)).thenReturn(Optional.of(space))
        `when`(gitService.readFile(space, path)).thenReturn("# Setup\n")
        `when`(persistService.hashContent(anyString())).thenAnswer { "hash-of-" + (it.arguments[0] as String).length }
    }

    @AfterEach
    fun stop() = hub.shutdown()

    /** A browser tab: its socket and everything the server sent it. */
    private inner class Tab(val user: User) {
        val id = UUID.randomUUID().toString()
        val received = CopyOnWriteArrayList<JsonNode>()

        init {
            val session = mock(WebSocketSession::class.java)
            `when`(session.id).thenReturn(id)
            `when`(session.isOpen).thenReturn(true)
            `when`(session.principal).thenReturn(Principal { user.email })
            `when`(session.sendMessage(any())).thenAnswer {
                received.add(json.readTree((it.arguments[0] as TextMessage).payload))
                null
            }
            hub.connect(session)
        }

        fun send(type: String, vararg fields: Pair<String, Any?>) {
            val node = json.createObjectNode().put("t", type)
            fields.forEach { (k, v) -> node.set<JsonNode>(k, json.valueToTree(v)) }
            hub.handle(id, json.writeValueAsString(node))
        }

        fun open(mode: String) = send("open", "spaceId" to space.id.toString(), "path" to path, "mode" to mode)
        fun of(type: String) = received.filter { it.path("t").asText() == type }
        fun last(type: String) = of(type).lastOrNull()
        fun clear() = received.clear()
        fun close() = hub.disconnect(id)
    }

    @Test
    fun `the first editor seeds and leads, the second catches up from the log`() {
        val a = Tab(alice)
        a.open("edit")
        val welcomeA = a.last("welcome")!!
        assertTrue(welcomeA.path("seeder").asBoolean())
        assertTrue(welcomeA.path("leader").asBoolean())
        assertTrue(welcomeA.path("lineage").isNull)
        assertEquals("hash-of-8", welcomeA.path("fileHash").asText())

        val b = Tab(bob)
        b.open("edit")
        val welcomeB = b.last("welcome")!!
        assertFalse(welcomeB.path("seeder").asBoolean(), "only one tab seeds")
        assertFalse(welcomeB.path("leader").asBoolean())

        a.send("init", "lineage" to "L1", "data" to "U0", "base" to mapOf("raw" to "Setup"))
        val lineage = b.last("lineage")!!
        assertEquals("L1", lineage.path("lineage").asText())
        assertEquals(listOf("U0"), lineage.path("updates").map { it.asText() })

        val c = Tab(bob)
        c.open("edit")
        val welcomeC = c.last("welcome")!!
        assertEquals("L1", welcomeC.path("lineage").asText())
        assertEquals(listOf("U0"), welcomeC.path("updates").map { it.asText() })
        assertEquals("Setup", welcomeC.path("base").path("raw").asText())
    }

    @Test
    fun `updates reach the other editors only, and never a stale copy`() {
        val a = Tab(alice).apply { open("edit") }
        a.send("init", "lineage" to "L1", "data" to "U0")
        val b = Tab(bob).apply { open("edit") }
        val reader = Tab(carol).apply { open("view") }
        listOf(a, b, reader).forEach { it.clear() }

        a.send("update", "lineage" to "L1", "data" to "U1")
        assertEquals("U1", b.last("update")!!.path("data").asText())
        assertNull(a.last("update"), "no echo to the sender")
        assertNull(reader.last("update"), "readers get no document traffic")

        b.send("update", "lineage" to "OLD", "data" to "STALE")
        assertNull(a.last("update")?.takeIf { it.path("data").asText() == "STALE" })

        reader.send("update", "lineage" to "L1", "data" to "SNEAKY")
        assertTrue(a.of("update").none { it.path("data").asText() == "SNEAKY" }, "a reader cannot write")
    }

    @Test
    fun `a viewer cannot become an editor`() {
        val reader = Tab(carol)
        reader.open("edit")
        assertNull(reader.last("welcome"))
        assertEquals("You can only read this space.", reader.last("denied")!!.path("message").asText())
    }

    @Test
    fun `the name on a cursor is the one the server knows`() {
        val a = Tab(alice).apply { open("edit") }
        val b = Tab(bob).apply { open("edit") }
        val spoofed = AwarenessCodec.encode(listOf(
            AwarenessCodec.Entry(42, 1, """{"user":{"name":"Bob"},"cursor":{"anchor":1}}"""),
            AwarenessCodec.Entry(99, 1, """{"user":{"name":"Somebody else"}}""")
        ))
        a.send("awareness", "data" to Base64.getEncoder().encodeToString(spoofed))

        val relayed = AwarenessCodec.decode(Base64.getDecoder().decode(b.last("awareness")!!.path("data").asText()))
        assertEquals(listOf(42L), relayed.map { it.clientId }, "a tab speaks for its own client only")
        val state = json.readTree(relayed.single().stateJson)
        assertEquals("Alice", state.path("user").path("name").asText())
        assertEquals(alice.id.toString(), state.path("user").path("id").asText())
        assertEquals(1, state.path("cursor").path("anchor").asInt())
    }

    @Test
    fun `when the leader leaves the next editor leads, and its cursor is retired`() {
        val a = Tab(alice).apply { open("edit") }
        a.send("init", "lineage" to "L1", "data" to "U0")
        a.send("awareness", "data" to Base64.getEncoder().encodeToString(
            AwarenessCodec.encode(listOf(AwarenessCodec.Entry(7, 3, """{"cursor":null}""")))
        ))
        val b = Tab(bob).apply { open("edit") }
        b.clear()

        a.close()
        assertTrue(b.of("leader").isNotEmpty())
        val retired = AwarenessCodec.decode(Base64.getDecoder().decode(b.last("awareness")!!.path("data").asText())).single()
        assertEquals(7L, retired.clientId)
        assertEquals(4L, retired.clock)
        assertEquals("null", retired.stateJson)
        assertTrue(b.last("peers")!!.path("peers").single().path("leader").asBoolean())
    }

    @Test
    fun `the last editor leaving drops the shared copy, the next one seeds again`() {
        val a = Tab(alice).apply { open("edit") }
        a.send("init", "lineage" to "L1", "data" to "U0")
        val reader = Tab(carol).apply { open("view") }
        a.send("mode", "mode" to "view")

        val b = Tab(bob).apply { open("edit") }
        val welcome = b.last("welcome")!!
        assertTrue(welcome.path("lineage").isNull)
        assertTrue(welcome.path("seeder").asBoolean())
        assertEquals(3, reader.last("peers")!!.path("peers").size())
    }

    @Test
    fun `a seeder that leaves before seeding hands the job on`() {
        val a = Tab(alice).apply { open("edit") }
        val b = Tab(bob).apply { open("edit") }
        a.close()
        assertTrue(b.of("seed").isNotEmpty())
        b.send("init", "lineage" to "L2", "data" to "U0")
        val c = Tab(bob).apply { open("edit") }
        assertEquals("L2", c.last("welcome")!!.path("lineage").asText())
    }

    @Test
    fun `a save reaches everyone in the document, and the room's own write is not external`() {
        val a = Tab(alice).apply { open("edit") }
        val reader = Tab(carol).apply { open("view") }
        val saved = Document(id = UUID.randomUUID(), space = space, path = path, title = "Setup", contentHash = "h2")
        `when`(persistService.persistDocument(any() ?: space, any() ?: alice, anyString(), anyString(), any(), anyBoolean(), any()))
            .thenAnswer {
                // The real write path announces the file, synchronously, like GitService does.
                hub.onTextFileWritten(TextFileWritten(space.id!!, path, it.arguments[3] as String))
                saved
            }

        a.send("save", "req" to "r1", "title" to "Setup", "content" to "# Setup\n\nHello\n", "body" to "Hello\n", "raw" to "Hello", "commit" to false)
        val ack = waitFor { a.last("saved") }
        assertEquals("r1", ack.path("req").asText())
        assertEquals("h2", ack.path("base").path("hash").asText())
        assertEquals("Hello", ack.path("base").path("raw").asText())
        assertEquals("Alice", waitFor { reader.last("saved") }.path("by").asText())
        assertNull(a.last("external"), "the room's own save is not a change from outside")

        hub.onTextFileWritten(TextFileWritten(space.id!!, "./$path", "# Setup\n\nFrom an agent\n"))
        assertEquals("# Setup\n\nFrom an agent\n", a.last("external")!!.path("content").asText())
        assertEquals("# Setup\n\nFrom an agent\n", reader.last("external")!!.path("content").asText())
    }

    @Test
    fun `presence lists who is online and who is in which document`() {
        val watcher = Tab(carol)
        watcher.send("space", "spaceId" to space.id.toString())
        Tab(alice).open("edit")
        Tab(bob).open("view")

        val presence = waitFor { watcher.last("presence")?.takeIf { it.path("docs").size() == 1 } }
        assertEquals(listOf("Alice", "Bob", "Carol"), presence.path("online").map { it.path("name").asText() })
        val users = presence.path("docs").single().path("users").associate { it.path("name").asText() to it.path("mode").asText() }
        assertEquals(mapOf("Alice" to "edit", "Bob" to "view"), users)
    }

    @Test
    fun `paths that leave the space are refused`() {
        assertNull(LiveHub.normalizePath("../other/secret.md"))
        assertEquals("guides/setup.md", LiveHub.normalizePath("./guides//setup.md"))
    }

    private fun <T : Any> waitFor(probe: () -> T?): T {
        val deadline = System.currentTimeMillis() + 3_000
        while (System.currentTimeMillis() < deadline) {
            probe()?.let { return it }
            Thread.sleep(20)
        }
        throw AssertionError("Timed out waiting for a live message")
    }
}

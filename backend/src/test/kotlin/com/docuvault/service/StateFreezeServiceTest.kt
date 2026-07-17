package com.docuvault.service

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceState
import com.docuvault.infrastructure.repository.SpaceStateRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.util.*

class StateFreezeServiceTest {

    private val spaceStateRepository = mock(SpaceStateRepository::class.java)
    private val service = StateFreezeService(spaceStateRepository, ObjectMapper())
    private val spaceId: UUID = UUID.randomUUID()

    private fun stateEntry(key: String, value: String) =
        SpaceState(space = mock(Space::class.java), key = key, value = value)

    private fun htmlUsingState(key: String = "my-form") = """
        <!DOCTYPE html>
        <html>
        <head>
          <title>Form</title>
          <script src="/assets/docuvault-state.js"></script>
          <script>
            DocuVaultState.init({
              spaceId: '$spaceId',
              key: '$key'
            });
          </script>
        </head>
        <body><h1>Hi</h1></body>
        </html>
    """.trimIndent()

    @Test
    fun `detects the state key from the init call`() {
        assertEquals(listOf("my-form"), service.detectStateKeys(htmlUsingState("my-form")))
    }

    @Test
    fun `returns null for HTML that does not use the state library`() {
        assertNull(service.freezeHtml("<html><head></head><body>plain</body></html>", spaceId))
    }

    @Test
    fun `embeds the current state and strips the library script tag`() {
        `when`(spaceStateRepository.findBySpaceIdAndKey(spaceId, "my-form"))
            .thenReturn(stateEntry("my-form", """{"assignee":"Anna"}"""))

        val frozen = service.freezeHtml(htmlUsingState(), spaceId)

        assertNotNull(frozen)
        assertFalse(frozen!!.contains("docuvault-state.js"), "library script tag must be removed")
        assertTrue(frozen.contains(""""my-form":{"assignee":"Anna"}"""), "snapshot must be embedded")
        assertTrue(frozen.contains("frozen: true"), "shim must mark itself as frozen")
        assertTrue(
            frozen.indexOf("DocuVaultState = ") < frozen.indexOf("DocuVaultState.init"),
            "shim must be injected before the init call"
        )
    }

    @Test
    fun `falls back to an empty snapshot when no state was saved yet`() {
        `when`(spaceStateRepository.findBySpaceIdAndKey(spaceId, "my-form")).thenReturn(null)

        val frozen = service.freezeHtml(htmlUsingState(), spaceId)

        assertNotNull(frozen)
        assertTrue(frozen!!.contains(""""my-form":{}"""))
    }

    @Test
    fun `escapes script-closing sequences inside state values`() {
        `when`(spaceStateRepository.findBySpaceIdAndKey(spaceId, "my-form"))
            .thenReturn(stateEntry("my-form", """{"note":"</script><script>alert(1)</script>"}"""))

        val frozen = service.freezeHtml(htmlUsingState(), spaceId)

        assertNotNull(frozen)
        assertFalse(frozen!!.contains("</script><script>alert(1)"), "unescaped closing tag must not survive")
        assertTrue(frozen.contains("""<\/script>"""), "closing tags must be escaped as <\\/")
    }

    @Test
    fun `invalid stored state degrades to an empty object`() {
        `when`(spaceStateRepository.findBySpaceIdAndKey(spaceId, "my-form"))
            .thenReturn(stateEntry("my-form", "not json at all"))

        val frozen = service.freezeHtml(htmlUsingState(), spaceId)

        assertNotNull(frozen)
        assertTrue(frozen!!.contains(""""my-form":{}"""))
    }
}

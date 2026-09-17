package com.docuvault.service.task

import com.docuvault.domain.user.User
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.util.*

/** Meeting notes as the bot sends them: Markdown rendered to HTML by marked. */
class ActionItemsTest {

    private val note = """
        <h1>Weekly sync</h1>
        <p><strong>Participants:</strong> Anna Berg, Tom Klein</p>
        <h2>Action Items</h2>
        <ul>
        <li><input disabled="" type="checkbox"> Send the offer to Acme — Anna</li>
        <li><input disabled="" type="checkbox"> Book the room for the workshop</li>
        <li><input checked="" disabled="" type="checkbox"> Already sorted — Tom</li>
        </ul>
        <h2>Open Questions</h2>
        <ul><li>Who pays for lunch?</li></ul>
    """.trimIndent()

    @Test
    fun `reads unticked checkboxes with their owner and skips ticked ones and plain bullets`() {
        assertEquals(
            listOf(ActionItem("Send the offer to Acme", "Anna"), ActionItem("Book the room for the workshop", null)),
            ActionItems.parse(note)
        )
    }

    @Test
    fun `takes the meeting name from the first heading`() {
        assertEquals("Weekly sync", ActionItems.title(note))
    }

    @Test
    fun `a note without checkboxes yields nothing`() {
        assertEquals(emptyList<ActionItem>(), ActionItems.parse("<p>Transcript: hello</p><ul><li>hi</li></ul>"))
    }

    private fun user(name: String, email: String) = User(id = UUID.randomUUID(), email = email, passwordHash = "h", name = name)
    private val anna = user("Anna Berg", "anna@x.io")
    private val tom = user("Tom Klein", "tom@x.io")
    private val tomas = user("Tom Weiss", "weiss@x.io")

    @Test
    fun `matches an owner by full name, email or a first name only one member has`() {
        val members = listOf(anna, tom)
        assertEquals(anna, ActionItems.matchOwner("anna berg", members))
        assertEquals(tom, ActionItems.matchOwner("TOM@x.io", members))
        assertEquals(anna, ActionItems.matchOwner("Anna", members))
    }

    @Test
    fun `leaves an ambiguous or unknown owner unassigned`() {
        assertNull(ActionItems.matchOwner("Tom", listOf(tom, tomas)))
        assertNull(ActionItems.matchOwner("Petra", listOf(anna, tom)))
        assertNull(ActionItems.matchOwner(null, listOf(anna)))
    }
}

package com.docuvault.service.task

import com.docuvault.domain.user.User
import org.jsoup.Jsoup

data class ActionItem(val title: String, val owner: String?)

/**
 * Reads the action items out of a meeting note. The meeting bot writes them as
 * Markdown checkboxes (`- [ ] Task — Owner`), which arrive here as HTML list
 * items holding a checkbox. Ticked items are already done and are skipped. The
 * section heading differs by language, so the checkboxes are what is looked for.
 */
object ActionItems {
    private val OWNER_SEPARATOR = Regex("\\s+[—–]\\s+")
    private const val MAX_TITLE = 500

    fun parse(html: String): List<ActionItem> =
        Jsoup.parse(html).select("li")
            .filter { li -> li.selectFirst("> input[type=checkbox]:not([checked])") != null }
            .mapNotNull { li ->
                val parts = li.text().trim().split(OWNER_SEPARATOR)
                val title = parts.first().trim().take(MAX_TITLE)
                if (title.isEmpty()) null
                else ActionItem(title, parts.getOrNull(1)?.trim()?.ifEmpty { null })
            }

    /** The first heading of the note, which the bot fills with the meeting's name. */
    fun title(html: String): String? = Jsoup.parse(html).selectFirst("h1, h2")?.text()?.trim()?.ifEmpty { null }

    /**
     * The member an owner written in free text most likely means: an exact name
     * or email first, then a first name that only one member has. Anything
     * vaguer stays unassigned rather than landing on the wrong person.
     */
    fun matchOwner(owner: String?, members: List<User>): User? {
        val wanted = owner?.trim()?.lowercase()?.ifEmpty { null } ?: return null
        members.firstOrNull { it.name.lowercase() == wanted || it.email.lowercase() == wanted }?.let { return it }
        val byFirstName = members.filter { it.name.substringBefore(' ').lowercase() == wanted }
        return byFirstName.singleOrNull()
    }
}

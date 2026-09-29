package com.docuvault.service.ai

import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.ai.MessageSource
import com.docuvault.infrastructure.repository.ConversationMessageRepository
import com.docuvault.infrastructure.repository.ConversationRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.branding.BrandingService
import com.docuvault.service.embedding.EmbeddingService
import com.docuvault.service.git.GitService
import com.docuvault.service.tools.ToolRegistry
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import java.util.*

/** Retrieval always finds something; the sources under an answer should be what it used. */
class ConversationSourcesTest {

    private val service = ConversationService(
        mock(OpenAIProvider::class.java), mock(EmbeddingService::class.java), mock(ConversationRepository::class.java),
        mock(ConversationMessageRepository::class.java), mock(UserRepository::class.java), mock(SpaceRepository::class.java),
        mock(PermissionService::class.java), mock(GitService::class.java), mock(ToolRegistry::class.java), ObjectMapper(),
        mock(DraftMaterialService::class.java), mock(AttachmentService::class.java), mock(BrandingService::class.java)
    )

    private val space = UUID.randomUUID()
    private fun chunk(path: String, title: String?) = MessageSource(space, path, title)

    private val fruit = chunk("ops/fruit-policy.md", "Fruit policy")
    private val onboarding = chunk("ops/onboarding-checklist.md", "Onboarding Checklist")

    @Test
    fun `keeps the documents the answer names, by path or by title`() {
        assertEquals(listOf("ops/fruit-policy.md"), service.retrievalSources(listOf(onboarding, fruit), "See ops/fruit-policy.md").map { it.path })
        assertEquals(listOf("ops/onboarding-checklist.md"), service.retrievalSources(listOf(fruit, onboarding), "The onboarding checklist says").map { it.path })
    }

    @Test
    fun `falls back to the best match when the answer names nothing`() {
        assertEquals(listOf("ops/fruit-policy.md"), service.retrievalSources(listOf(fruit, onboarding), "Mondays.").map { it.path })
    }

    @Test
    fun `an answer about attached files gets no stand-in source`() {
        assertEquals(emptyList<String>(), service.retrievalSources(listOf(fruit, onboarding), "Your note says to call the movers.", fallback = false).map { it.path })
        assertEquals(listOf("ops/fruit-policy.md"), service.retrievalSources(listOf(fruit), "As ops/fruit-policy.md says", fallback = false).map { it.path })
    }

    @Test
    fun `a search hit the answer names is a source, one it only saw is not`() {
        val importedData = chunk("developer-docs/imported-data.html", "ImportedData")
        val searched = listOf(fruit, importedData, onboarding)
        assertEquals(
            listOf("developer-docs/imported-data.html"),
            service.retrievalSources(searched, "Details in `developer-docs/imported-data.html`.").map { it.path }
        )
    }

    @Test
    fun `sources follow the order the answer names them in`() {
        assertEquals(
            listOf("ops/onboarding-checklist.md", "ops/fruit-policy.md"),
            service.retrievalSources(listOf(fruit, onboarding), "First ops/onboarding-checklist.md, then ops/fruit-policy.md").map { it.path }
        )
    }
}

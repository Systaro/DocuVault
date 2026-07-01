package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.docuvault.domain.space.Document
import com.docuvault.domain.space.DocumentTranslation
import com.docuvault.infrastructure.repository.DocumentTranslationRepository
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID
import kotlin.time.Duration.Companion.seconds

@Service
class TranslationService(
    private val openAIProvider: OpenAIProvider,
    private val translationRepository: DocumentTranslationRepository
) {
    private val logger = LoggerFactory.getLogger(TranslationService::class.java)

    // ISO 639-1 code -> human-readable name fed to the model. The frontend offers
    // exactly this set; keep the two in sync.
    private val supportedLanguages = linkedMapOf(
        "en" to "English",
        "de" to "German",
        "fr" to "French",
        "es" to "Spanish",
        "it" to "Italian"
    )

    fun isSupported(language: String): Boolean = supportedLanguages.containsKey(language)

    /** Cached translation languages for every translated document in the space, keyed by document path. */
    fun listLanguagesBySpace(spaceId: UUID): Map<String, List<String>> =
        translationRepository.findLanguagesBySpaceId(spaceId)
            .groupBy({ it.path }, { it.targetLanguage })
            .mapValues { it.value.sorted() }

    /** Cached translation languages for a single document. */
    fun listLanguagesForDocument(spaceId: UUID, path: String): List<String> =
        translationRepository.findLanguagesBySpaceIdAndPath(spaceId, path).sorted()

    /** Drop a document's cached translation for one language. Returns true if a row was removed. */
    @Transactional
    fun deleteTranslation(spaceId: UUID, path: String, targetLanguage: String): Boolean =
        translationRepository.deleteBySpaceIdAndPathAndTargetLanguage(spaceId, path, targetLanguage) > 0

    /**
     * Return a cached translation when the source is unchanged, otherwise translate
     * via the configured chat model and upsert the cache. Returns null when AI is
     * not configured or the translation call fails.
     */
    @Transactional
    fun getOrCreateTranslation(
        document: Document,
        sourceContent: String,
        sourceContentHash: String,
        targetLanguage: String
    ): TranslationResult? {
        val languageName = supportedLanguages[targetLanguage] ?: return null
        val documentId = document.id ?: return null

        val existing = translationRepository.findByDocumentIdAndTargetLanguage(documentId, targetLanguage)
        if (existing != null && existing.sourceContentHash == sourceContentHash) {
            return TranslationResult(targetLanguage, existing.translatedContent, cached = true)
        }

        val translated = translate(sourceContent, languageName) ?: return null

        val entity = if (existing != null) {
            existing.translatedContent = translated
            existing.sourceContentHash = sourceContentHash
            existing.createdAt = Instant.now()
            existing
        } else {
            DocumentTranslation(
                document = document,
                targetLanguage = targetLanguage,
                sourceContentHash = sourceContentHash,
                translatedContent = translated
            )
        }
        translationRepository.save(entity)

        return TranslationResult(targetLanguage, translated, cached = false)
    }

    private fun translate(content: String, languageName: String): String? {
        // Whole-document translation generates a large response in one shot, so allow a
        // far longer window than interactive AI calls (which use the 60s default).
        val openAI = openAIProvider.getClient(socketTimeout = 240.seconds) ?: return null

        val systemPrompt = """
            |You are a professional translator for technical documentation.
            |Translate the user's Markdown document into $languageName.
            |
            |Rules:
            |- Preserve all Markdown structure exactly: headings, lists, tables, blockquotes, links, images and any raw HTML.
            |- Do NOT translate code: leave fenced/inline code, identifiers, file paths, URLs and commands unchanged.
            |- Keep link targets and image paths unchanged; you may translate visible link text and image alt text.
            |- Do not add, remove or summarise content.
            |- Return ONLY the translated Markdown, with no commentary, preamble or code fences around the whole document.
        """.trimMargin()

        return runBlocking {
            try {
                val completion = openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getChatModel()),
                        messages = listOf(
                            ChatMessage(role = ChatRole.System, content = systemPrompt),
                            ChatMessage(role = ChatRole.User, content = content)
                        ),
                        maxTokens = maxTokensForModel(4000)
                    )
                )
                completion.choices.firstOrNull()?.message?.content?.trim()
            } catch (e: Exception) {
                logger.error("Translation call failed", e)
                null
            }
        }
    }

    private fun maxTokensForModel(tokens: Int): Int? {
        val model = openAIProvider.getChatModel()
        return if (model.startsWith("gpt-5")) null else tokens
    }
}

data class TranslationResult(
    val targetLanguage: String,
    val content: String,
    val cached: Boolean
)

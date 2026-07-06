package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

@Service
class WritingAssistantService(
    private val openAIProvider: OpenAIProvider
) {
    private val logger = LoggerFactory.getLogger(WritingAssistantService::class.java)

    private fun maxTokensForModel(tokens: Int): Int? {
        val model = openAIProvider.getChatModel()
        return if (model.startsWith("gpt-5")) null else tokens
    }

    fun suggest(context: String, cursorPosition: Int, type: SuggestionType): String? {
        val openAI = openAIProvider.getClient() ?: return null

        val prompt = when (type) {
            SuggestionType.AUTOCOMPLETE -> buildAutocompletePrompt(context, cursorPosition)
            SuggestionType.IMPROVE -> buildImprovePrompt(context)
            SuggestionType.EXPAND -> buildExpandPrompt(context)
            SuggestionType.SUMMARIZE -> buildSummarizePrompt(context)
            SuggestionType.FIX_GRAMMAR -> buildGrammarPrompt(context)
        }

        return runBlocking {
            try {
                val completion = openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getChatModel()),
                        messages = listOf(
                            ChatMessage(
                                role = ChatRole.System,
                                content = "You are a technical writing assistant. Provide concise, helpful suggestions for documentation."
                            ),
                            ChatMessage(role = ChatRole.User, content = prompt)
                        ),
                        maxTokens = maxTokensForModel(500)
                    )
                )
                completion.choices.firstOrNull()?.message?.content
            } catch (e: Exception) {
                logger.error("Writing-assistant improve call failed", e)
                null
            }
        }
    }

    fun generateContent(prompt: String, documentContext: String?): String? {
        val openAI = openAIProvider.getClient() ?: return null

        val systemPrompt = if (documentContext != null) {
            """You are a technical documentation writer. Generate clear, well-structured documentation content.
            |
            |Current document context:
            |$documentContext
            """.trimMargin()
        } else {
            "You are a technical documentation writer. Generate clear, well-structured documentation content in Markdown format."
        }

        return runBlocking {
            try {
                val completion = openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getChatModel()),
                        messages = listOf(
                            ChatMessage(role = ChatRole.System, content = systemPrompt),
                            ChatMessage(role = ChatRole.User, content = prompt)
                        ),
                        maxTokens = maxTokensForModel(1000)
                    )
                )
                completion.choices.firstOrNull()?.message?.content
            } catch (e: Exception) {
                logger.error("Writing-assistant generateContent call failed", e)
                null
            }
        }
    }

    /**
     * Applies a free-form edit instruction to a whole document and returns the
     * complete updated content, or null when AI is unconfigured or the call fails.
     */
    fun editDocument(fileName: String, content: String, instruction: String): String? {
        val openAI = openAIProvider.getClient() ?: return null

        val systemPrompt = """You are a precise document editor.
            |You receive the full content of a file and an edit instruction.
            |Apply the instruction and return the COMPLETE updated file content.
            |Rules:
            |- Return ONLY the file content — no explanations, no surrounding markdown code fences.
            |- Preserve the file's format, style and structure except where the instruction requires changes.
            |- Leave parts of the document that are unrelated to the instruction unchanged.
            """.trimMargin()

        val userPrompt = """File name: $fileName
            |
            |Current file content:
            |$content
            |
            |Edit instruction: $instruction
            """.trimMargin()

        return runBlocking {
            try {
                val completion = openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getChatModel()),
                        messages = listOf(
                            ChatMessage(role = ChatRole.System, content = systemPrompt),
                            ChatMessage(role = ChatRole.User, content = userPrompt)
                        ),
                        maxTokens = maxTokensForModel(8000)
                    )
                )
                completion.choices.firstOrNull()?.message?.content?.let { stripCodeFence(it) }
            } catch (e: Exception) {
                logger.error("Writing-assistant editDocument call failed", e)
                null
            }
        }
    }

    /** Unwraps a response the model wrapped in a single ```-fenced block despite instructions. */
    private fun stripCodeFence(response: String): String {
        val trimmed = response.trim()
        if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) return trimmed
        val withoutOpening = trimmed.substringAfter('\n', "")
        if (withoutOpening.isEmpty()) return trimmed
        return withoutOpening.removeSuffix("```").trimEnd('\n')
    }

    private fun buildAutocompletePrompt(context: String, cursorPosition: Int): String {
        val beforeCursor = context.take(cursorPosition)
        val afterCursor = context.drop(cursorPosition)
        return """Continue the following documentation text naturally. Only provide the continuation, not the existing text.

Text before cursor:
$beforeCursor

Text after cursor:
$afterCursor

Continue from where the cursor is:"""
    }

    private fun buildImprovePrompt(context: String): String {
        return """Improve the following documentation text. Make it clearer, more professional, and better structured. Return only the improved text.

Original text:
$context"""
    }

    private fun buildExpandPrompt(context: String): String {
        return """Expand the following documentation with more details, examples, or explanations. Return the expanded version.

Original text:
$context"""
    }

    private fun buildSummarizePrompt(context: String): String {
        return """Summarize the following documentation text concisely. Return only the summary.

Text to summarize:
$context"""
    }

    private fun buildGrammarPrompt(context: String): String {
        return """Fix any grammar, spelling, or punctuation errors in the following text. Return only the corrected text.

Text to correct:
$context"""
    }
}

enum class SuggestionType {
    AUTOCOMPLETE,
    IMPROVE,
    EXPAND,
    SUMMARIZE,
    FIX_GRAMMAR
}

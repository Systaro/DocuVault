package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatResponseFormat
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.aallam.openai.client.OpenAI
import com.docuvault.config.OpenAIProvider
import com.docuvault.service.DocumentPatchService
import com.docuvault.service.PatchOperation
import com.fasterxml.jackson.databind.ObjectMapper
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import kotlin.time.Duration.Companion.seconds

/** Outcome of an AI document edit. Only [Success] is ever written to a file. */
sealed interface DocumentEditResult {
    data class Success(val content: String, val strategy: Strategy) : DocumentEditResult
    /** No API key — the feature is off for this install. */
    data object NotConfigured : DocumentEditResult
    /** The edit did not happen, with a reason meant for the person who asked. */
    data class Failed(val message: String) : DocumentEditResult

    enum class Strategy { PATCH, REWRITE }
}

@Service
class WritingAssistantService(
    private val openAIProvider: OpenAIProvider,
    private val documentPatchService: DocumentPatchService,
    private val objectMapper: ObjectMapper
) {
    private val logger = LoggerFactory.getLogger(WritingAssistantService::class.java)

    private companion object {
        /** Generous, because a whole-file rewrite of a long page legitimately takes minutes. */
        val EDIT_SOCKET_TIMEOUT = 240.seconds
        const val FINISH_REASON_LENGTH = "length"
        const val MAX_PATCH_OPERATIONS = DocumentPatchService.MAX_OPERATIONS
    }

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
    /**
     * Applies [instruction] to [content] and returns the edited document.
     *
     * Two strategies, in order. **Patch** asks the model for the specific text
     * replacements the instruction calls for; the reply is a few hundred tokens
     * whatever the file's size, and everything the model did not name stays
     * byte-identical. **Rewrite** asks for the whole file back — the only way
     * to serve an instruction that genuinely touches everything ("translate
     * this page"), and the reason this used to fail: re-emitting an 85 KB page
     * is tens of thousands of generated tokens, which outruns any sane socket
     * timeout on a non-streaming call. The rewrite therefore streams, so the
     * connection never sits idle waiting for one large response.
     */
    fun editDocument(fileName: String, content: String, instruction: String): DocumentEditResult {
        val model = openAIProvider.getEditModel()
        val openAI = openAIProvider.getClient(socketTimeout = EDIT_SOCKET_TIMEOUT)
            ?: return DocumentEditResult.NotConfigured

        return runBlocking {
            // The model corrects one failed patch attempt before we give up on
            // the strategy: a near-miss anchor is its most common mistake, and
            // the failure names the operation precisely enough to fix.
            var correction: String? = null
            repeat(2) {
                val reply = try {
                    requestPatch(openAI, model, fileName, content, instruction, correction)
                } catch (e: Exception) {
                    logger.warn("AI edit: patch request failed, falling back to a full rewrite", e)
                    return@repeat
                }

                when (reply) {
                    is PatchReply.Truncated -> return@repeat
                    is PatchReply.NotApplicable -> return@repeat
                    is PatchReply.Unparseable -> {
                        correction = "Your last reply was not valid JSON of the required shape. " +
                            "Reply with only the JSON object."
                    }
                    is PatchReply.Operations -> {
                        when (val patched = documentPatchService.apply(content, reply.operations)) {
                            is DocumentPatchService.Result.Applied ->
                                return@runBlocking DocumentEditResult.Success(
                                    patched.content,
                                    DocumentEditResult.Strategy.PATCH
                                )
                            is DocumentPatchService.Result.Failed -> {
                                logger.info("AI edit: patch rejected ({}), retrying", patched.error)
                                correction = "The edit was rejected: ${patched.message} " +
                                    "Copy 'oldText' character for character out of the file, including " +
                                    "whitespace and indentation, and include enough surrounding text to " +
                                    "make it unique."
                            }
                        }
                    }
                }
            }

            rewriteWholeDocument(openAI, model, fileName, content, instruction)
        }
    }

    internal sealed interface PatchReply {
        data class Operations(val operations: List<PatchOperation>) : PatchReply
        /** The model judged the instruction too broad for targeted edits. */
        data object NotApplicable : PatchReply
        data object Unparseable : PatchReply
        data object Truncated : PatchReply
    }

    private suspend fun requestPatch(
        openAI: OpenAI,
        model: String,
        fileName: String,
        content: String,
        instruction: String,
        correction: String?
    ): PatchReply {
        val systemPrompt = """You are a precise document editor. You receive a file and an edit instruction,
            |and you reply with the specific edits to make — never with the whole file.
            |
            |Reply with a JSON object of this shape and nothing else:
            |{"operations": [
            |  {"op": "replace", "oldText": "<exact text from the file>", "newText": "<replacement>"},
            |  {"op": "insert", "content": "<new text>", "after": "<exact anchor text>"}
            |]}
            |
            |Rules:
            |- "oldText" and any anchor MUST be copied character for character out of the file,
            |  including whitespace, indentation and HTML entities.
            |- Include enough surrounding text that the anchor occurs exactly ONCE in the file.
            |  If you intend to change every occurrence, add "replaceAll": true instead.
            |- Make the smallest edits that satisfy the instruction. Never reformat, reindent or
            |  "improve" anything the instruction did not ask about.
            |- At most $MAX_PATCH_OPERATIONS operations.
            |- If the instruction cannot be expressed as targeted edits because it rewrites the whole
            |  document, reply with {"operations": []} instead.
            """.trimMargin()

        val userPrompt = buildString {
            append("File name: ").append(fileName).append("\n\n")
            append("File content:\n").append(content).append("\n\n")
            append("Edit instruction: ").append(instruction)
            if (correction != null) append("\n\nYour previous reply was not usable. ").append(correction)
        }

        val completion = openAI.chatCompletion(
            ChatCompletionRequest(
                model = ModelId(model),
                messages = listOf(
                    ChatMessage(role = ChatRole.System, content = systemPrompt),
                    ChatMessage(role = ChatRole.User, content = userPrompt)
                ),
                responseFormat = ChatResponseFormat.JsonObject
            )
        )

        val choice = completion.choices.firstOrNull() ?: return PatchReply.Unparseable
        if (choice.finishReason?.value == FINISH_REASON_LENGTH) return PatchReply.Truncated
        val reply = choice.message.content?.takeIf { it.isNotBlank() } ?: return PatchReply.Unparseable
        return parseOperations(reply)
    }

    /** Turns the model's JSON reply into operations, or says why it cannot. */
    internal fun parseOperations(reply: String): PatchReply {
        val root = try {
            objectMapper.readTree(stripCodeFence(reply))
        } catch (_: Exception) {
            return PatchReply.Unparseable
        }
        // A model that ignores the wrapper and returns the bare array is still
        // saying something useful.
        val operationsNode = when {
            root.isArray -> root
            root.has("operations") && root.get("operations").isArray -> root.get("operations")
            else -> return PatchReply.Unparseable
        }
        if (operationsNode.isEmpty) return PatchReply.NotApplicable

        val operations = operationsNode.mapNotNull { node ->
            val op = node.get("op")?.asText() ?: return@mapNotNull null
            PatchOperation(
                op = op,
                oldText = node.get("oldText")?.asText(),
                newText = node.get("newText")?.asText(),
                content = node.get("content")?.asText(),
                after = node.get("after")?.asText(),
                before = node.get("before")?.asText(),
                replaceAll = node.get("replaceAll")?.asBoolean() ?: false
            )
        }
        return if (operations.isEmpty()) PatchReply.Unparseable else PatchReply.Operations(operations)
    }

    /**
     * The whole-file fallback. Streamed: a non-streaming call leaves the socket
     * idle for as long as the model needs to produce the entire document, which
     * is what the 60s default timeout used to cut off.
     */
    private suspend fun rewriteWholeDocument(
        openAI: OpenAI,
        model: String,
        fileName: String,
        content: String,
        instruction: String
    ): DocumentEditResult {
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

        val edited = StringBuilder()
        var finishReason: String? = null
        try {
            openAI.chatCompletions(
                ChatCompletionRequest(
                    model = ModelId(model),
                    messages = listOf(
                        ChatMessage(role = ChatRole.System, content = systemPrompt),
                        ChatMessage(role = ChatRole.User, content = userPrompt)
                    )
                )
            ).collect { chunk ->
                chunk.choices.firstOrNull()?.let { choice ->
                    choice.delta?.content?.let { edited.append(it) }
                    choice.finishReason?.value?.let { finishReason = it }
                }
            }
        } catch (e: Exception) {
            logger.error("AI edit: full rewrite failed", e)
            return DocumentEditResult.Failed(
                "The AI did not finish editing this document in time. It is a large file — " +
                    "try an instruction that names the specific passages to change."
            )
        }

        // Committing a completion that stopped mid-document would truncate the
        // file. Nothing about the response says "incomplete" except this.
        if (finishReason == FINISH_REASON_LENGTH) {
            return DocumentEditResult.Failed(
                "The AI ran out of room before it finished this document, so nothing was saved. " +
                    "Try an instruction that names the specific passages to change."
            )
        }
        val result = stripCodeFence(edited.toString())
        if (result.isBlank()) {
            return DocumentEditResult.Failed("The AI returned an empty document, so nothing was saved.")
        }
        return DocumentEditResult.Success(result, DocumentEditResult.Strategy.REWRITE)
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

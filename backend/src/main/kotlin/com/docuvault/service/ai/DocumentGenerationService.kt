package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatResponseFormat
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.model.ModelId
import com.docuvault.config.OpenAIProvider
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.LocalDate
import kotlin.time.Duration.Companion.seconds

/** The shape a generated document takes when no example document is given. */
enum class DocumentLayout(val instruction: String) {
    AUTO("Choose the structure that fits the material best."),
    MEETING_NOTES(
        "Meeting notes. Sections: Date and participants, Topics, Decisions, " +
            "Action items (with owner and due date where the material names them), Open questions."
    ),
    SUMMARY("A concise summary. Sections: Overview in two or three sentences, Key points, Open questions or next steps."),
    HOW_TO("A how-to guide. Sections: Purpose, Prerequisites, Steps as a numbered list, Troubleshooting where the material covers it.")
}

enum class DocumentFormat(val extension: String) {
    MARKDOWN("md"), HTML("html");

    companion object {
        fun forExample(examplePath: String?): DocumentFormat =
            if (examplePath?.substringAfterLast('.')?.lowercase() in setOf("html", "htm")) HTML else MARKDOWN
    }
}

/** An existing document whose structure the new one copies. */
data class ExampleDocument(val path: String, val content: String)

data class GenerationInput(
    /** What the user pasted or dictated: a transcript, a mail, notes, an instruction. */
    val material: String,
    val layout: DocumentLayout,
    val example: ExampleDocument?,
    /** The folder the document goes into, "" for the space root. */
    val folder: String,
    /** Names of the files already in that folder, so the new name follows their convention. */
    val siblingNames: List<String>
)

sealed interface DocumentGenerationResult {
    /** [fileName] is sanitised and carries no extension; the caller picks a free path. */
    data class Success(val title: String, val fileName: String, val content: String) : DocumentGenerationResult
    data object NotConfigured : DocumentGenerationResult
    data class Failed(val message: String) : DocumentGenerationResult
}

/**
 * Writes a new document from loose material (a transcript, an email, notes)
 * and names it. Nothing is saved here: the caller decides the path and writes
 * the file through the normal document write path.
 */
@Service
class DocumentGenerationService(
    private val openAIProvider: OpenAIProvider,
    private val objectMapper: ObjectMapper
) {
    private val logger = LoggerFactory.getLogger(DocumentGenerationService::class.java)

    companion object {
        const val MAX_MATERIAL_CHARS = 120_000
        private const val MAX_EXAMPLE_CHARS = 40_000
        private const val MAX_SIBLINGS = 40
        private const val MAX_FILE_NAME_CHARS = 80
        /** A long transcript turned into a long page takes minutes, like a whole-file AI edit. */
        private val SOCKET_TIMEOUT = 240.seconds
        private const val FINISH_REASON_LENGTH = "length"
    }

    fun generate(input: GenerationInput): DocumentGenerationResult {
        val openAI = openAIProvider.getClient(socketTimeout = SOCKET_TIMEOUT)
            ?: return DocumentGenerationResult.NotConfigured
        val format = DocumentFormat.forExample(input.example?.path)

        val reply = try {
            runBlocking {
                openAI.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(openAIProvider.getEditModel()),
                        messages = listOf(
                            ChatMessage(role = ChatRole.System, content = systemPrompt(input, format)),
                            ChatMessage(role = ChatRole.User, content = input.material.take(MAX_MATERIAL_CHARS))
                        ),
                        responseFormat = ChatResponseFormat.JsonObject
                    )
                )
            }
        } catch (e: Exception) {
            logger.warn("AI document generation failed", e)
            return DocumentGenerationResult.Failed("The AI did not answer in time. Please try again.")
        }

        val choice = reply.choices.firstOrNull()
            ?: return DocumentGenerationResult.Failed("The AI returned nothing. Please try again.")
        if (choice.finishReason?.value == FINISH_REASON_LENGTH) {
            return DocumentGenerationResult.Failed("The document came out too long. Shorten the material or split it up.")
        }
        return parseReply(choice.message.content.orEmpty())
    }

    internal fun parseReply(reply: String): DocumentGenerationResult {
        val root = runCatching { objectMapper.readTree(reply.trim()) }.getOrNull()?.takeIf { it.isObject }
            ?: return DocumentGenerationResult.Failed("The AI reply could not be read. Please try again.")
        val content = root.text("content")?.trim()?.ifEmpty { null }
            ?: return DocumentGenerationResult.Failed("The AI wrote an empty document. Add more material and try again.")
        val title = root.text("title")?.trim()?.take(200)?.ifEmpty { null } ?: "Untitled"
        val fileName = sanitizeFileName(root.text("fileName"))
            ?: sanitizeFileName(title)
            ?: "untitled"
        return DocumentGenerationResult.Success(title, fileName, content + "\n")
    }

    /**
     * A single file name segment without extension: no path separators, no
     * leading dots, no control characters. Letters of any script stay, so a
     * German title keeps its umlauts. Null when nothing usable is left.
     */
    internal fun sanitizeFileName(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val withoutExtension = raw.trim().replace(Regex("\\.(md|markdown|html?|txt)$", RegexOption.IGNORE_CASE), "")
        return withoutExtension
            .replace(Regex("[/\\\\]"), "-")
            .replace(Regex("[\\p{Cntrl}<>:\"|?*#%]"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
            .trimStart('.', '-', ' ')
            .take(MAX_FILE_NAME_CHARS)
            .trimEnd('.', '-', ' ')
            .ifEmpty { null }
    }

    /** "<folder>/<name>.<ext>", counting up ("name-2") until [exists] says the path is free. */
    fun freePath(folder: String, fileName: String, format: DocumentFormat, exists: (String) -> Boolean): String {
        val prefix = folder.trim('/').let { if (it.isEmpty()) "" else "$it/" }
        var candidate = "$prefix$fileName.${format.extension}"
        var n = 2
        while (exists(candidate)) {
            candidate = "$prefix$fileName-$n.${format.extension}"
            n++
        }
        return candidate
    }

    private fun systemPrompt(input: GenerationInput, format: DocumentFormat): String {
        val structure = input.example?.let { example ->
            """
            |Structure: follow the example document below exactly. Keep its headings in the same order, its tables,
            |fields and formatting conventions, and its language. Replace its content with what the material says.
            |Where the material says nothing about a field, leave it empty instead of inventing something.
            |
            |Example document (${example.path}):
            |<<<
            |${example.content.take(MAX_EXAMPLE_CHARS)}
            |>>>
            """.trimMargin()
        } ?: "Structure: ${input.layout.instruction}"

        val formatRule = when (format) {
            DocumentFormat.MARKDOWN ->
                "Write GitHub-flavoured Markdown. Start with a level-1 heading carrying the title."
            DocumentFormat.HTML ->
                "Write a complete HTML document in the same style as the example, including its <head> and styles."
        }

        val siblings = input.siblingNames.take(MAX_SIBLINGS)
        return """
            |You write new documents for a team documentation tool from material the user hands you:
            |a meeting transcript, an email, notes, or just an instruction. The material follows as the user message.
            |If it contains an instruction about what to write, follow it.
            |
            |$structure
            |
            |$formatRule
            |Write in the language of the material unless the user asks for another one.
            |Use only facts from the material. Keep names, dates, numbers and quotes exactly as given. Today is ${LocalDate.now()}.
            |
            |The document goes into the folder "${input.folder.ifEmpty { "(space root)" }}".
            |Files already there: ${if (siblings.isEmpty()) "(none)" else siblings.joinToString(", ")}
            |Name the file the way those files are named (same pattern, casing, separators and language).
            |With no files to go by, use a short readable name in the language of the document.
            |
            |Reply with JSON only:
            |{"title": "<document title>", "fileName": "<file name without extension>", "content": "<the whole document>"}
        """.trimMargin()
    }

    private fun JsonNode.text(field: String): String? = get(field)?.takeIf { it.isTextual }?.asText()
}

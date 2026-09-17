package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletion
import com.aallam.openai.api.chat.ChatCompletionChunk
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.chat.FunctionCall
import com.aallam.openai.api.chat.ToolCall
import com.aallam.openai.api.chat.ToolId

/** One model round: the text it wrote and the tools it asked for. */
data class AssistantRound(val text: String, val toolCalls: List<ToolCall.Function>) {
    /** The round as the next request has to repeat it, so tool results can refer to its calls. */
    fun toMessage(): ChatMessage = ChatMessage(
        role = ChatRole.Assistant,
        content = text.ifEmpty { null },
        toolCalls = toolCalls.ifEmpty { null }
    )

    companion object {
        fun of(completion: ChatCompletion): AssistantRound {
            val message = completion.choices.firstOrNull()?.message
            return AssistantRound(
                text = message?.content.orEmpty(),
                toolCalls = message?.toolCalls.orEmpty().filterIsInstance<ToolCall.Function>()
            )
        }
    }
}

/**
 * Reassembles a streamed completion. Text arrives in pieces, and so does each
 * tool call: its id and name in the first chunk, its arguments spread over many,
 * all tied together only by the call's index.
 */
class CompletionAccumulator {
    private val text = StringBuilder()
    private val calls = sortedMapOf<Int, PartialCall>()

    private class PartialCall {
        var id: String? = null
        val name = StringBuilder()
        val arguments = StringBuilder()
    }

    /** Takes one chunk and returns the text it added, if any. */
    fun add(chunk: ChatCompletionChunk): String? {
        val delta = chunk.choices.firstOrNull()?.delta ?: return null
        delta.toolCalls?.forEach { part ->
            val call = calls.getOrPut(part.index) { PartialCall() }
            part.id?.let { call.id = it.id }
            part.function?.nameOrNull?.let { call.name.append(it) }
            part.function?.argumentsOrNull?.let { call.arguments.append(it) }
        }
        val piece = delta.content?.takeIf { it.isNotEmpty() } ?: return null
        text.append(piece)
        return piece
    }

    fun result(): AssistantRound = AssistantRound(
        text = text.toString(),
        toolCalls = calls.values
            .filter { it.id != null && it.name.isNotEmpty() }
            .map { ToolCall.Function(id = ToolId(it.id!!), function = FunctionCall(it.name.toString(), it.arguments.toString())) }
    )
}

package com.docuvault.service.ai

import com.aallam.openai.api.chat.ChatCompletionChunk
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** Chunks in the shape the OpenAI streaming API sends them. */
class CompletionAccumulatorTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun chunk(delta: String): ChatCompletionChunk = json.decodeFromString(
        """{"id":"c","created":0,"model":"m","choices":[{"index":0,"delta":$delta,"finish_reason":null}]}"""
    )

    @Test
    fun `joins streamed text and reports each new piece`() {
        val acc = CompletionAccumulator()

        assertEquals("Hel", acc.add(chunk("""{"role":"assistant","content":"Hel"}""")))
        assertEquals("lo", acc.add(chunk("""{"content":"lo"}""")))
        assertNull(acc.add(chunk("""{}""")))

        assertEquals("Hello", acc.result().text)
        assertEquals(0, acc.result().toolCalls.size)
    }

    @Test
    fun `reassembles tool calls whose arguments arrive in pieces`() {
        val acc = CompletionAccumulator()
        acc.add(chunk("""{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_document","arguments":""}}]}"""))
        acc.add(chunk("""{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"search_by_keyword","arguments":"{\"query\":"}}]}"""))
        acc.add(chunk("""{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]}"""))
        acc.add(chunk("""{"tool_calls":[{"index":0,"function":{"arguments":"\"a.md\"}"}}]}"""))
        acc.add(chunk("""{"tool_calls":[{"index":1,"function":{"arguments":"\"x\"}"}}]}"""))

        val calls = acc.result().toolCalls
        assertEquals(listOf("call_1", "call_2"), calls.map { it.id.id })
        assertEquals("read_document", calls[0].function.name)
        assertEquals("""{"path":"a.md"}""", calls[0].function.arguments)
        assertEquals("""{"query":"x"}""", calls[1].function.arguments)
    }
}

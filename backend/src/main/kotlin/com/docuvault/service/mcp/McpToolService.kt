package com.docuvault.service.mcp

import com.docuvault.service.tools.ToolCredential
import com.docuvault.service.tools.ToolException
import com.docuvault.service.tools.ToolRegistry
import com.docuvault.service.tools.ToolScope
import com.fasterxml.jackson.databind.node.ObjectNode
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

data class ToolDescriptor(val name: String, val description: String, val inputSchema: Map<String, Any>)

/** The MCP face of [ToolRegistry]: every tool, across every space the caller's token can read. */
@Service
class McpToolService(private val registry: ToolRegistry) {

    private val logger = LoggerFactory.getLogger(McpToolService::class.java)

    fun listTools(ctx: McpContext): List<ToolDescriptor> {
        val catalog = runCatching { registry.spaceCatalog(session(ctx)) }.getOrDefault("")
        return registry.mcpTools().map { tool ->
            val description = if (tool.name == "search_documentation") tool.description + catalog else tool.description
            ToolDescriptor(tool.name, description, tool.inputSchema)
        }
    }

    fun callTool(ctx: McpContext, name: String, arguments: ObjectNode): Map<String, Any> {
        val tool = registry.mcpTool(name) ?: throw McpInvalidParamsException("Unknown tool: $name")
        return try {
            textResult(tool.handler(session(ctx), arguments), isError = false)
        } catch (e: ToolException) {
            textResult(e.message ?: "Tool failed", isError = true)
        } catch (e: Exception) {
            logger.warn("MCP tool $name failed for ${ctx.user.email}: ${e.message}", e)
            textResult("Tool failed: ${e.message}", isError = true)
        }
    }

    private fun session(ctx: McpContext) =
        registry.session(ToolCredential.authorization(ctx.authorizationHeader), ToolScope.Unrestricted)

    private fun textResult(text: String, isError: Boolean): Map<String, Any> =
        mapOf("content" to listOf(mapOf("type" to "text", "text" to text)), "isError" to isError)
}

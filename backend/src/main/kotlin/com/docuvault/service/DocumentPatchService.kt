package com.docuvault.service

import org.springframework.stereotype.Service

/**
 * A single edit to a document, expressed as text rather than as coordinates.
 *
 * `replace` swaps [oldText] for [newText]; `insert` places [content] at
 * `START`/`END` or next to the anchor in [after] / [before].
 */
data class PatchOperation(
    val op: String,
    val oldText: String? = null,
    val newText: String? = null,
    val content: String? = null,
    val after: String? = null,
    val before: String? = null,
    val replaceAll: Boolean? = false
)

/**
 * Applies text operations to a document.
 *
 * Anchoring by exact text is what makes a patch safe to apply to a file nobody
 * has re-read: an anchor that no longer exists, or that now matches in two
 * places, fails loudly instead of editing the wrong spot. Every failure names
 * the operation that caused it so the caller — an MCP client, or the model
 * that produced the patch — can correct that one operation and retry.
 */
@Service
class DocumentPatchService {

    sealed interface Result {
        data class Applied(val content: String) : Result
        data class Failed(
            val error: String,
            val message: String,
            val operationIndex: Int? = null,
            val occurrences: Int? = null
        ) : Result
    }

    companion object {
        const val MAX_OPERATIONS = 20
    }

    fun apply(currentContent: String, operations: List<PatchOperation>): Result {
        if (operations.isEmpty()) {
            return Result.Failed("INVALID_REQUEST", "At least one operation is required")
        }
        if (operations.size > MAX_OPERATIONS) {
            return Result.Failed("INVALID_REQUEST", "Maximum $MAX_OPERATIONS operations per request")
        }

        var content = currentContent
        for ((index, op) in operations.withIndex()) {
            when (op.op) {
                "replace" -> {
                    if (op.oldText == null || op.newText == null) {
                        return Result.Failed(
                            "INVALID_OPERATION",
                            "Operation $index: 'replace' requires 'oldText' and 'newText'",
                            index
                        )
                    }
                    if (op.oldText == op.newText) {
                        return Result.Failed(
                            "INVALID_OPERATION",
                            "Operation $index: 'oldText' and 'newText' must be different",
                            index
                        )
                    }
                    val occurrences = countOccurrences(content, op.oldText)
                    if (occurrences == 0) {
                        return Result.Failed(
                            "TEXT_NOT_FOUND",
                            "Operation $index: exact text not found in document",
                            index
                        )
                    }
                    if (occurrences > 1 && op.replaceAll != true) {
                        return Result.Failed(
                            "AMBIGUOUS_MATCH",
                            "Operation $index: text appears $occurrences times. " +
                                "Provide more context to make it unique, or set replaceAll: true.",
                            index,
                            occurrences
                        )
                    }
                    content = if (op.replaceAll == true) {
                        content.replace(op.oldText, op.newText)
                    } else {
                        content.replaceFirst(op.oldText, op.newText)
                    }
                }

                "insert" -> {
                    if (op.content == null) {
                        return Result.Failed(
                            "INVALID_OPERATION",
                            "Operation $index: 'insert' requires 'content'",
                            index
                        )
                    }
                    when {
                        op.after == "START" -> content = op.content + content
                        op.after == "END" || (op.after == null && op.before == null) -> content += op.content
                        op.after != null -> {
                            val pos = content.indexOf(op.after)
                            if (pos == -1) {
                                return Result.Failed(
                                    "TEXT_NOT_FOUND",
                                    "Operation $index: anchor text for 'after' not found",
                                    index
                                )
                            }
                            val insertPos = pos + op.after.length
                            content = content.substring(0, insertPos) + op.content + content.substring(insertPos)
                        }
                        op.before != null -> {
                            val pos = content.indexOf(op.before)
                            if (pos == -1) {
                                return Result.Failed(
                                    "TEXT_NOT_FOUND",
                                    "Operation $index: anchor text for 'before' not found",
                                    index
                                )
                            }
                            content = content.substring(0, pos) + op.content + content.substring(pos)
                        }
                    }
                }

                else -> return Result.Failed(
                    "INVALID_OPERATION",
                    "Operation $index: unknown operation '${op.op}'. Supported: 'replace', 'insert'",
                    index
                )
            }
        }
        return Result.Applied(content)
    }

    private fun countOccurrences(text: String, search: String): Int {
        if (search.isEmpty()) return 0
        var count = 0
        var startIndex = 0
        while (true) {
            val index = text.indexOf(search, startIndex)
            if (index == -1) break
            count++
            startIndex = index + 1
        }
        return count
    }
}

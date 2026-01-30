package com.docuvault.api

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.http.Timeout
import com.aallam.openai.api.model.ModelId
import com.aallam.openai.client.OpenAI
import com.docuvault.service.SettingValue
import com.docuvault.service.SettingsService
import kotlinx.coroutines.runBlocking
import org.gitlab4j.api.GitLabApi
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.*
import kotlin.time.Duration.Companion.seconds

@RestController
@RequestMapping("/settings")
@PreAuthorize("hasRole('SUPER_ADMIN')")
class SettingsController(
    private val settingsService: SettingsService
) {

    @GetMapping
    fun getSettings(): Map<String, SettingValue> {
        return settingsService.getAllSettingsForDisplay()
    }

    @PutMapping
    fun updateSettings(@RequestBody request: UpdateSettingsRequest): ResponseEntity<Map<String, String>> {
        // Only update non-null values (allows partial updates)
        request.gitlabUrl?.let {
            settingsService.set(SettingsService.GITLAB_URL, it)
        }
        request.gitlabToken?.let {
            settingsService.set(SettingsService.GITLAB_TOKEN, it, encrypted = true)
        }
        request.openaiApiKey?.let {
            settingsService.set(SettingsService.OPENAI_API_KEY, it, encrypted = true)
        }
        request.openaiChatModel?.let {
            settingsService.set(SettingsService.OPENAI_CHAT_MODEL, it)
        }
        request.openaiEmbeddingModel?.let {
            settingsService.set(SettingsService.OPENAI_EMBEDDING_MODEL, it)
        }

        return ResponseEntity.ok(mapOf("message" to "Settings updated successfully"))
    }

    @PostMapping("/test-gitlab")
    fun testGitlab(@RequestBody request: TestGitlabRequest): ResponseEntity<TestResult> {
        val url = request.url ?: settingsService.getGitlabUrl()
        val token = request.token ?: settingsService.getGitlabToken()

        if (url.isBlank() || token.isBlank()) {
            return ResponseEntity.ok(TestResult(
                success = false,
                message = "GitLab URL and token are required"
            ))
        }

        return try {
            val api = GitLabApi(url, token)
            val user = api.userApi.currentUser
            ResponseEntity.ok(TestResult(
                success = true,
                message = "Successfully connected to GitLab as ${user.username} (${user.email})"
            ))
        } catch (e: Exception) {
            ResponseEntity.ok(TestResult(
                success = false,
                message = "Failed to connect: ${e.message}"
            ))
        }
    }

    @PostMapping("/test-openai")
    fun testOpenai(@RequestBody request: TestOpenaiRequest): ResponseEntity<TestResult> {
        val apiKey = request.apiKey ?: settingsService.getOpenaiApiKey()
        val model = request.model ?: settingsService.getChatModel()

        if (apiKey.isBlank()) {
            return ResponseEntity.ok(TestResult(
                success = false,
                message = "OpenAI API key is required"
            ))
        }

        return try {
            val client = OpenAI(
                token = apiKey,
                timeout = Timeout(socket = 30.seconds)
            )

            val result = runBlocking {
                client.chatCompletion(
                    ChatCompletionRequest(
                        model = ModelId(model),
                        messages = listOf(
                            ChatMessage(
                                role = ChatRole.User,
                                content = "Say 'Hello' in one word."
                            )
                        ),
                        maxTokens = if (isGpt5Model(model)) null else 10
                    )
                )
            }

            val response = result.choices.firstOrNull()?.message?.content ?: "No response"
            ResponseEntity.ok(TestResult(
                success = true,
                message = "Successfully connected to OpenAI. Model: $model. Test response: $response"
            ))
        } catch (e: Exception) {
            val message = when {
                e.message?.contains("401") == true -> "Authentication failed. Please check your API key."
                e.message?.contains("429") == true -> "Rate limited. Please try again later."
                e.message?.contains("timeout") == true -> "Connection timed out. Please try again."
                else -> "Failed to connect: ${e.message?.take(200)}"
            }
            ResponseEntity.ok(TestResult(
                success = false,
                message = message
            ))
        }
    }
}

data class UpdateSettingsRequest(
    val gitlabUrl: String? = null,
    val gitlabToken: String? = null,
    val openaiApiKey: String? = null,
    val openaiChatModel: String? = null,
    val openaiEmbeddingModel: String? = null
)

data class TestGitlabRequest(
    val url: String? = null,
    val token: String? = null
)

data class TestOpenaiRequest(
    val apiKey: String? = null,
    val model: String? = null
)

data class TestResult(
    val success: Boolean,
    val message: String
)

fun isGpt5Model(model: String): Boolean {
    return model.startsWith("gpt-5")
}

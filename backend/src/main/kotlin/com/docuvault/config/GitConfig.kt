package com.docuvault.config

import com.docuvault.service.SettingsService
import org.gitlab4j.api.GitLabApi
import org.springframework.stereotype.Component

@Component
class GitLabApiProvider(
    private val settingsService: SettingsService
) {
    fun getApi(): GitLabApi? {
        val url = settingsService.getGitlabUrl()
        val token = settingsService.getGitlabToken()

        return if (token.isNotBlank()) {
            GitLabApi(url, token)
        } else {
            null
        }
    }

    fun isConfigured(): Boolean {
        return settingsService.getGitlabToken().isNotBlank()
    }

    fun testConnection(): Boolean {
        return try {
            getApi()?.userApi?.currentUser != null
        } catch (e: Exception) {
            false
        }
    }
}

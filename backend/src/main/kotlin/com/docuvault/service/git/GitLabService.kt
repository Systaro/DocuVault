package com.docuvault.service.git

import com.docuvault.config.GitLabApiProvider
import org.gitlab4j.api.models.Project
import org.springframework.stereotype.Service

@Service
class GitLabService(
    private val gitLabApiProvider: GitLabApiProvider
) {
    fun isConfigured(): Boolean = gitLabApiProvider.isConfigured()

    fun testConnection(): Boolean = gitLabApiProvider.testConnection()

    fun listProjects(): List<GitLabProject> {
        val api = gitLabApiProvider.getApi() ?: return emptyList()

        return try {
            api.projectApi.memberProjects
                .map { it.toGitLabProject() }
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }

    fun getProject(projectId: Int): GitLabProject? {
        val api = gitLabApiProvider.getApi() ?: return null

        return try {
            api.projectApi.getProject(projectId).toGitLabProject()
        } catch (e: Exception) {
            null
        }
    }

    fun getProjectBranches(projectId: Int): List<String> {
        val api = gitLabApiProvider.getApi() ?: return emptyList()

        return try {
            api.repositoryApi.getBranches(projectId)
                .map { it.name }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun Project.toGitLabProject() = GitLabProject(
        id = this.id.toInt(),
        name = this.name,
        path = this.pathWithNamespace,
        description = this.description,
        httpUrlToRepo = this.httpUrlToRepo,
        defaultBranch = this.defaultBranch ?: "main",
        visibility = this.visibility?.name ?: "private"
    )
}

data class GitLabProject(
    val id: Int,
    val name: String,
    val path: String,
    val description: String?,
    val httpUrlToRepo: String,
    val defaultBranch: String,
    val visibility: String
)

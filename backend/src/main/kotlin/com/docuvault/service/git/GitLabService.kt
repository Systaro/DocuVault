package com.docuvault.service.git

import com.docuvault.config.GitLabApiProvider
import org.gitlab4j.api.models.MergeRequest
import org.gitlab4j.api.models.MergeRequestParams
import org.gitlab4j.api.models.Project
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

@Service
class GitLabService(
    private val gitLabApiProvider: GitLabApiProvider
) {
    private val logger = LoggerFactory.getLogger(GitLabService::class.java)

    fun isConfigured(): Boolean = gitLabApiProvider.isConfigured()

    fun testConnection(): Boolean = gitLabApiProvider.testConnection()

    fun listProjects(): List<GitLabProject> {
        val api = gitLabApiProvider.getApi() ?: return emptyList()

        return try {
            api.projectApi.memberProjects
                .map { it.toGitLabProject() }
        } catch (e: Exception) {
            logger.error("Failed to list GitLab member projects", e)
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

    /**
     * Creates a merge request for a conflict-resolution branch.
     * Returns null if GitLab is not configured or the call fails.
     */
    fun createMergeRequest(
        projectId: Long,
        sourceBranch: String,
        targetBranch: String,
        title: String,
        description: String
    ): MergeRequest? {
        val api = gitLabApiProvider.getApi() ?: return null
        return try {
            val params = MergeRequestParams()
                .withSourceBranch(sourceBranch)
                .withTargetBranch(targetBranch)
                .withTitle(title)
                .withDescription(description)
                .withRemoveSourceBranch(true)
            api.mergeRequestApi.createMergeRequest(projectId, params)
        } catch (e: Exception) {
            logger.error("Failed to create MR for project $projectId ($sourceBranch → $targetBranch): ${e.message}", e)
            null
        }
    }

    /**
     * Fetches a merge request by project id and internal id.
     * Returns null if not found or on error.
     */
    fun getMergeRequest(projectId: Long, mergeRequestIid: Long): MergeRequest? {
        val api = gitLabApiProvider.getApi() ?: return null
        return try {
            api.mergeRequestApi.getMergeRequest(projectId, mergeRequestIid)
        } catch (e: Exception) {
            logger.warn("Failed to fetch MR !$mergeRequestIid for project $projectId: ${e.message}")
            null
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

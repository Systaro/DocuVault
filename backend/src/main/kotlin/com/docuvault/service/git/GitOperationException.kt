package com.docuvault.service.git

/**
 * Exception class for Git operations with detailed error codes and user-friendly messages.
 */
class GitOperationException(
    val errorCode: GitErrorCode,
    override val message: String,
    override val cause: Throwable? = null
) : RuntimeException(message, cause)

enum class GitErrorCode {
    // Configuration errors
    NOT_CONFIGURED,
    INVALID_URL,

    // Authentication errors
    AUTH_FAILED,
    TOKEN_EXPIRED,
    PERMISSION_DENIED,

    // Network errors
    NETWORK_ERROR,
    HOST_UNREACHABLE,
    CONNECTION_TIMEOUT,

    // Repository errors
    REPO_NOT_FOUND,
    BRANCH_NOT_FOUND,
    CLONE_FAILED,

    // Sync errors
    PULL_FAILED,
    PUSH_FAILED,
    MERGE_CONFLICT,

    // File system errors
    DISK_FULL,
    PATH_ERROR,

    // Unknown
    UNKNOWN_ERROR
}

/**
 * Extension to get a user-friendly message with setup guidance when needed.
 */
fun GitErrorCode.toUserMessage(): String = when (this) {
    GitErrorCode.NOT_CONFIGURED -> "Git is not configured. Please set up your GitLab connection in Admin Settings."
    GitErrorCode.INVALID_URL -> "The repository URL is invalid. Please check the Git URL format."
    GitErrorCode.AUTH_FAILED -> "Authentication failed. Please verify your GitLab token in Admin Settings."
    GitErrorCode.TOKEN_EXPIRED -> "Your GitLab token has expired. Please update it in Admin Settings."
    GitErrorCode.PERMISSION_DENIED -> "Access denied. You don't have permission to access this repository."
    GitErrorCode.NETWORK_ERROR -> "Network error. Please check your internet connection and try again."
    GitErrorCode.HOST_UNREACHABLE -> "Cannot reach GitLab server. Please verify the GitLab URL in Admin Settings."
    GitErrorCode.CONNECTION_TIMEOUT -> "Connection timed out. The server took too long to respond."
    GitErrorCode.REPO_NOT_FOUND -> "Repository not found. Please verify the repository exists and you have access."
    GitErrorCode.BRANCH_NOT_FOUND -> "Branch not found. Please check the branch name in workspace settings."
    GitErrorCode.CLONE_FAILED -> "Failed to clone repository. Please verify the URL and your access permissions."
    GitErrorCode.PULL_FAILED -> "Failed to pull changes. There may be local modifications conflicting with remote."
    GitErrorCode.PUSH_FAILED -> "Failed to push changes. You may not have write access to this repository."
    GitErrorCode.MERGE_CONFLICT -> "Merge conflict detected. Some files have conflicting changes that need manual resolution."
    GitErrorCode.DISK_FULL -> "Disk space is full. Please free up some space and try again."
    GitErrorCode.PATH_ERROR -> "Invalid file path. Please check the repository structure."
    GitErrorCode.UNKNOWN_ERROR -> "An unexpected error occurred. Please try again or contact support."
}

/**
 * Extension to check if this error suggests the user should configure Git.
 */
fun GitErrorCode.requiresSetup(): Boolean = when (this) {
    GitErrorCode.NOT_CONFIGURED,
    GitErrorCode.AUTH_FAILED,
    GitErrorCode.TOKEN_EXPIRED,
    GitErrorCode.HOST_UNREACHABLE -> true
    else -> false
}

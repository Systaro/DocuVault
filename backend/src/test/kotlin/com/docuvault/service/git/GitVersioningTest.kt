package com.docuvault.service.git

import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.service.SettingsService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.mock
import java.nio.file.Files
import java.nio.file.Path
import java.util.*

/**
 * Universal local versioning: spaces without a git remote get a lazily-initialized
 * local repository, every write commits, and the history endpoints read real
 * versions back out of it.
 */
class GitVersioningTest {

    @TempDir
    lateinit var reposDir: Path

    private fun services(): Pair<GitService, GitDiffService> {
        val gitService = GitService(reposDir.toString(), mock(SettingsService::class.java))
        return gitService to GitDiffService(gitService)
    }

    private fun localSpace() = Space(
        id = UUID.randomUUID(),
        name = "Local Space",
        slug = "local-space",
        createdBy = mock(User::class.java)
    )

    @Test
    fun `writes to a local space are versioned and readable per version`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        assertTrue(gitService.writeFile(space, "docs/a.md", "# A\n\nversion one"))
        gitService.commitAndPush(space, "Add docs/a.md", "Tester", "tester@example.com")

        assertTrue(gitService.writeFile(space, "docs/a.md", "# A\n\nversion two"))
        gitService.commitAndPush(space, "Update docs/a.md", "Tester", "tester@example.com")

        val history = diffService.fileHistory(space, "docs/a.md")
        assertEquals(2, history.size)
        assertEquals("Update docs/a.md", history[0].message)
        assertEquals("Add docs/a.md", history[1].message)
        assertEquals("Tester", history[0].authorName)

        assertEquals("# A\n\nversion one", diffService.fileAtCommit(space, history[1].sha, "docs/a.md"))
        assertEquals("# A\n\nversion two", diffService.fileAtCommit(space, history[0].sha, "docs/a.md"))
    }

    @Test
    fun `existing content is captured as a baseline before the first mutation`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        // Simulates a pre-versioning space: content on disk, no .git yet.
        val repoDir = gitService.getRepoPath(space.id!!)
        Files.createDirectories(repoDir.resolve("docs"))
        Files.writeString(repoDir.resolve("docs/old.md"), "original content")

        assertTrue(gitService.writeFile(space, "docs/old.md", "edited content"))
        gitService.commitAndPush(space, "Update docs/old.md", "Tester", "tester@example.com")

        val history = diffService.fileHistory(space, "docs/old.md")
        assertEquals(2, history.size)
        assertEquals("DocuVault: baseline snapshot of existing content", history[1].message)
        assertEquals("original content", diffService.fileAtCommit(space, history[1].sha, "docs/old.md"))
        assertEquals("edited content", diffService.fileAtCommit(space, history[0].sha, "docs/old.md"))
    }

    @Test
    fun `diff of a commit shows what it changed in the file`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        gitService.writeFile(space, "docs/a.md", "line one\nline two\n")
        gitService.commitAndPush(space, "Add docs/a.md", "Tester", "tester@example.com")
        gitService.writeFile(space, "docs/a.md", "line one\nline two changed\n")
        gitService.commitAndPush(space, "Update docs/a.md", "Tester", "tester@example.com")

        val history = diffService.fileHistory(space, "docs/a.md")

        val updateDiff = diffService.fileDiffAtCommit(space, history[0].sha, "docs/a.md")!!
        assertTrue(updateDiff.contains("-line two"))
        assertTrue(updateDiff.contains("+line two changed"))

        // First commit diffs against the empty tree — the whole file is additions.
        val addDiff = diffService.fileDiffAtCommit(space, history[1].sha, "docs/a.md")!!
        assertTrue(addDiff.contains("+line one"))

        // A commit that only touched other files yields an empty diff for this path.
        gitService.writeFile(space, "docs/b.md", "unrelated")
        gitService.commitAndPush(space, "Add docs/b.md", "Tester", "tester@example.com")
        val latest = diffService.fileHistory(space, "docs/b.md")[0]
        assertEquals("", diffService.fileDiffAtCommit(space, latest.sha, "docs/a.md"))
    }

    @Test
    fun `commit with no changes is a no-op instead of an empty commit`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        assertTrue(gitService.writeFile(space, "a.md", "content"))
        gitService.commitAndPush(space, "Add a.md", "Tester", "tester@example.com")
        gitService.commitAndPush(space, "Nothing changed", "Tester", "tester@example.com")

        assertEquals(1, diffService.fileHistory(space, "a.md").size)
    }
}

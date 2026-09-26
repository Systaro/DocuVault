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
        val gitService = GitService(reposDir.toString(), mock(SettingsService::class.java), "docuvault-bot@localhost")
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

    /**
     * The bug this guards: the mover became the creator. A move is one commit
     * that adds the new path and deletes the old one, so a plain `log <path>`
     * finds only that commit and reports whoever made it as the author of the
     * document's first version.
     */
    @Test
    fun `moving a document keeps its original creator and history`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        gitService.writeFile(space, "docs/guide.md", "# Guide\n\nfirst draft\n")
        gitService.commitAndPush(space, "Add docs/guide.md", "Alice", "alice@example.com")
        gitService.writeFile(space, "docs/guide.md", "# Guide\n\nsecond draft\n")
        gitService.commitAndPush(space, "Update docs/guide.md", "Alice", "alice@example.com")

        // Bob only reorganises: same content, new location.
        assertTrue(gitService.renameItem(space, "docs/guide.md", "handbook/guide.md"))
        gitService.commitAndPush(space, "Move docs/guide.md", "Bob", "bob@example.com")

        val meta = diffService.fileMeta(space, "handbook/guide.md")
        assertEquals("Alice", meta.created?.authorName, "the creator must survive someone else's move")
        assertEquals("Bob", meta.lastEdited?.authorName)

        // The whole track comes along, not just the move commit.
        val history = diffService.fileHistory(space, "handbook/guide.md")
        assertEquals(3, history.size)
        assertEquals(listOf("Bob", "Alice", "Alice"), history.map { it.authorName })

        // Versions from before the move are reported under the path they had then.
        assertEquals("handbook/guide.md", history[0].path)
        assertEquals("docs/guide.md", history[2].path)
    }

    @Test
    fun `content and diff of a version from before a move are still readable`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        gitService.writeFile(space, "docs/guide.md", "original\n")
        gitService.commitAndPush(space, "Add docs/guide.md", "Alice", "alice@example.com")
        gitService.renameItem(space, "docs/guide.md", "handbook/guide.md")
        gitService.commitAndPush(space, "Move docs/guide.md", "Bob", "bob@example.com")

        val history = diffService.fileHistory(space, "handbook/guide.md")
        val beforeMove = history.last()

        // Asked for by the document's *current* path, as the UI does.
        assertEquals(
            "original\n",
            diffService.fileAtCommit(space, beforeMove.sha, "handbook/guide.md"),
            "an old version must resolve through the rename, not 404"
        )
        assertTrue(diffService.fileDiffAtCommit(space, beforeMove.sha, "handbook/guide.md")!!.contains("+original"))
    }

    @Test
    fun `a renamed folder keeps the creator of the documents inside it`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        gitService.writeFile(space, "notes/one.md", "one\n")
        gitService.commitAndPush(space, "Add notes/one.md", "Alice", "alice@example.com")

        assertTrue(gitService.renameItem(space, "notes", "archive"))
        gitService.commitAndPush(space, "Rename notes to archive", "Bob", "bob@example.com")

        assertEquals("Alice", diffService.fileMeta(space, "archive/one.md").created?.authorName)
    }

    /**
     * Commits stage only what status reports as changed rather than `add .`, so
     * each kind of change has to make it in: new, modified and deleted files.
     */
    @Test
    fun `a commit picks up new, changed and deleted files`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        gitService.writeFile(space, "keep.md", "one\n")
        gitService.writeFile(space, "drop.md", "gone soon\n")
        gitService.commitAndPush(space, "Add two", "Alice", "alice@example.com")

        gitService.writeFile(space, "keep.md", "two\n")
        gitService.writeFile(space, "docs/new.md", "fresh\n")
        assertTrue(gitService.removeItem(space, "drop.md"))
        gitService.commitAndPush(space, "Change all three ways", "Bob", "bob@example.com")

        assertEquals(emptyList<String>(), gitService.getUncommittedFiles(space.id!!))
        assertEquals("Change all three ways", diffService.fileHistory(space, "keep.md").first().message)
        assertEquals("Change all three ways", diffService.fileHistory(space, "docs/new.md").single().message)
        assertEquals("Change all three ways", diffService.fileHistory(space, "drop.md").first().message)
    }

    /**
     * The batch lookup a cross-space folder move uses must answer exactly what
     * the per-file walk answers — including through a folder rename, where the
     * oldest commit on the current path is the rename, not the creation.
     */
    @Test
    fun `creation of many files at once matches the per-file answer`() {
        val (gitService, diffService) = services()
        val space = localSpace()

        gitService.writeFile(space, "notes/a.md", "a\n")
        gitService.writeFile(space, "notes/b.md", "b\n")
        gitService.commitAndPush(space, "Add a and b", "Alice", "alice@example.com")
        gitService.writeFile(space, "notes/a.md", "a, edited\n")
        gitService.commitAndPush(space, "Edit a", "Bob", "bob@example.com")
        gitService.writeFile(space, "notes/c.md", "c\n")
        gitService.commitAndPush(space, "Add c", "Carol", "carol@example.com")
        assertTrue(gitService.renameItem(space, "notes", "archive"))
        gitService.commitAndPush(space, "Rename notes to archive", "Dave", "dave@example.com")

        val paths = listOf("archive/a.md", "archive/b.md", "archive/c.md")
        val created = diffService.createdMany(space, paths)

        assertEquals(mapOf("archive/a.md" to "Alice", "archive/b.md" to "Alice", "archive/c.md" to "Carol"),
            created.mapValues { it.value.authorName })
        for (path in paths) {
            assertEquals(diffService.fileMeta(space, path).created, created[path], path)
        }
        assertEquals("notes/c.md", created["archive/c.md"]?.path)
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

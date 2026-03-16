import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocuVaultClient } from './client.js';
import type { PatchOperation, Space } from './types.js';

function buildSpaceCatalog(spaces: Space[]): string {
  const repoSpaces = spaces.filter(s => s.type === 'REPOSITORY');
  if (repoSpaces.length === 0) return '';

  const lines = repoSpaces.map(s => {
    const docs = s.documentCount !== undefined ? ` (${s.documentCount} docs)` : '';
    const desc = s.description ? ` - ${s.description}` : '';
    return `  - ${s.name}${docs}${desc} [spaceId: ${s.id}]`;
  });

  return `\n\nAvailable documentation spaces:\n${lines.join('\n')}\n\nWhen the user asks about any of these projects or related topics, use this tool to find relevant documentation.`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveSpaceId(spaces: Space[], input: string): string | null {
  if (UUID_REGEX.test(input)) return input;
  const match = spaces.find(s => s.fullPath === input || s.slug === input || s.name === input);
  return match?.id ?? null;
}

export function registerTools(server: McpServer, client: DocuVaultClient, spaces: Space[] = []): void {

  const spaceCatalog = buildSpaceCatalog(spaces);

  server.tool(
    'search_documentation',
    `Semantic vector search across all accessible DocuVault documentation. Returns relevant document chunks ranked by similarity.${spaceCatalog}`,
    {
      query: z.string().describe('The search query - can be a question or topic description'),
      spaceId: z.string().optional().describe('Optional: limit search to a specific space ID'),
      limit: z.number().optional().default(10).describe('Maximum number of results (default 10)'),
    },
    async ({ query, spaceId, limit }) => {
      try {
        let resolvedSpaceId: string | undefined;
        if (spaceId) {
          const id = resolveSpaceId(spaces, spaceId);
          if (!id) {
            return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
          }
          resolvedSpaceId = id;
        }
        const results = await client.searchSemantic(query, resolvedSpaceId, limit);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const formatted = results.map((r, i) => {
          const header = r.spaceFullPath
            ? `[${i + 1}] ${r.documentTitle} (${r.spaceFullPath}/${r.documentPath})`
            : `[${i + 1}] ${r.documentTitle} (${r.documentPath})`;
          return `${header}\n${r.content}`;
        }).join('\n\n---\n\n');

        return { content: [{ type: 'text', text: formatted }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Search failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'search_by_keyword',
    'Full-text keyword search across document titles and paths in DocuVault.',
    {
      query: z.string().describe('The keyword or phrase to search for'),
      limit: z.number().optional().default(20).describe('Maximum number of results (default 20)'),
    },
    async ({ query, limit }) => {
      try {
        const results = await client.searchKeyword(query, limit);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const formatted = results.map((r, i) =>
          `[${i + 1}] ${r.documentTitle}\n  Space: ${r.spaceName} (${r.spaceFullPath})\n  Path: ${r.documentPath}\n  Updated: ${r.updatedAt}${r.snippet ? `\n  Preview: ${r.snippet}` : ''}`
        ).join('\n\n');

        return { content: [{ type: 'text', text: formatted }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Search failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'read_document',
    'Read the full content of a specific document from DocuVault. Returns the content along with a contentHash (SHA-256) that you should pass to edit_document or insert_in_document to prevent conflicts.',
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space (e.g., "docs/getting-started.md")'),
    },
    async ({ spaceId, path }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }
        const doc = await client.readDocument(resolvedId, path);
        const header = `# ${doc.title}\nPath: ${doc.path}\ncontentHash: ${doc.contentHash}\n\n`;
        return { content: [{ type: 'text', text: header + doc.content }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to read document: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_spaces',
    'List all documentation spaces accessible to the authenticated user.',
    {},
    async () => {
      try {
        const spaces = await client.listSpaces();

        if (spaces.length === 0) {
          return { content: [{ type: 'text', text: 'No spaces accessible.' }] };
        }

        const formatted = spaces.map(s => {
          const parts = [`${s.name} (${s.type})`];
          parts.push(`  ID: ${s.id}`);
          parts.push(`  Path: ${s.fullPath}`);
          if (s.description) parts.push(`  Description: ${s.description}`);
          if (s.documentCount !== undefined) parts.push(`  Documents: ${s.documentCount}`);
          return parts.join('\n');
        }).join('\n\n');

        return { content: [{ type: 'text', text: formatted }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to list spaces: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_documents',
    'List all documents in a documentation space as a file tree.',
    {
      spaceId: z.string().describe('The space ID to list documents for'),
    },
    async ({ spaceId }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }
        const tree = await client.getFileTree(resolvedId);

        if (tree.length === 0) {
          return { content: [{ type: 'text', text: 'No documents in this space.' }] };
        }

        const formatted = formatTree(tree, 0);
        return { content: [{ type: 'text', text: formatted }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to list documents: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // --- Write tools ---

  server.tool(
    'create_document',
    'Create a new document in a DocuVault space. Use this for entirely new pages. The file will be created in the space\'s Git repository.',
    {
      spaceId: z.string().describe('The space ID to create the document in'),
      path: z.string().describe('File path within the space (e.g., "docs/setup-guide.md")'),
      content: z.string().describe('The full document content (Markdown, HTML, or plain text)'),
      title: z.string().optional().describe('Optional title. If omitted, extracted from first heading or filename.'),
    },
    async ({ spaceId, path, content, title }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        const doc = await client.createDocument(resolvedId, path, content, title);
        return {
          content: [{
            type: 'text',
            text: `Document created successfully.\nPath: ${doc.path}\nTitle: ${doc.title}\nHash: ${doc.contentHash}\n\nNote: Document is saved locally. Use autoCommit on edit_document or push via the UI to publish to Git.`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to create document: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'edit_document',
    `Edit an existing document using surgical find-and-replace. Only the matched text is changed — all other content, formatting, and whitespace is preserved byte-for-byte.

WORKFLOW: You MUST call read_document first to (1) see the current content and (2) get the contentHash. Pass that contentHash here to prevent conflicts.

RULES:
- old_text must be an EXACT character-for-character match (including whitespace, newlines, indentation)
- old_text must appear exactly once in the document, unless replace_all is true
- If old_text is not found or is ambiguous, the edit is rejected and nothing is changed
- Copy old_text directly from the read_document output — do not retype or reformat it`,
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space (e.g., "docs/getting-started.md")'),
      old_text: z.string().describe('The exact text to find in the document. Must be unique unless replace_all is true. Include enough surrounding context to ensure uniqueness.'),
      new_text: z.string().describe('The replacement text. Must differ from old_text.'),
      replace_all: z.boolean().optional().default(false).describe('If true, replace all occurrences. Default: false (requires unique match).'),
      content_hash: z.string().optional().describe('SHA-256 hash from read_document. If provided, the edit is rejected if the document was modified since you read it (optimistic locking).'),
      auto_commit: z.boolean().optional().default(false).describe('If true, commit and push to Git after editing.'),
      commit_message: z.string().optional().describe('Git commit message. Used only when auto_commit is true.'),
    },
    async ({ spaceId, path, old_text, new_text, replace_all, content_hash, auto_commit, commit_message }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        const operation: PatchOperation = {
          op: 'replace',
          oldText: old_text,
          newText: new_text,
          replaceAll: replace_all,
        };

        const result = await client.patchDocument(resolvedId, path, [operation], {
          contentHash: content_hash,
          autoCommit: auto_commit,
          commitMessage: commit_message,
        });

        return {
          content: [{
            type: 'text',
            text: `Document edited successfully.\nPath: ${result.path}\nNew hash: ${result.contentHash}${auto_commit ? '\nChanges committed and pushed to Git.' : ''}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Edit failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'insert_in_document',
    `Insert new content into an existing document at a specific location without modifying any existing content.

WORKFLOW: You MUST call read_document first to (1) find the exact anchor text and (2) get the contentHash.

RULES:
- For "after" or "before" positions, the anchor must be an exact match from the document
- Use "end" to append to the document, "start" to prepend
- The anchor text is not modified — new content is placed adjacent to it
- If the anchor text is not found, the insert is rejected and nothing is changed`,
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space'),
      content: z.string().describe('The content to insert'),
      position: z.enum(['after', 'before', 'start', 'end']).describe('Where to insert relative to the anchor text. Use "start" or "end" for document boundaries.'),
      anchor: z.string().optional().describe('The exact text to insert before/after. Required when position is "after" or "before". Not used for "start"/"end".'),
      content_hash: z.string().optional().describe('SHA-256 hash from read_document for optimistic locking.'),
      auto_commit: z.boolean().optional().default(false).describe('If true, commit and push to Git after inserting.'),
      commit_message: z.string().optional().describe('Git commit message. Used only when auto_commit is true.'),
    },
    async ({ spaceId, path, content: insertContent, position, anchor, content_hash, auto_commit, commit_message }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        if ((position === 'after' || position === 'before') && !anchor) {
          return { content: [{ type: 'text', text: `Anchor text is required when position is "${position}".` }], isError: true };
        }

        const operation: PatchOperation = {
          op: 'insert',
          content: insertContent,
          ...(position === 'start' && { after: 'START' }),
          ...(position === 'end' && { after: 'END' }),
          ...(position === 'after' && { after: anchor }),
          ...(position === 'before' && { before: anchor }),
        };

        const result = await client.patchDocument(resolvedId, path, [operation], {
          contentHash: content_hash,
          autoCommit: auto_commit,
          commitMessage: commit_message,
        });

        return {
          content: [{
            type: 'text',
            text: `Content inserted successfully.\nPath: ${result.path}\nNew hash: ${result.contentHash}${auto_commit ? '\nChanges committed and pushed to Git.' : ''}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Insert failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}

function formatTree(entries: Array<{ name: string; type: string; children?: any[] }>, depth: number): string {
  return entries.map(entry => {
    const indent = '  '.repeat(depth);
    const icon = entry.type === 'directory' ? '/' : '';
    let line = `${indent}${entry.name}${icon}`;
    if (entry.children && entry.children.length > 0) {
      line += '\n' + formatTree(entry.children, depth + 1);
    }
    return line;
  }).join('\n');
}

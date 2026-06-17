import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocuVaultClient } from './client.js';
import type { PatchOperation, Space } from './types.js';

const ALLOWED_EXTENSIONS = new Set([
  '.md', '.markdown',
  '.html', '.htm',
  '.css',
  '.js', '.mjs',
  '.json',
  '.xml',
  '.yaml', '.yml',
  '.svg',
  '.txt',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.tif',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.tif',
]);

function validateExtension(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  if (!ext) return `File has no extension. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`;
  if (!ALLOWED_EXTENSIONS.has(ext)) return `File type "${ext}" is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`;
  return null;
}

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

/**
 * Builds the canonical DocuVault app URL for a document — the same deep link the
 * web UI uses (/spaces/<fullPath>/doc?path=<docPath>). This is NOT a public share
 * link: opening it requires the user to be logged in and to have access to the
 * space. Slashes in the path are preserved; only individual segments are encoded
 * so spaces/#/? in filenames don't break the link.
 */
function buildDocumentUrl(baseUrl: string, spaceFullPath: string, docPath: string): string {
  const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/spaces/${spaceFullPath}/doc?path=${encodedPath}`;
}

export function registerTools(server: McpServer, client: DocuVaultClient, spaces: Space[] = []): void {

  const spaceCatalog = buildSpaceCatalog(spaces);
  const baseUrl = client.getBaseUrl();

  server.tool(
    'search_documentation',
    `Semantic vector search across all accessible DocuVault documentation. Returns relevant document chunks ranked by similarity. Each result includes a direct DocuVault URL — give it to the user to open the document in the app (they're already authenticated, no share link needed).${spaceCatalog}`,
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
            ? `[${i + 1}] ${r.documentTitle} (${r.spaceFullPath}/${r.documentPath})\nURL: ${buildDocumentUrl(baseUrl, r.spaceFullPath, r.documentPath)}`
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
    'Full-text keyword search across document titles and paths in DocuVault. Each result includes a direct DocuVault URL the user can open in the app (no share link needed — they already have access).',
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
          `[${i + 1}] ${r.documentTitle}\n  Space: ${r.spaceName} (${r.spaceFullPath})\n  Path: ${r.documentPath}\n  URL: ${buildDocumentUrl(baseUrl, r.spaceFullPath, r.documentPath)}\n  Updated: ${r.updatedAt}${r.snippet ? `\n  Preview: ${r.snippet}` : ''}`
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
        const spaceFullPath = spaces.find(s => s.id === resolvedId)?.fullPath;
        const urlLine = spaceFullPath ? `URL: ${buildDocumentUrl(baseUrl, spaceFullPath, doc.path)}\n` : '';
        const header = `# ${doc.title}\nPath: ${doc.path}\n${urlLine}contentHash: ${doc.contentHash}\n\n`;
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
    'List all documents in a documentation space as a full recursive file tree.',
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

  server.tool(
    'list_directory',
    `List the contents of a directory (or the root) in a DocuVault space. Shows files and subdirectories one level deep — like running ls on a folder.

Use this to explore what's inside a space or a specific subfolder before reading or editing documents.`,
    {
      spaceId: z.string().describe('The space ID to browse'),
      path: z.string().optional().describe('Directory path to list (e.g., "docs/" or "guides/api"). Omit or pass "/" for the root.'),
    },
    async ({ spaceId, path: dirPath }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        const tree = await client.getFileTree(resolvedId);
        const spaceName = spaces.find(s => s.id === resolvedId)?.name ?? resolvedId;

        // Normalise path: strip leading/trailing slashes, empty = root
        const normalised = (dirPath ?? '').replace(/^\/+|\/+$/g, '');

        let entries: Array<{ name: string; type: string; children?: any[] }>;
        let displayPath: string;

        if (!normalised) {
          entries = tree;
          displayPath = '/';
        } else {
          const segments = normalised.split('/');
          const found = findSubtree(tree, segments);
          if (!found) {
            return { content: [{ type: 'text', text: `Directory not found: "${normalised}". Use list_directory without a path to see the root.` }], isError: true };
          }
          if (found.type !== 'directory') {
            return { content: [{ type: 'text', text: `"${normalised}" is a file, not a directory. Use read_document to read its content.` }], isError: true };
          }
          entries = found.children ?? [];
          displayPath = normalised + '/';
        }

        if (entries.length === 0) {
          return { content: [{ type: 'text', text: `${displayPath} is empty.` }] };
        }

        const dirs = entries.filter(e => e.type === 'directory').sort((a, b) => a.name.localeCompare(b.name));
        const files = entries.filter(e => e.type !== 'directory').sort((a, b) => a.name.localeCompare(b.name));

        const lines: string[] = [`Contents of ${displayPath} in ${spaceName}`, ''];
        for (const d of dirs) {
          const childCount = d.children?.length ?? 0;
          lines.push(`  ${d.name}/  (${childCount} item${childCount !== 1 ? 's' : ''})`);
        }
        for (const f of files) {
          lines.push(`  ${f.name}`);
        }
        lines.push('');
        lines.push(`${dirs.length} director${dirs.length !== 1 ? 'ies' : 'y'}, ${files.length} file${files.length !== 1 ? 's' : ''}`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // --- Write tools ---

  server.tool(
    'download_document',
    `Download a document from DocuVault and save it to a local file for editing. Returns the content hash needed to reupload after editing.

WORKFLOW: Use this to get a local copy of a document, edit it with any tool, then call update_document with the same filePath to reupload.`,
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space (e.g., "docs/getting-started.md")'),
      saveTo: z.string().describe('Absolute local file path to save the content to (e.g., "/tmp/getting-started.md")'),
    },
    async ({ spaceId, path, saveTo }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }
        const extError = validateExtension(saveTo);
        if (extError) return { content: [{ type: 'text', text: extError }], isError: true };

        const doc = await client.readDocument(resolvedId, path);
        await mkdir(dirname(saveTo), { recursive: true });
        await writeFile(saveTo, doc.content, 'utf-8');
        return {
          content: [{
            type: 'text',
            text: `Downloaded successfully.\nSpace path: ${doc.path}\nTitle: ${doc.title}\nSaved to: ${saveTo}\ncontentHash: ${doc.contentHash}\n\nEdit the file locally, then call update_document with filePath="${saveTo}" and content_hash="${doc.contentHash}" to reupload.`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Download failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_document',
    `Fully replace an existing document's content. Use this after editing a file locally (downloaded via download_document) or to overwrite a document entirely.

For surgical edits (change a paragraph, fix a line), use edit_document or insert_in_document instead — they are safer and preserve untouched content byte-for-byte.

Provide EITHER filePath (reads local file — ideal after download_document) OR content (inline). If both are given, filePath wins.`,
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space (e.g., "docs/setup-guide.md")'),
      content: z.string().optional().describe('The full replacement content. Ignored if filePath is provided.'),
      filePath: z.string().optional().describe('Absolute path to a local file to upload as the new content. Ideal for files edited after download_document.'),
      title: z.string().optional().describe('Optional new title. If omitted, extracted from first heading or filename.'),
      content_hash: z.string().optional().describe('SHA-256 hash from read_document or download_document. If provided, the update is rejected if the document was modified since you read it (optimistic locking).'),
      auto_commit: z.boolean().optional().default(false).describe('If true, commit and push to Git after updating.'),
      commit_message: z.string().optional().describe('Git commit message. Used only when auto_commit is true.'),
    },
    async ({ spaceId, path, content, filePath, title, content_hash, auto_commit, commit_message }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        // Binary files (images) use the multipart upload endpoint
        const ext = extname(filePath || path).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          if (!filePath) {
            return { content: [{ type: 'text', text: 'Binary files (images) require filePath — inline content is not supported.' }], isError: true };
          }
          const extError = validateExtension(filePath);
          if (extError) return { content: [{ type: 'text', text: extError }], isError: true };

          const folder = dirname(path);
          const uploaded = await client.uploadFile(resolvedId, filePath, folder === '.' ? undefined : folder);
          if (uploaded.length === 0) {
            return { content: [{ type: 'text', text: 'Upload failed — no files were accepted by the server.' }], isError: true };
          }
          return {
            content: [{
              type: 'text',
              text: `File uploaded (replaced) successfully.\nPath: ${uploaded[0].path}\nName: ${uploaded[0].name}\nSource: ${filePath}`,
            }],
          };
        }

        let documentContent: string;
        if (filePath) {
          const extError = validateExtension(filePath);
          if (extError) return { content: [{ type: 'text', text: extError }], isError: true };
          documentContent = await readFile(filePath, 'utf-8');
        } else if (content) {
          documentContent = content;
        } else {
          return { content: [{ type: 'text', text: 'Either "content" or "filePath" must be provided.' }], isError: true };
        }

        // Optimistic locking: read current hash and compare before sending
        if (content_hash) {
          const current = await client.readDocument(resolvedId, path);
          if (current.contentHash !== content_hash) {
            return {
              content: [{
                type: 'text',
                text: `Conflict: document was modified since you last read it.\nCurrent hash: ${current.contentHash}\nYour hash:    ${content_hash}\n\nRe-download the document and reapply your changes.`,
              }],
              isError: true,
            };
          }
        }

        const doc = await client.updateDocument(resolvedId, path, documentContent, title, {
          autoCommit: auto_commit,
          commitMessage: commit_message,
        });

        const updateSpaceFullPath = spaces.find(s => s.id === resolvedId)?.fullPath;
        const updateUrlLine = updateSpaceFullPath ? `\nURL: ${buildDocumentUrl(baseUrl, updateSpaceFullPath, doc.path)}` : '';

        return {
          content: [{
            type: 'text',
            text: `Document updated successfully.\nPath: ${doc.path}\nTitle: ${doc.title}${updateUrlLine}\nNew hash: ${doc.contentHash}${filePath ? `\nSource: ${filePath}` : ''}${auto_commit ? '\nChanges committed and pushed to Git.' : ''}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Update failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_document',
    'Delete a document from a DocuVault space. This removes the file from the Git repository and the search index. This action cannot be undone via MCP — use Git history to recover if needed.',
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space (e.g., "docs/old-page.md")'),
    },
    async ({ spaceId, path }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }
        await client.deleteDocument(resolvedId, path);
        return {
          content: [{
            type: 'text',
            text: `Document deleted: ${path}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Delete failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'share_document',
    `Create a shareable public link for a file or folder in a DocuVault space. Returns the URL that anyone can use to access the content.

OPTIONS:
- shareType: "FILE" (default) for a single file, "FOLDER" for an entire directory tree
- password: optional — if set, viewers must enter this password before accessing
- expiresInDays: optional — link automatically expires after this many days`,
    {
      spaceId: z.string().describe('The space ID containing the file or folder'),
      path: z.string().describe('The file or folder path within the space (e.g., "docs/setup-guide.md" or "docs/")'),
      shareType: z.enum(['FILE', 'FOLDER']).optional().default('FILE').describe('Share a single file (FILE) or an entire folder tree (FOLDER)'),
      password: z.string().optional().describe('Optional password to protect the share link'),
      expiresInDays: z.number().int().positive().optional().describe('Optional number of days until the link expires'),
    },
    async ({ spaceId, path, shareType, password, expiresInDays }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        const link = await client.createShareLink(resolvedId, path, shareType, password, expiresInDays);
        const shareUrl = `${client.getBaseUrl()}/share/${link.token}`;

        const lines = [
          `Share link created successfully.`,
          ``,
          `URL: ${shareUrl}`,
          `Type: ${link.shareType}`,
          `Path: ${link.filePath}`,
          `Password protected: ${link.hasPassword ? 'Yes' : 'No'}`,
          link.expiresAt ? `Expires: ${new Date(link.expiresAt).toLocaleString()}` : `Expires: Never`,
        ];

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to create share link: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_document',
    `Create a new document in a DocuVault space. Use this for entirely new pages. The file will be created in the space's Git repository.

Provide EITHER filePath (to upload a local file — fast, no token overhead) OR content (inline). If both are given, filePath wins.`,
    {
      spaceId: z.string().describe('The space ID to create the document in'),
      path: z.string().describe('File path within the space (e.g., "docs/setup-guide.md")'),
      content: z.string().optional().describe('The full document content (Markdown, HTML, or plain text). Ignored if filePath is provided.'),
      filePath: z.string().optional().describe('Absolute path to a local file to upload. The MCP server reads the file directly — much faster than passing content inline for large files.'),
      title: z.string().optional().describe('Optional title. If omitted, extracted from first heading or filename.'),
    },
    async ({ spaceId, path, content, filePath, title }) => {
      try {
        const resolvedId = resolveSpaceId(spaces, spaceId);
        if (!resolvedId) {
          return { content: [{ type: 'text', text: `Unknown space: "${spaceId}". Use list_spaces to see available spaces.` }], isError: true };
        }

        // Binary files (images) use the multipart upload endpoint
        const ext = extname(filePath || path).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          if (!filePath) {
            return { content: [{ type: 'text', text: 'Binary files (images) require filePath — inline content is not supported.' }], isError: true };
          }
          const extError = validateExtension(filePath);
          if (extError) return { content: [{ type: 'text', text: extError }], isError: true };

          const folder = dirname(path);
          const uploaded = await client.uploadFile(resolvedId, filePath, folder === '.' ? undefined : folder);
          if (uploaded.length === 0) {
            return { content: [{ type: 'text', text: 'Upload failed — no files were accepted by the server.' }], isError: true };
          }
          return {
            content: [{
              type: 'text',
              text: `File uploaded successfully.\nPath: ${uploaded[0].path}\nName: ${uploaded[0].name}\nSource: ${filePath}`,
            }],
          };
        }

        let documentContent: string;
        if (filePath) {
          const extError = validateExtension(filePath);
          if (extError) return { content: [{ type: 'text', text: extError }], isError: true };
          documentContent = await readFile(filePath, 'utf-8');
        } else if (content) {
          documentContent = content;
        } else {
          return { content: [{ type: 'text', text: 'Either "content" or "filePath" must be provided.' }], isError: true };
        }

        const doc = await client.createDocument(resolvedId, path, documentContent, title);
        const createSpaceFullPath = spaces.find(s => s.id === resolvedId)?.fullPath;
        const createUrlLine = createSpaceFullPath ? `\nURL: ${buildDocumentUrl(baseUrl, createSpaceFullPath, doc.path)}` : '';
        return {
          content: [{
            type: 'text',
            text: `Document created successfully.\nPath: ${doc.path}\nTitle: ${doc.title}${createUrlLine}\nHash: ${doc.contentHash}${filePath ? `\nSource: ${filePath}` : ''}\n\nNote: Document is saved locally. Use autoCommit on edit_document or push via the UI to publish to Git.`,
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

function findSubtree(
  entries: Array<{ name: string; type: string; children?: any[] }>,
  segments: string[]
): { name: string; type: string; children?: any[] } | null {
  const [head, ...rest] = segments;
  const match = entries.find(e => e.name === head);
  if (!match) return null;
  if (rest.length === 0) return match;
  return findSubtree(match.children ?? [], rest);
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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocuVaultClient } from './client.js';

export function registerTools(server: McpServer, client: DocuVaultClient): void {

  server.tool(
    'search_documentation',
    'Semantic vector search across all accessible DocuVault documentation. Returns relevant document chunks ranked by similarity.',
    {
      query: z.string().describe('The search query - can be a question or topic description'),
      spaceId: z.string().optional().describe('Optional: limit search to a specific space ID'),
      limit: z.number().optional().default(10).describe('Maximum number of results (default 10)'),
    },
    async ({ query, spaceId, limit }) => {
      try {
        const results = await client.searchSemantic(query, spaceId, limit);

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
    'Read the full content of a specific document from DocuVault.',
    {
      spaceId: z.string().describe('The space ID containing the document'),
      path: z.string().describe('The file path within the space (e.g., "docs/getting-started.md")'),
    },
    async ({ spaceId, path }) => {
      try {
        const doc = await client.readDocument(spaceId, path);
        const header = `# ${doc.title}\nPath: ${doc.path}\n\n`;
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
        const tree = await client.getFileTree(spaceId);

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

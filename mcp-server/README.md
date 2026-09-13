# DocuVault MCP Server (stdio package)

> **DocuVault runs an MCP server itself.** Connect with one line and approve in the browser, no token to copy:
>
> ```bash
> claude mcp add --transport http docuvault https://your-docuvault-instance.com/api/mcp
> ```
>
> This npm package is the stdio alternative for clients without OAuth/HTTP
> support. The built-in server covers file transfers too (upload_file /
> download_file hand out a one-time URL for curl).

An MCP (Model Context Protocol) server that gives Claude Code full access to your DocuVault documentation. Search, read, create, edit, and delete documents directly from your coding environment.

## Quick Start

1. **Generate an API token** in DocuVault: go to Account > API Tokens > Create Token
2. **Add to your project's `.mcp.json`:**

```json
{
  "mcpServers": {
    "docuvault": {
      "command": "npx",
      "args": ["-y", "@systaro/docuvault-mcp"],
      "env": {
        "DOCUVAULT_URL": "https://your-docuvault-instance.com",
        "DOCUVAULT_TOKEN": "dv_your-token-here"
      }
    }
  }
}
```

3. **Restart Claude Code** - DocuVault tools will appear automatically.

## Available Tools

| Tool | Description |
|------|-------------|
| `search_documentation` | Semantic vector search across all accessible documentation |
| `search_by_keyword` | Full-text keyword search by document title and path |
| `read_document` | Read the full content of a specific document |
| `list_spaces` | List all documentation spaces you have access to |
| `list_documents` | List the file tree of a documentation space |
| `download_document` | Download a document to a local file for offline editing |
| `create_document` | Create a new document (inline content or local file) |
| `update_document` | Fully replace a document's content (inline or local file) |
| `edit_document` | Surgical find-and-replace that preserves all formatting |
| `insert_in_document` | Insert content at a specific location in a document |
| `delete_document` | Delete a document from a space |
| `list_space_state` | List the DocuVault state keys of a space |
| `get_space_state` | Read a state bucket persisted by an HTML file via the State Library |
| `set_space_state` | Write a state bucket (full JSON replace, requires edit access) |

### Supported file types

Text documents (Markdown, HTML, CSS, JS, JSON, XML, YAML, SVG, TXT, CSV) can be
created and edited inline or via `filePath`. Binary files — images (PNG, JPG,
GIF, WebP, …) and documents (PDF, Word, Excel, PowerPoint, OpenDocument, RTF) —
are uploaded and downloaded byte-for-byte and always require `filePath`.

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `DOCUVAULT_URL` | Yes | Your DocuVault instance URL |
| `DOCUVAULT_TOKEN` | Yes | API token (starts with `dv_`) |

## Troubleshooting

**"Token validation failed"** - Your token may be expired or revoked. Generate a new one from Account > API Tokens.

**"Missing required environment variables"** - Ensure both `DOCUVAULT_URL` and `DOCUVAULT_TOKEN` are set in your `.mcp.json` env block.

**No search results** - Semantic search requires that documents have been processed for embeddings. Check that AI features are enabled in DocuVault admin settings.

## Development

```bash
npm install
npm run dev     # Run with tsx (hot reload)
npm run build   # Compile TypeScript
npm start       # Run compiled output
```

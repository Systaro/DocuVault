import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DocuVaultClient } from './client.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const url = process.env.DOCUVAULT_URL;
  const token = process.env.DOCUVAULT_TOKEN;

  if (!url || !token) {
    console.error('Missing required environment variables: DOCUVAULT_URL and DOCUVAULT_TOKEN');
    console.error('Set them in your .mcp.json env configuration.');
    process.exit(1);
  }

  const client = new DocuVaultClient(url, token);

  // Validate token on startup
  try {
    const user = await client.validateToken();
    console.error(`Authenticated as ${user.name} (${user.email})`);
  } catch (error) {
    console.error(`Token validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Fetch available spaces on startup for dynamic tool descriptions
  let spaces: Awaited<ReturnType<typeof client.listSpaces>> = [];
  try {
    spaces = await client.listSpaces();
    const repoSpaces = spaces.filter(s => s.type === 'REPOSITORY');
    console.error(`Discovered ${repoSpaces.length} documentation spaces: ${repoSpaces.map(s => s.name).join(', ')}`);
  } catch (error) {
    console.error(`Warning: Could not fetch spaces for auto-discovery: ${error instanceof Error ? error.message : String(error)}`);
  }

  const server = new McpServer({
    name: 'docuvault',
    version: '1.0.0',
  });

  registerTools(server, client, spaces);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env node
// End-to-end check of DocuVault's built-in MCP server with the real MCP SDK
// client, the same one Claude Code uses: discovery → dynamic registration →
// browser consent → PKCE code exchange → initialize / tools/list / tools/call,
// then refresh rotation and replay detection straight against the token endpoint.
//
//   node scripts/oauth-smoke.mjs [mcpUrl] [callbackPort]
//     mcpUrl        default http://localhost:7031/api/mcp
//     callbackPort  default 63034
//
// The script prints AUTHORIZE_URL and waits. Open it in a browser, sign in,
// click Authorize; the script continues on the callback. Never run two copies
// against the same tokens: the replay test revokes the whole token family.
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

const mcpUrl = new URL(process.argv[2] ?? 'http://localhost:7031/api/mcp');
const port = Number(process.argv[3] ?? 63034);
const redirectUrl = `http://localhost:${port}/callback`;

let info;
let tokens;
let verifier;
const provider = {
  get redirectUrl() { return redirectUrl; },
  get clientMetadata() {
    return {
      client_name: 'DocuVault OAuth smoke test',
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  },
  clientInformation: () => info,
  saveClientInformation: (i) => { info = i; },
  tokens: () => tokens,
  saveTokens: (t) => { tokens = t; },
  codeVerifier: () => verifier,
  saveCodeVerifier: (v) => { verifier = v; },
  redirectToAuthorization: (url) => { console.log('AUTHORIZE_URL', url.href); },
};

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUrl);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Authentication successful</h1><p>You can close this tab.</p>');
      server.close();
      const error = url.searchParams.get('error');
      if (error) reject(new Error(`${error}: ${url.searchParams.get('error_description')}`));
      else resolve({ code: url.searchParams.get('code'), state: url.searchParams.get('state') });
    });
    server.listen(port, () => console.log('CALLBACK_LISTENING', redirectUrl));
  });
}

const client = new Client({ name: 'docuvault-oauth-smoke', version: '1.0.0' });
let transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
try {
  await client.connect(transport);
} catch (e) {
  if (!(e instanceof UnauthorizedError)) throw e;
  console.log('REGISTERED_CLIENT', info?.client_id);
  const { code } = await waitForCallback();
  await transport.finishAuth(code);
  transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  await client.connect(transport);
}
console.log('CONNECTED', JSON.stringify(client.getServerVersion()));
console.log('INSTRUCTIONS', (client.getInstructions() ?? '').split('\n')[0]);

const { tools } = await client.listTools();
console.log('TOOLS', tools.length, tools.map((t) => t.name).join(', '));

const spaces = await client.callTool({ name: 'list_spaces', arguments: {} });
console.log('LIST_SPACES isError=' + !!spaces.isError, spaces.content[0].text.split('\n').slice(0, 4).join(' | '));

const unknown = await client.callTool({ name: 'read_document', arguments: { spaceId: 'does-not-exist', path: 'x.md' } });
console.log('UNKNOWN_SPACE isError=' + !!unknown.isError, unknown.content[0].text);

// Refresh rotation and replay detection.
const tokenEndpoint = new URL('/api/oauth/token', mcpUrl);
async function refresh(refreshToken) {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: info.client_id }),
  });
  return { status: res.status, body: await res.json() };
}
const rotated = await refresh(tokens.refresh_token);
console.log('REFRESH', rotated.status, rotated.body.access_token ? 'new pair issued' : JSON.stringify(rotated.body));
const replay = await refresh(tokens.refresh_token);
console.log('REFRESH_REPLAY', replay.status, JSON.stringify(replay.body));
const afterReplay = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${rotated.body.access_token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
});
console.log('NEW_ACCESS_AFTER_REPLAY', afterReplay.status, afterReplay.headers.get('www-authenticate'));

await client.close();
console.log('DONE');

#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BackendClient } from './backend-client';
import { buildServer } from './server';

async function main(): Promise<void> {
  const baseUrl =
    process.env.CONTEXTIFY_BACKEND_URL ??
    process.env.BACKEND_URL ??
    'http://localhost:3000';

  const backend = new BackendClient({ baseUrl });
  const server = buildServer({ backend });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stdout is reserved for the MCP transport — log to stderr only.
  // eslint-disable-next-line no-console
  console.error('contextify-mcp failed:', err);
  process.exit(1);
});

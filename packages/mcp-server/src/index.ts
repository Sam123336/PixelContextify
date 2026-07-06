#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  LLM_PROVIDERS,
  type LlmOverride,
  type LlmProvider,
} from '@contextifly/shared';
import { BackendClient } from './backend-client';
import { buildServer } from './server';

/**
 * Build an optional "bring your own key" override from the MCP server's env.
 * Set these in your Claude Code / desktop MCP config to use your own LLM key
 * instead of the backend's default. Returns null when no key is supplied.
 */
function llmFromEnv(): LlmOverride | null {
  const apiKey = process.env.CONTEXTIFLY_LLM_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const provider = process.env.CONTEXTIFLY_LLM_PROVIDER?.trim();
  if (!provider || !LLM_PROVIDERS.includes(provider as LlmProvider)) {
    throw new Error(
      `CONTEXTIFLY_LLM_PROVIDER must be one of: ${LLM_PROVIDERS.join(', ')}.`,
    );
  }
  const model = process.env.CONTEXTIFLY_LLM_MODEL?.trim();
  const baseUrl = process.env.CONTEXTIFLY_LLM_BASE_URL?.trim();
  if (provider === 'openai-compatible' && !baseUrl) {
    throw new Error(
      'CONTEXTIFLY_LLM_BASE_URL is required when CONTEXTIFLY_LLM_PROVIDER is "openai-compatible".',
    );
  }
  return {
    provider: provider as LlmProvider,
    apiKey,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

async function main(): Promise<void> {
  // CLI mode: `contextifly index|map|analyze|impact|search|diff <dir>` —
  // lets any tool or AI assistant use the knowledge graph without MCP.
  const { runCli } = await import('./cli');
  if (runCli(process.argv.slice(2))) {
    return;
  }

  const baseUrl =
    process.env.CONTEXTIFLY_BACKEND_URL?.trim() ||
    process.env.BACKEND_URL?.trim() ||
    'http://localhost:3000';

  const backend = new BackendClient({ baseUrl, llm: llmFromEnv() });
  const server = buildServer({ backend });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stdout is reserved for the MCP transport — log to stderr only.
  // eslint-disable-next-line no-console
  console.error('contextifly failed:', err);
  process.exit(1);
});

/**
 * Shared types for the Contextify monorepo.
 *
 * These types describe the public contract between the backend, MCP server,
 * and VS Code extension. Keep this package free of runtime dependencies.
 */

export type ScreenshotStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface TokenSavings {
  imageTokensEstimate: number;
  markdownTokens: number;
  savingsPercent: number;
}

export interface ScreenshotRecord {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: ScreenshotStatus;
  markdown: string | null;
  tokenSavings: TokenSavings | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Supported LLM providers for UI analysis. The backend ships a default
 * (Gemini) but callers may override it per-request with their own key.
 */
export type LlmProvider = 'gemini' | 'openai' | 'anthropic';

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  'gemini',
  'openai',
  'anthropic',
];

/**
 * A per-request "bring your own key" override. When present, the backend uses
 * these credentials instead of its configured default. The apiKey is never
 * persisted — it lives only on the in-flight queue job.
 */
export interface LlmOverride {
  provider: LlmProvider;
  apiKey: string;
  /** Optional model id; falls back to a provider-specific default. */
  model?: string;
}

/** HTTP headers used to carry an {@link LlmOverride} on the upload request. */
export const LLM_OVERRIDE_HEADERS = {
  PROVIDER: 'x-llm-provider',
  API_KEY: 'x-llm-api-key',
  MODEL: 'x-llm-model',
} as const;

/** Payload posted onto the BullMQ queue. */
export interface ScreenshotJobPayload {
  screenshotId: string;
  /** Optional caller-supplied LLM credentials for this job. */
  llm?: LlmOverride | null;
}

/** Names of MCP tools the mcp-server package will eventually expose. */
export const MCP_TOOL_NAMES = {
  ANALYZE_SCREENSHOT: 'analyze_screenshot',
  GENERATE_UI_CONTEXT: 'generate_ui_context',
  COMPRESS_VISUAL_CONTEXT: 'compress_visual_context',
  DETECT_FRAMEWORK: 'detect_framework',
} as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

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

/** Payload posted onto the BullMQ queue. */
export interface ScreenshotJobPayload {
  screenshotId: string;
}

/** Names of MCP tools the mcp-server package will eventually expose. */
export const MCP_TOOL_NAMES = {
  ANALYZE_SCREENSHOT: 'analyze_screenshot',
  GENERATE_UI_CONTEXT: 'generate_ui_context',
  COMPRESS_VISUAL_CONTEXT: 'compress_visual_context',
  DETECT_FRAMEWORK: 'detect_framework',
} as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

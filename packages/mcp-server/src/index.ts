/**
 * Contextify MCP server — Phase 2 placeholder.
 *
 * This package will host the Model Context Protocol server that exposes
 * Contextify's capabilities to Claude Code. For Phase 1 we only export the
 * intended tool name catalog so other packages can reference it.
 */
import { MCP_TOOL_NAMES } from '@contextify/shared';

export const PHASE = 'phase-2-pending' as const;
export const TOOLS = MCP_TOOL_NAMES;

if (require.main === module) {
  // eslint-disable-next-line no-console
  console.log(
    'Contextify MCP server is a placeholder. Tools planned:',
    Object.values(TOOLS),
  );
}

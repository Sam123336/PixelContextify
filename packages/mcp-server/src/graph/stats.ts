import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { graphDir } from './store';

/**
 * Token-savings ledger.
 *
 * Graph queries: per-project, at .pixelcontextify/stats.json. `out` is the
 * measured size of the tool's answer; `base` is a documented ESTIMATE of the
 * exploration the answer replaced (reading/searching files without a graph).
 * Screenshots: global (~/.contextify/screenshots.json) with REAL numbers from
 * the backend (estimated image tokens vs actual markdown tokens).
 */

export interface UsageEntry {
  t: string;
  tool: string;
  /** actual output tokens (chars/4) */
  out: number;
  /** estimated tokens of the file-reading exploration this replaced */
  base: number;
}

export interface ScreenshotEntry {
  t: string;
  image: number;
  markdown: number;
}

/**
 * Typical exploration cost each tool replaces, in tokens. Deliberately
 * conservative; derived from "how many files would Claude read to answer this
 * without a graph" × ~600 tokens/file. Tune with real-world data over time.
 */
const BASELINE_TOKENS: Record<string, number> = {
  get_project_map: 18_000,
  get_impact: 15_000,
  trace_flow: 25_000,
  explain_visually: 12_000,
  what_if: 15_000,
  analyze_project: 20_000,
  get_feature: 10_000,
  search_graph: 5_000,
  graph_diff: 8_000,
  graph_timeline: 8_000,
  match_screenshot: 8_000,
  blueprint_screenshot: 10_000,
  index_project: 0, // the investment that makes the rest possible
};

const MAX_ENTRIES = 1_000;

function statsFile(projectRoot: string): string {
  return path.join(graphDir(projectRoot), 'stats.json');
}

function screenshotStatsFile(): string {
  return path.join(os.homedir(), '.contextify', 'screenshots.json');
}

function readJson<T>(file: string): T[] {
  try {
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function appendJson<T>(file: string, entry: T): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const list = readJson<T>(file);
    list.push(entry);
    writeFileSync(file, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    // stats are best-effort — never break a real answer over bookkeeping
  }
}

export function recordUsage(projectRoot: string, tool: string, outputChars: number): void {
  appendJson<UsageEntry>(statsFile(projectRoot), {
    t: new Date().toISOString(),
    tool,
    out: Math.ceil(outputChars / 4),
    base: BASELINE_TOKENS[tool] ?? 0,
  });
}

export function recordScreenshotSavings(imageTokens: number, markdownTokens: number): void {
  appendJson<ScreenshotEntry>(screenshotStatsFile(), {
    t: new Date().toISOString(),
    image: imageTokens,
    markdown: markdownTokens,
  });
}

export function renderSavingsReport(projectRoot: string): string {
  const usage = readJson<UsageEntry>(statsFile(projectRoot));
  const shots = readJson<ScreenshotEntry>(screenshotStatsFile());
  if (usage.length === 0 && shots.length === 0) {
    return (
      '# Token savings\n\n_No usage recorded yet. Savings accumulate ' +
      'automatically as graph tools and screenshot analyses run._'
    );
  }

  const lines: string[] = ['# Contextify token savings', ''];

  // ---- graph side -----------------------------------------------------------
  const queries = usage.filter((u) => u.tool !== 'index_project');
  if (usage.length > 0) {
    const spent = usage.reduce((s, u) => s + u.out, 0);
    const avoided = usage.reduce((s, u) => s + u.base, 0);
    const net = avoided - spent;
    lines.push(
      '## Software Knowledge Graph (this project)',
      '',
      `**${queries.length} graph queries** answered from verified edges instead of file exploration.`,
      '',
      `| | Tokens |`,
      `|---|---|`,
      `| Spent on graph answers (measured) | ${fmt(spent)} |`,
      `| Exploration avoided (estimated) | ${fmt(avoided)} |`,
      `| **Net saved** | **${fmt(net)}** (${avoided > 0 ? Math.round((net / avoided) * 100) : 0}% of what exploration would have cost) |`,
      '',
      '```mermaid',
      'pie showData title Graph queries — tokens spent vs avoided',
      `    "Spent (graph answers)" : ${Math.max(1, spent)}`,
      `    "Avoided (est. exploration)" : ${Math.max(1, net)}`,
      '```',
      '',
    );

    // Per-tool breakdown.
    const byTool = new Map<string, { calls: number; out: number; base: number }>();
    for (const u of usage) {
      const agg = byTool.get(u.tool) ?? { calls: 0, out: 0, base: 0 };
      agg.calls++;
      agg.out += u.out;
      agg.base += u.base;
      byTool.set(u.tool, agg);
    }
    lines.push('| Tool | Calls | Answer tokens | Est. avoided | Net saved |', '|---|---|---|---|---|');
    for (const [tool, a] of [...byTool.entries()].sort((x, y) => (y[1].base - y[1].out) - (x[1].base - x[1].out))) {
      lines.push(`| \`${tool}\` | ${a.calls} | ${fmt(a.out)} | ${fmt(a.base)} | ${fmt(a.base - a.out)} |`);
    }
    lines.push('');
  }

  // ---- screenshot side --------------------------------------------------------
  if (shots.length > 0) {
    const img = shots.reduce((s, e) => s + e.image, 0);
    const md = shots.reduce((s, e) => s + e.markdown, 0);
    const saved = img - md;
    lines.push(
      '## Screenshot engine (all projects, measured by the backend)',
      '',
      `**${shots.length} screenshot(s)** compressed to markdown.`,
      '',
      `| | Tokens |`,
      `|---|---|`,
      `| Raw images would have cost | ${fmt(img)} |`,
      `| Markdown actually cost | ${fmt(md)} |`,
      `| **Saved** | **${fmt(saved)}** (${img > 0 ? Math.round((saved / img) * 100) : 0}%) |`,
      '',
      '```mermaid',
      'pie showData title Screenshots — image tokens vs markdown',
      `    "Markdown (paid)" : ${Math.max(1, md)}`,
      `    "Image cost avoided" : ${Math.max(1, saved)}`,
      '```',
      '',
    );
  }

  lines.push(
    '---',
    '_Graph "avoided" figures are estimates of typical no-graph exploration ' +
    '(~how many files Claude would read to answer each question × ~600 tokens/file). ' +
    'Screenshot figures are real measurements from the analysis backend. ' +
    'And remember: without the graph, exploration repeats every conversation — ' +
    'these savings recur._',
  );
  return lines.join('\n');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

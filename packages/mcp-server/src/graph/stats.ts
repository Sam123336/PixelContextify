import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { graphDir } from './store';

/**
 * Exploration-avoided ledger.
 *
 * The primary claim is WORK AVOIDED (files the AI did not have to read),
 * not tokens. Tokens are reported as a consequence, and every derived number
 * is labeled as an estimate — only answer sizes, latency, and screenshot
 * compression are measured.
 *
 * Graph queries: per-project, at .pixelcontextify/stats.json. `out` is the
 * measured size of the tool's answer; `base` is a documented ESTIMATE of the
 * exploration the answer replaced, derived from BASELINE_FILES × TOKENS_PER_FILE.
 * Screenshots: global (~/.contextify/screenshots.json) with REAL numbers from
 * the backend (estimated image tokens vs actual markdown tokens).
 */

export interface UsageEntry {
  t: string;
  tool: string;
  /** actual output tokens (chars/4) — measured */
  out: number;
  /** estimated tokens of the file-reading exploration this replaced */
  base: number;
  /** measured wall-clock duration of the graph answer, ms */
  ms?: number;
}

export interface ScreenshotEntry {
  t: string;
  image: number;
  markdown: number;
}

/** Estimated average cost of reading one source file, in tokens. */
const TOKENS_PER_FILE = 600;

/**
 * Typical number of files Claude would open to answer each question without a
 * graph. Deliberately conservative; tune with real-world data over time.
 * This is the single source of the estimate — tokens are derived from it.
 */
const BASELINE_FILES: Record<string, number> = {
  get_project_map: 30,
  get_impact: 25,
  trace_flow: 42,
  explain_visually: 20,
  what_if: 25,
  analyze_project: 33,
  get_feature: 17,
  search_graph: 8,
  graph_diff: 13,
  graph_timeline: 13,
  match_screenshot: 13,
  blueprint_screenshot: 17,
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

export function recordUsage(
  projectRoot: string,
  tool: string,
  outputChars: number,
  durationMs?: number,
): void {
  appendJson<UsageEntry>(statsFile(projectRoot), {
    t: new Date().toISOString(),
    tool,
    out: Math.ceil(outputChars / 4),
    base: (BASELINE_FILES[tool] ?? 0) * TOKENS_PER_FILE,
    ...(durationMs !== undefined ? { ms: Math.round(durationMs) } : {}),
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
      '# Exploration avoided\n\n_No usage recorded yet. The ledger fills ' +
      'automatically as graph tools and screenshot analyses run._'
    );
  }

  const lines: string[] = ['# Contextify — exploration avoided', ''];

  // ---- graph side -----------------------------------------------------------
  const queries = usage.filter((u) => u.tool !== 'index_project');
  if (usage.length > 0) {
    const spent = usage.reduce((s, u) => s + u.out, 0);
    const avoided = usage.reduce((s, u) => s + u.base, 0);
    const filesAvoided = Math.round(avoided / TOKENS_PER_FILE);
    const reduction = avoided > 0 ? Math.round(((avoided - spent) / avoided) * 100) : 0;
    const timed = usage.filter((u) => typeof u.ms === 'number');
    const medianMs = timed.length
      ? [...timed].map((u) => u.ms!).sort((a, b) => a - b)[Math.floor(timed.length / 2)]
      : undefined;

    lines.push(
      '## Software Knowledge Graph (this project)',
      '',
      `**${queries.length} architecture question(s)** answered from verified graph edges — ` +
        'no repository search.',
      '',
      '| Metric | Without graph | With graph |',
      '|---|---|---|',
      `| Files explored | ~${fmt(filesAvoided)} (estimated) | 0 — graph queries instead |`,
      `| Exploration tokens | ~${fmt(avoided)} (estimated) | ${fmt(spent)} (measured answer size) |`,
      ...(medianMs !== undefined
        ? [`| Answer latency | minutes of exploration | ${fmt(medianMs)} ms median (measured) |`]
        : []),
      `| **Estimated reduction** | | **~${reduction}%** |`,
      '',
      '```mermaid',
      'pie showData title Tokens — measured answers vs estimated exploration avoided',
      `    "Graph answers (measured)" : ${Math.max(1, spent)}`,
      `    "Exploration avoided (estimated)" : ${Math.max(1, avoided - spent)}`,
      '```',
      '',
    );

    // Per-tool breakdown — measured answer cost next to the estimate it replaced.
    const byTool = new Map<string, { calls: number; out: number; base: number }>();
    for (const u of usage) {
      const agg = byTool.get(u.tool) ?? { calls: 0, out: 0, base: 0 };
      agg.calls++;
      agg.out += u.out;
      agg.base += u.base;
      byTool.set(u.tool, agg);
    }
    lines.push(
      '| Tool | Calls | Answer tokens (measured) | Est. files avoided | Est. exploration avoided | Est. reduction |',
      '|---|---|---|---|---|---|',
    );
    for (const [tool, a] of [...byTool.entries()].sort(
      (x, y) => y[1].base - y[1].out - (x[1].base - x[1].out),
    )) {
      const red = a.base > 0 ? `${Math.round(((a.base - a.out) / a.base) * 100)}%` : '—';
      lines.push(
        `| \`${tool}\` | ${a.calls} | ${fmt(a.out)} | ~${fmt(Math.round(a.base / TOKENS_PER_FILE))} | ~${fmt(a.base)} | ${red} |`,
      );
    }
    lines.push('');
  }

  // ---- screenshot side --------------------------------------------------------
  if (shots.length > 0) {
    const img = shots.reduce((s, e) => s + e.image, 0);
    const md = shots.reduce((s, e) => s + e.markdown, 0);
    const saved = img - md;
    lines.push(
      '## Screenshot engine (all projects — measured by the backend)',
      '',
      `**${shots.length} screenshot(s)** compressed to markdown.`,
      '',
      `| | Tokens |`,
      `|---|---|`,
      `| Raw images would have cost | ${fmt(img)} |`,
      `| Markdown actually cost | ${fmt(md)} |`,
      `| **Saved (measured)** | **${fmt(saved)}** (${img > 0 ? Math.round((saved / img) * 100) : 0}%) |`,
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
    '_**Methodology.** Measured: graph-answer sizes, answer latency, and screenshot ' +
      'compression. Estimated: exploration avoided, derived from a per-question baseline of ' +
      `how many files an assistant typically reads without a graph × ~${TOKENS_PER_FILE} tokens/file — ` +
      'not a direct measurement of an alternative run. The structural point stands regardless of ' +
      'the exact numbers: without the graph, exploration repeats every conversation; with it, ' +
      'discovery is compiled once and queried._',
  );
  return lines.join('\n');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

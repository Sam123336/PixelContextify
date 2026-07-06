import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { graphDir } from './store';

const GIT_STATE_FILE = 'git-state.json';

/**
 * The repository's git position at the moment the graph was built, persisted
 * next to graph.json in <project>/.pixelcontextifly/git-state.json. A later run
 * reads it back and decides — from git alone, without re-parsing the project —
 * whether the stored graph is still valid.
 *
 * HEAD shas ARE the git-history fingerprint: any commit, amend, rebase, merge,
 * or branch switch moves one of them, so comparing shas is the same as matching
 * `git log`. The main/master head is tracked separately so the graph refreshes
 * when the main line advances even while you sit on a feature branch.
 */
export interface GitState {
  /** Current branch, or 'HEAD' when detached. */
  branch: string;
  /** HEAD commit of the current branch. */
  head: string;
  /** Default branch name if it exists locally ('main' or 'master'), else null. */
  mainBranch: string | null;
  /** HEAD commit of the tracked main/master branch. */
  mainHead: string | null;
}

function git(root: string, args: string[]): string | null {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Current HEAD commit sha, or undefined outside a git repo. */
export function gitHead(root: string): string | undefined {
  return git(root, ['rev-parse', 'HEAD']) ?? undefined;
}

/** Read the live git position, or null when root is not a git repo / has no commits. */
export function readGitState(root: string): GitState | null {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!head) return null;
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'HEAD';
  let mainBranch: string | null = null;
  for (const cand of ['main', 'master']) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`])) {
      mainBranch = cand;
      break;
    }
  }
  const mainHead = mainBranch ? git(root, ['rev-parse', mainBranch]) : null;
  return { branch, head, mainBranch, mainHead };
}

function stateFile(root: string): string {
  return path.join(graphDir(root), GIT_STATE_FILE);
}

export function loadGitState(root: string): GitState | null {
  const file = stateFile(root);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as GitState;
  } catch {
    return null; // corrupt sidecar: treat as absent, a rebuild will rewrite it.
  }
}

/** Persist the sidecar. graphDir already exists (saveGraph ran, or a graph was loaded). */
export function saveGitState(root: string, state: GitState): void {
  writeFileSync(stateFile(root), JSON.stringify(state, null, 2) + '\n');
}

function equal(a: GitState | null, b: GitState | null): boolean {
  if (!a || !b) return false;
  return a.branch === b.branch && a.head === b.head && a.mainHead === b.mainHead;
}

/**
 * Write the sidecar only when it is missing or no longer matches — so a plain
 * reuse never rewrites a file, but a graph indexed before git tracking existed
 * still gets upgraded to a sidecar the first time it is served.
 */
export function ensureGitState(root: string, saved: GitState | null, current: GitState | null): void {
  if (current && !equal(saved, current)) saveGitState(root, current);
}

/**
 * Why git says the graph is out of date, or null when git reports no change.
 * Returns null when git can't be consulted (non-repo, or no prior sidecar) so
 * callers fall back to file-hash staleness.
 */
export function gitDrift(saved: GitState | null, current: GitState | null): string | null {
  if (!saved || !current) return null;
  if (saved.branch !== current.branch) {
    return `switched branch \`${saved.branch}\` → \`${current.branch}\``;
  }
  if (saved.head !== current.head) {
    return `\`${current.branch}\` moved to \`${current.head.slice(0, 7)}\``;
  }
  if (saved.mainHead !== current.mainHead) {
    const name = current.mainBranch ?? 'main';
    return `\`${name}\` advanced to \`${(current.mainHead ?? '').slice(0, 7)}\``;
  }
  return null;
}

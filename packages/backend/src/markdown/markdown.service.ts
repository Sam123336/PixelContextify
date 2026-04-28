import { Injectable } from '@nestjs/common';

const REQUIRED_SECTIONS = [
  'Screen Type',
  'Components',
  'Layout',
  'Design Style',
  'Problems',
  'Suggestions',
] as const;

export interface NormalizeResult {
  markdown: string;
  missingSections: string[];
}

@Injectable()
export class MarkdownService {
  /**
   * Strip wrapping code fences and surrounding whitespace, then audit which
   * required sections are present. Returns the cleaned markdown plus a list
   * of any missing required H1 sections (informational; not enforced).
   */
  normalize(raw: string): NormalizeResult {
    const trimmed = raw.trim();
    const stripped = this.stripOuterCodeFence(trimmed).trim();

    const present = new Set<string>();
    for (const line of stripped.split('\n')) {
      const match = /^#\s+(.+?)\s*$/.exec(line);
      if (match) {
        present.add(match[1].trim());
      }
    }
    const missing = REQUIRED_SECTIONS.filter((s) => !present.has(s));

    return { markdown: stripped, missingSections: missing };
  }

  private stripOuterCodeFence(input: string): string {
    // Matches ```optional-lang\n...\n```
    const fenceMatch = /^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```\s*$/.exec(input);
    return fenceMatch ? fenceMatch[1] : input;
  }
}

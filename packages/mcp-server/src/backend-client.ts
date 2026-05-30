import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  LLM_OVERRIDE_HEADERS,
  type LlmOverride,
  type ScreenshotRecord,
  type ScreenshotStatus,
} from '@contextify/shared';

const TERMINAL_STATUSES: ReadonlySet<ScreenshotStatus> = new Set(['done', 'failed']);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export interface BackendClientOptions {
  baseUrl: string;
  /** Optional "bring your own key" override sent with each upload. */
  llm?: LlmOverride | null;
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export class BackendClient {
  constructor(private readonly options: BackendClientOptions) {}

  async uploadScreenshot(filePath: string): Promise<ScreenshotRecord> {
    const absolutePath = path.resolve(filePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) {
      throw new BackendError(
        `Unsupported file extension "${ext}". Allowed: ${Object.keys(MIME_BY_EXT).join(', ')}`,
      );
    }

    const buffer = await readFile(absolutePath);
    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    form.append('file', blob, path.basename(absolutePath));

    const res = await fetch(`${this.options.baseUrl}/screenshots`, {
      method: 'POST',
      body: form,
      headers: this.llmHeaders(),
    });
    if (!res.ok) {
      throw new BackendError(
        `Backend upload failed (${res.status}): ${await res.text()}`,
        res.status,
      );
    }
    return (await res.json()) as ScreenshotRecord;
  }

  /** Headers carrying the optional LLM override (from MCP server env). */
  private llmHeaders(): Record<string, string> {
    const llm = this.options.llm;
    if (!llm?.apiKey) {
      return {};
    }
    const headers: Record<string, string> = {
      [LLM_OVERRIDE_HEADERS.PROVIDER]: llm.provider,
      [LLM_OVERRIDE_HEADERS.API_KEY]: llm.apiKey,
    };
    if (llm.model) {
      headers[LLM_OVERRIDE_HEADERS.MODEL] = llm.model;
    }
    if (llm.baseUrl) {
      headers[LLM_OVERRIDE_HEADERS.BASE_URL] = llm.baseUrl;
    }
    return headers;
  }

  async getScreenshot(id: string): Promise<ScreenshotRecord> {
    const res = await fetch(`${this.options.baseUrl}/screenshots/${id}`);
    if (!res.ok) {
      throw new BackendError(
        `Backend lookup failed (${res.status}): ${await res.text()}`,
        res.status,
      );
    }
    return (await res.json()) as ScreenshotRecord;
  }

  async waitForCompletion(
    id: string,
    opts: PollOptions = {},
  ): Promise<ScreenshotRecord> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const record = await this.getScreenshot(id);
      if (TERMINAL_STATUSES.has(record.status)) {
        return record;
      }
      if (Date.now() >= deadline) {
        throw new BackendError(
          `Timed out after ${timeoutMs}ms waiting for screenshot ${id} (last status: ${record.status})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

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

export const SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export interface BackendClientOptions {
  baseUrl: string;
  /** Optional "bring your own key" override sent with each upload. */
  llm?: LlmOverride | null;
}

export interface UploadInput {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface AnalyzeOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
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

  static mimeFromPath(filePath: string): string | undefined {
    return MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  }

  static async loadFromPath(filePath: string): Promise<UploadInput> {
    const mimeType = BackendClient.mimeFromPath(filePath);
    if (!mimeType) {
      throw new BackendError(
        `Unsupported file extension "${path.extname(filePath)}". Allowed: .png, .jpg, .jpeg, .webp.`,
      );
    }
    const bytes = await readFile(filePath);
    return { bytes, mimeType, filename: path.basename(filePath) };
  }

  async upload(input: UploadInput, signal?: AbortSignal): Promise<ScreenshotRecord> {
    if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) {
      throw new BackendError(
        `Unsupported mime type "${input.mimeType}". Allowed: ${[...SUPPORTED_MIME_TYPES].join(', ')}.`,
      );
    }
    const form = new FormData();
    const blob = new Blob([input.bytes], { type: input.mimeType });
    form.append('file', blob, input.filename);

    const res = await fetch(`${this.options.baseUrl}/screenshots`, {
      method: 'POST',
      body: form,
      headers: this.llmHeaders(),
      signal,
    });
    if (!res.ok) {
      throw new BackendError(
        `Backend upload failed (${res.status}): ${await res.text()}`,
        res.status,
      );
    }
    return (await res.json()) as ScreenshotRecord;
  }

  /** Headers carrying the optional per-user LLM override. */
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
    return headers;
  }

  async getScreenshot(id: string, signal?: AbortSignal): Promise<ScreenshotRecord> {
    const res = await fetch(`${this.options.baseUrl}/screenshots/${id}`, { signal });
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
    opts: AnalyzeOptions = {},
  ): Promise<ScreenshotRecord> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      opts.signal?.throwIfAborted();
      const record = await this.getScreenshot(id, opts.signal);
      if (TERMINAL_STATUSES.has(record.status)) {
        return record;
      }
      if (Date.now() >= deadline) {
        throw new BackendError(
          `Timed out after ${timeoutMs}ms waiting for screenshot ${id} (last status: ${record.status}).`,
        );
      }
      await sleep(intervalMs, opts.signal);
    }
  }

  async analyze(input: UploadInput, opts: AnalyzeOptions = {}): Promise<ScreenshotRecord> {
    const uploaded = await this.upload(input, opts.signal);
    return this.waitForCompletion(uploaded.id, opts);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

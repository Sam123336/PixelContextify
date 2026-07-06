import type { LlmProvider } from '@contextifly/shared';

/**
 * Thrown when no usable credentials are available for a requested provider.
 * The queue processor treats this as unrecoverable (no point retrying a job
 * that has no key).
 */
export class LlmNotConfiguredError extends Error {
  constructor(provider: LlmProvider) {
    super(
      `No API key configured for LLM provider "${provider}". ` +
        `Set the server default or supply a per-request key.`,
    );
    this.name = 'LlmNotConfiguredError';
  }
}

/** Fully-resolved credentials for a single analyze call. */
export interface ResolvedLlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  /** Base URL for OpenAI-compatible endpoints; unused by other providers. */
  baseUrl?: string;
}

/**
 * A provider implementation knows how to turn an image into markdown using a
 * specific vendor SDK. Implementations are stateless — the resolved config is
 * passed in per call so the same instance serves both the server default and
 * caller-supplied keys.
 */
export interface LlmProviderImpl {
  readonly provider: LlmProvider;
  /** Model used when neither the request nor server config specifies one. */
  readonly defaultModel: string;
  /** Whether this provider requires a baseUrl to be supplied. */
  readonly requiresBaseUrl?: boolean;
  analyzeUi(
    config: ResolvedLlmConfig,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string>;
}

/**
 * Centralized configuration loader.
 *
 * Reads from process.env (populated by @nestjs/config) and returns a typed
 * tree consumed via ConfigService.get('group.key').
 */
export interface AppConfig {
  env: string;
  port: number;
  databaseUrl: string;
  /** Enable TLS for Postgres (required by managed providers e.g. Azure). */
  databaseSsl: boolean;
  redisUrl: string;
  /** Server-default LLM. Callers may override per-request with their own key. */
  llm: {
    provider: 'gemini' | 'openai' | 'anthropic' | 'openai-compatible';
    apiKey: string;
    model: string;
    /** Base URL for an OpenAI-compatible default provider. */
    baseUrl: string;
  };
  upload: {
    dir: string;
    maxBytes: number;
  };
  queue: {
    concurrency: number;
  };
}

export default (): AppConfig => {
  const maxMb = parseInt(process.env.MAX_UPLOAD_MB ?? '10', 10);
  return {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgres://contextifly:contextifly@localhost:5432/contextifly',
    databaseSsl:
      process.env.DATABASE_SSL === 'true' ||
      (process.env.DATABASE_URL?.includes('sslmode=require') ?? false),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    llm: {
      // LLM_* takes precedence; GEMINI_* kept for backwards compatibility.
      provider:
        (process.env.LLM_PROVIDER as AppConfig['llm']['provider']) ?? 'gemini',
      apiKey: process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? '',
      model:
        process.env.LLM_MODEL ??
        process.env.GEMINI_MODEL ??
        'gemini-2.0-flash',
      baseUrl: process.env.LLM_BASE_URL ?? '',
    },
    upload: {
      dir: process.env.UPLOAD_DIR ?? './uploads',
      maxBytes: maxMb * 1024 * 1024,
    },
    queue: {
      concurrency: parseInt(process.env.QUEUE_CONCURRENCY ?? '4', 10),
    },
  };
};

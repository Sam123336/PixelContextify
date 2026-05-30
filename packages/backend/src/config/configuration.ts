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
  redisUrl: string;
  /** Server-default LLM. Callers may override per-request with their own key. */
  llm: {
    provider: 'gemini' | 'openai' | 'anthropic';
    apiKey: string;
    model: string;
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
      'postgres://contextify:contextify@localhost:5432/contextify',
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

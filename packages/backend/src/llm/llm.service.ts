import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmOverride, LlmProvider } from '@contextify/shared';
import {
  LlmNotConfiguredError,
  type LlmProviderImpl,
  type ResolvedLlmConfig,
} from './llm.types';
import { GeminiProvider } from './providers/gemini.provider';
import {
  OpenAiCompatibleProvider,
  OpenAiProvider,
} from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';

/**
 * Provider-agnostic entry point for UI analysis.
 *
 * Resolves which provider/key/model to use for a given call — preferring a
 * caller-supplied {@link LlmOverride} ("bring your own key") and falling back
 * to the server's configured default — then dispatches to the matching
 * vendor implementation.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers: Record<LlmProvider, LlmProviderImpl>;

  constructor(private readonly config: ConfigService) {
    const impls: LlmProviderImpl[] = [
      new GeminiProvider(),
      new OpenAiProvider(),
      new AnthropicProvider(),
      new OpenAiCompatibleProvider(),
    ];
    this.providers = impls.reduce(
      (acc, impl) => {
        acc[impl.provider] = impl;
        return acc;
      },
      {} as Record<LlmProvider, LlmProviderImpl>,
    );

    if (!this.config.get<string>('llm.apiKey')) {
      this.logger.warn(
        'No default LLM API key configured — requests must supply their own key.',
      );
    }
  }

  /**
   * Analyze a UI screenshot and return raw markdown.
   *
   * @param override Optional per-request credentials. When omitted (or its
   *   apiKey is blank) the server default is used.
   */
  async analyzeUi(
    imageBuffer: Buffer,
    mimeType: string,
    override?: LlmOverride | null,
  ): Promise<string> {
    const resolved = this.resolve(override);
    const impl = this.providers[resolved.provider];
    if (!impl) {
      throw new Error(`Unknown LLM provider "${resolved.provider}".`);
    }

    this.logger.log(
      `Analyzing screenshot via ${resolved.provider} (model=${resolved.model}, ` +
        `key=${override?.apiKey ? 'caller-supplied' : 'server-default'}` +
        `${resolved.baseUrl ? `, baseUrl=${resolved.baseUrl}` : ''})`,
    );

    const text = await impl.analyzeUi(resolved, imageBuffer, mimeType);
    if (!text || !text.trim()) {
      throw new Error(`${resolved.provider} returned an empty response.`);
    }
    return text;
  }

  /** Resolve effective credentials, preferring the caller override. */
  private resolve(override?: LlmOverride | null): ResolvedLlmConfig {
    if (override && override.apiKey?.trim()) {
      const impl = this.requireProvider(override.provider);
      return this.finalize(impl, {
        apiKey: override.apiKey.trim(),
        model: override.model?.trim(),
        baseUrl: override.baseUrl?.trim(),
      });
    }

    const provider = this.config.get<LlmProvider>('llm.provider') ?? 'gemini';
    const impl = this.requireProvider(provider);
    const apiKey = this.config.get<string>('llm.apiKey') ?? '';
    if (!apiKey) {
      throw new LlmNotConfiguredError(provider);
    }
    return this.finalize(impl, {
      apiKey,
      model: this.config.get<string>('llm.model')?.trim(),
      baseUrl: this.config.get<string>('llm.baseUrl')?.trim(),
    });
  }

  private requireProvider(provider: LlmProvider): LlmProviderImpl {
    const impl = this.providers[provider];
    if (!impl) {
      throw new Error(`Unknown LLM provider "${provider}".`);
    }
    return impl;
  }

  /** Apply defaults and validate provider-specific requirements. */
  private finalize(
    impl: LlmProviderImpl,
    parts: { apiKey: string; model?: string; baseUrl?: string },
  ): ResolvedLlmConfig {
    const model = parts.model || impl.defaultModel;
    if (!model) {
      throw new Error(
        `Provider "${impl.provider}" requires an explicit model name.`,
      );
    }
    if (impl.requiresBaseUrl && !parts.baseUrl) {
      throw new Error(
        `Provider "${impl.provider}" requires a base URL.`,
      );
    }
    return {
      provider: impl.provider,
      apiKey: parts.apiKey,
      model,
      ...(parts.baseUrl ? { baseUrl: parts.baseUrl } : {}),
    };
  }
}

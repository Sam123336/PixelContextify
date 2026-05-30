import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmOverride, LlmProvider } from '@contextify/shared';
import {
  LlmNotConfiguredError,
  type LlmProviderImpl,
  type ResolvedLlmConfig,
} from './llm.types';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';
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
        `key=${override?.apiKey ? 'caller-supplied' : 'server-default'})`,
    );

    const text = await impl.analyzeUi(
      resolved.apiKey,
      resolved.model,
      imageBuffer,
      mimeType,
    );
    if (!text || !text.trim()) {
      throw new Error(`${resolved.provider} returned an empty response.`);
    }
    return text;
  }

  /** Resolve effective credentials, preferring the caller override. */
  private resolve(override?: LlmOverride | null): ResolvedLlmConfig {
    if (override && override.apiKey?.trim()) {
      const provider = override.provider;
      const impl = this.providers[provider];
      if (!impl) {
        throw new Error(`Unknown LLM provider "${provider}".`);
      }
      return {
        provider,
        apiKey: override.apiKey.trim(),
        model: override.model?.trim() || impl.defaultModel,
      };
    }

    const provider =
      this.config.get<LlmProvider>('llm.provider') ?? 'gemini';
    const impl = this.providers[provider];
    if (!impl) {
      throw new Error(`Unknown default LLM provider "${provider}".`);
    }
    const apiKey = this.config.get<string>('llm.apiKey') ?? '';
    if (!apiKey) {
      throw new LlmNotConfiguredError(provider);
    }
    return {
      provider,
      apiKey,
      model: this.config.get<string>('llm.model') || impl.defaultModel,
    };
  }
}

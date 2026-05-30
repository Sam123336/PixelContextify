import OpenAI from 'openai';
import type { LlmProviderImpl, ResolvedLlmConfig } from '../llm.types';
import { UI_ANALYSIS_PROMPT } from '../prompts/ui-analysis.prompt';

/**
 * Run the UI-analysis prompt against any OpenAI Chat Completions endpoint.
 * Shared by the hosted OpenAI provider and the custom-endpoint variant.
 */
async function analyzeWithOpenAi(
  config: ResolvedLlmConfig,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: UI_ANALYSIS_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return completion.choices[0]?.message?.content ?? '';
}

/** Hosted OpenAI vision provider. */
export class OpenAiProvider implements LlmProviderImpl {
  readonly provider = 'openai' as const;
  readonly defaultModel = 'gpt-4o';

  analyzeUi(
    config: ResolvedLlmConfig,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    return analyzeWithOpenAi(config, imageBuffer, mimeType);
  }
}

/**
 * Any OpenAI-compatible endpoint (OpenRouter, Together, Groq, vLLM, LM Studio,
 * local gateways, …). The caller supplies the base URL and model; there is no
 * sensible default model since it depends entirely on the endpoint.
 */
export class OpenAiCompatibleProvider implements LlmProviderImpl {
  readonly provider = 'openai-compatible' as const;
  readonly defaultModel = '';
  readonly requiresBaseUrl = true;

  analyzeUi(
    config: ResolvedLlmConfig,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    return analyzeWithOpenAi(config, imageBuffer, mimeType);
  }
}

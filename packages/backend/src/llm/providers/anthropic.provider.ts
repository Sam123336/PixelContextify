import Anthropic from '@anthropic-ai/sdk';
import type { LlmProviderImpl, ResolvedLlmConfig } from '../llm.types';
import { UI_ANALYSIS_PROMPT } from '../prompts/ui-analysis.prompt';

type AnthropicMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Anthropic Claude vision provider. */
export class AnthropicProvider implements LlmProviderImpl {
  readonly provider = 'anthropic' as const;
  readonly defaultModel = 'claude-3-5-sonnet-latest';

  async analyzeUi(
    config: ResolvedLlmConfig,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const client = new Anthropic({ apiKey: config.apiKey });

    const message = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: UI_ANALYSIS_PROMPT },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: toAnthropicMediaType(mimeType),
                data: imageBuffer.toString('base64'),
              },
            },
          ],
        },
      ],
    });

    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}

/** Anthropic only accepts a fixed set of media types; normalise jpg → jpeg. */
function toAnthropicMediaType(mimeType: string): AnthropicMediaType {
  switch (mimeType) {
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg';
    case 'image/png':
      return 'image/png';
    case 'image/gif':
      return 'image/gif';
    case 'image/webp':
      return 'image/webp';
    default:
      throw new Error(`Anthropic does not support image type "${mimeType}".`);
  }
}

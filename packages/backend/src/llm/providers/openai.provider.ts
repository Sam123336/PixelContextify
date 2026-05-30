import OpenAI from 'openai';
import type { LlmProviderImpl } from '../llm.types';
import { UI_ANALYSIS_PROMPT } from '../prompts/ui-analysis.prompt';

/** OpenAI (or OpenAI-compatible) vision provider. */
export class OpenAiProvider implements LlmProviderImpl {
  readonly provider = 'openai' as const;
  readonly defaultModel = 'gpt-4o';

  async analyzeUi(
    apiKey: string,
    model: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const client = new OpenAI({ apiKey });
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    const completion = await client.chat.completions.create({
      model,
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
}

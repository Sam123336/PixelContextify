import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LlmProviderImpl, ResolvedLlmConfig } from '../llm.types';
import { UI_ANALYSIS_PROMPT } from '../prompts/ui-analysis.prompt';

/** Google Gemini provider (the historical default). */
export class GeminiProvider implements LlmProviderImpl {
  readonly provider = 'gemini' as const;
  readonly defaultModel = 'gemini-2.0-flash';

  async analyzeUi(
    config: ResolvedLlmConfig,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const client = new GoogleGenerativeAI(config.apiKey);
    const generativeModel = client.getGenerativeModel({
      model: config.model,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'text/plain',
      },
    });

    const result = await generativeModel.generateContent([
      { text: UI_ANALYSIS_PROMPT },
      {
        inlineData: {
          mimeType,
          data: imageBuffer.toString('base64'),
        },
      },
    ]);

    return result.response.text();
  }
}

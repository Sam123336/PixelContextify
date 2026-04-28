import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { UI_ANALYSIS_PROMPT } from './prompts/ui-analysis.prompt';

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set; cannot call Gemini.');
    this.name = 'GeminiNotConfiguredError';
  }
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly client: GoogleGenerativeAI | null;
  private readonly modelName: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('gemini.apiKey') ?? '';
    this.modelName = config.get<string>('gemini.model', 'gemini-2.0-flash');

    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is empty — Gemini calls will throw GeminiNotConfiguredError.',
      );
      this.client = null;
    } else {
      this.client = new GoogleGenerativeAI(apiKey);
    }
  }

  /**
   * Analyze a UI screenshot and return structured markdown.
   */
  async analyzeUi(imageBuffer: Buffer, mimeType: string): Promise<string> {
    if (!this.client) {
      throw new GeminiNotConfiguredError();
    }

    const model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'text/plain',
      },
    });

    const result = await model.generateContent([
      { text: UI_ANALYSIS_PROMPT },
      {
        inlineData: {
          mimeType,
          data: imageBuffer.toString('base64'),
        },
      },
    ]);

    const text = result.response.text();
    if (!text || !text.trim()) {
      throw new Error('Gemini returned an empty response.');
    }
    return text;
  }
}

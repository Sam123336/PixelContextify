import { Injectable, Logger } from '@nestjs/common';
import imageSize from 'image-size';
import { encode } from 'gpt-tokenizer';
import type { TokenSavings } from '@contextify/shared';

/**
 * Estimates the vision-token cost of an image as Gemini 2.0 Flash bills it,
 * then compares it to the actual token count of the produced markdown.
 *
 * Reference (Gemini image tokenization):
 * - Tiles smaller than 384px on each side count as 258 tokens.
 * - Larger images are split into 768x768 tiles; each tile = 258 tokens.
 *   See https://ai.google.dev/gemini-api/docs/tokens#multimodal-tokens
 */
@Injectable()
export class TokenSavingsService {
  private readonly logger = new Logger(TokenSavingsService.name);

  compare(imageBuffer: Buffer, markdown: string): TokenSavings {
    const imageTokens = this.estimateImageTokens(imageBuffer);
    const markdownTokens = this.countMarkdownTokens(markdown);

    const savingsPercent =
      imageTokens > 0
        ? Math.max(0, ((imageTokens - markdownTokens) / imageTokens) * 100)
        : 0;

    return {
      imageTokensEstimate: imageTokens,
      markdownTokens,
      savingsPercent: Math.round(savingsPercent * 100) / 100,
    };
  }

  private estimateImageTokens(buffer: Buffer): number {
    try {
      const { width, height } = imageSize(buffer);
      if (!width || !height) return 1290;

      // Small image: a single tile.
      if (width <= 384 && height <= 384) {
        return 258;
      }

      const tilesX = Math.ceil(width / 768);
      const tilesY = Math.ceil(height / 768);
      return tilesX * tilesY * 258;
    } catch (err) {
      this.logger.warn(
        `Could not parse image dimensions; falling back to 1290 tokens (${(err as Error).message})`,
      );
      return 1290;
    }
  }

  private countMarkdownTokens(markdown: string): number {
    try {
      return encode(markdown).length;
    } catch (err) {
      this.logger.warn(
        `gpt-tokenizer failed; falling back to char/4 heuristic (${(err as Error).message})`,
      );
      return Math.ceil(markdown.length / 4);
    }
  }
}

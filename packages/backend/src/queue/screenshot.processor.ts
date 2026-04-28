import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { promises as fs } from 'fs';
import type { ScreenshotJobPayload } from '@contextify/shared';
import { Screenshot } from '../database/models/screenshot.model';
import { GeminiService } from '../gemini/gemini.service';
import { MarkdownService } from '../markdown/markdown.service';
import { TokenSavingsService } from '../analytics/token-savings.service';
import { SCREENSHOT_QUEUE_NAME } from './queue.constants';
import { REDIS_CONNECTION } from './queue.tokens';

@Injectable()
export class ScreenshotProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScreenshotProcessor.name);
  private worker?: Worker<ScreenshotJobPayload>;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
    @InjectModel(Screenshot)
    private readonly screenshotModel: typeof Screenshot,
    private readonly gemini: GeminiService,
    private readonly markdown: MarkdownService,
    private readonly tokens: TokenSavingsService,
  ) {}

  onModuleInit(): void {
    const concurrency = this.config.get<number>('queue.concurrency', 4);

    this.worker = new Worker<ScreenshotJobPayload>(
      SCREENSHOT_QUEUE_NAME,
      async (job) => this.handle(job),
      {
        connection: this.redis,
        concurrency,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} failed: ${err.message}`,
        err.stack,
      );
    });
    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed (screenshot=${job.data.screenshotId})`);
    });

    this.logger.log(
      `Screenshot worker started (concurrency=${concurrency}, queue=${SCREENSHOT_QUEUE_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async handle(job: Job<ScreenshotJobPayload>): Promise<void> {
    const { screenshotId } = job.data;
    const row = await this.screenshotModel.findByPk(screenshotId);
    if (!row) {
      throw new Error(`Screenshot ${screenshotId} not found`);
    }

    await row.update({ status: 'processing', errorMessage: null });

    try {
      const buffer = await fs.readFile(row.storagePath);
      const rawMarkdown = await this.gemini.analyzeUi(buffer, row.mimeType);
      const { markdown, missingSections } = this.markdown.normalize(rawMarkdown);
      if (missingSections.length > 0) {
        this.logger.warn(
          `screenshot=${row.id} missing sections: ${missingSections.join(', ')}`,
        );
      }

      const savings = this.tokens.compare(buffer, markdown);

      await row.update({
        status: 'done',
        markdown,
        imageTokensEstimate: savings.imageTokensEstimate,
        markdownTokens: savings.markdownTokens,
        savingsPercent: savings.savingsPercent,
      });
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.error(
        `Failed to process screenshot ${screenshotId}: ${message}`,
      );
      await row.update({ status: 'failed', errorMessage: message });
      throw err;
    }
  }
}

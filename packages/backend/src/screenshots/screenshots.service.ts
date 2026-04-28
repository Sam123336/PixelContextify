import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { Queue } from 'bullmq';
import type {
  ScreenshotJobPayload,
  ScreenshotRecord,
} from '@contextify/shared';
import { Screenshot } from '../database/models/screenshot.model';
import { SCREENSHOT_JOB_NAME } from '../queue/queue.constants';
import { SCREENSHOT_QUEUE } from '../queue/queue.tokens';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

@Injectable()
export class ScreenshotsService {
  private readonly logger = new Logger(ScreenshotsService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Screenshot)
    private readonly screenshotModel: typeof Screenshot,
    @Inject(SCREENSHOT_QUEUE) private readonly queue: Queue<ScreenshotJobPayload>,
  ) {}

  async upload(file: Express.Multer.File): Promise<ScreenshotRecord> {
    if (!file) {
      throw new BadRequestException('Missing file field "file".');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported mime type "${file.mimetype}". Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }
    const maxBytes = this.config.get<number>('upload.maxBytes', 10 * 1024 * 1024);
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `File too large: ${file.size} bytes (max ${maxBytes}).`,
      );
    }

    const id = uuid();
    const uploadDir = this.config.get<string>('upload.dir', './uploads');
    await fs.mkdir(uploadDir, { recursive: true });

    const ext = EXT_BY_MIME[file.mimetype] ?? '.bin';
    const storagePath = path.resolve(uploadDir, `${id}${ext}`);
    await fs.writeFile(storagePath, file.buffer);

    const row = await this.screenshotModel.create({
      id,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath,
      status: 'queued',
    } as Screenshot);

    await this.queue.add(
      SCREENSHOT_JOB_NAME,
      { screenshotId: id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    this.logger.log(`Queued screenshot ${id} (${file.size} bytes, ${file.mimetype})`);
    return this.toRecord(row);
  }

  async findById(id: string): Promise<ScreenshotRecord> {
    const row = await this.screenshotModel.findByPk(id);
    if (!row) {
      throw new NotFoundException(`Screenshot ${id} not found`);
    }
    return this.toRecord(row);
  }

  private toRecord(row: Screenshot): ScreenshotRecord {
    const tokenSavings =
      row.imageTokensEstimate != null &&
      row.markdownTokens != null &&
      row.savingsPercent != null
        ? {
            imageTokensEstimate: row.imageTokensEstimate,
            markdownTokens: row.markdownTokens,
            savingsPercent: row.savingsPercent,
          }
        : null;

    return {
      id: row.id,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      markdown: row.markdown ?? null,
      tokenSavings,
      errorMessage: row.errorMessage ?? null,
      createdAt: (row.get('createdAt') as Date).toISOString(),
      updatedAt: (row.get('updatedAt') as Date).toISOString(),
    };
  }
}

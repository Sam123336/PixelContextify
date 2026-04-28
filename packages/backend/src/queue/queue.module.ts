import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DatabaseModule } from '../database/database.module';
import { GeminiModule } from '../gemini/gemini.module';
import { MarkdownModule } from '../markdown/markdown.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ScreenshotProcessor } from './screenshot.processor';
import { SCREENSHOT_QUEUE_NAME } from './queue.constants';
import { REDIS_CONNECTION, SCREENSHOT_QUEUE } from './queue.tokens';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    GeminiModule,
    MarkdownModule,
    AnalyticsModule,
  ],
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IORedis => {
        const url = config.get<string>('redisUrl', 'redis://localhost:6379');
        // BullMQ requires maxRetriesPerRequest=null on the connection.
        return new IORedis(url, { maxRetriesPerRequest: null });
      },
    },
    {
      provide: SCREENSHOT_QUEUE,
      inject: [REDIS_CONNECTION],
      useFactory: (connection: IORedis) =>
        new Queue(SCREENSHOT_QUEUE_NAME, { connection }),
    },
    ScreenshotProcessor,
  ],
  exports: [SCREENSHOT_QUEUE, REDIS_CONNECTION],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(SCREENSHOT_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.redis.disconnect();
  }
}

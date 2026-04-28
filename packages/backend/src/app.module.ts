import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { ScreenshotsModule } from './screenshots/screenshots.module';
import { QueueModule } from './queue/queue.module';
import { GeminiModule } from './gemini/gemini.module';
import { MarkdownModule } from './markdown/markdown.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule,
    GeminiModule,
    MarkdownModule,
    AnalyticsModule,
    QueueModule,
    ScreenshotsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

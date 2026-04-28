import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { ScreenshotsController } from './screenshots.controller';
import { ScreenshotsService } from './screenshots.service';

@Module({
  imports: [DatabaseModule, QueueModule],
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService],
})
export class ScreenshotsModule {}

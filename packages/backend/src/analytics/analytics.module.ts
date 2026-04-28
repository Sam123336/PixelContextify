import { Module } from '@nestjs/common';
import { TokenSavingsService } from './token-savings.service';

@Module({
  providers: [TokenSavingsService],
  exports: [TokenSavingsService],
})
export class AnalyticsModule {}

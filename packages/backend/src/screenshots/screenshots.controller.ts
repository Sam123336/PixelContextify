import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ScreenshotRecord } from '@contextify/shared';
import { ScreenshotsService } from './screenshots.service';

@Controller('screenshots')
export class ScreenshotsController {
  constructor(private readonly service: ScreenshotsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ScreenshotRecord> {
    return this.service.upload(file);
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ScreenshotRecord> {
    return this.service.findById(id);
  }
}

import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  LLM_OVERRIDE_HEADERS,
  LLM_PROVIDERS,
  type LlmOverride,
  type LlmProvider,
  type ScreenshotRecord,
} from '@contextify/shared';
import { ScreenshotsService } from './screenshots.service';

@Controller('screenshots')
export class ScreenshotsController {
  constructor(private readonly service: ScreenshotsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<ScreenshotRecord> {
    return this.service.upload(file, parseLlmOverride(headers));
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ScreenshotRecord> {
    return this.service.findById(id);
  }
}

/**
 * Build an {@link LlmOverride} from the per-request headers, if any. Returns
 * null when no key is supplied (the server default is then used). Headers are
 * lower-cased by Node's HTTP layer, matching the constants in shared.
 */
function parseLlmOverride(
  headers: Record<string, string | undefined>,
): LlmOverride | null {
  const apiKey = headers[LLM_OVERRIDE_HEADERS.API_KEY]?.trim();
  if (!apiKey) {
    return null;
  }
  const provider = headers[LLM_OVERRIDE_HEADERS.PROVIDER]?.trim();
  if (!provider || !LLM_PROVIDERS.includes(provider as LlmProvider)) {
    throw new BadRequestException(
      `Header "${LLM_OVERRIDE_HEADERS.PROVIDER}" must be one of: ${LLM_PROVIDERS.join(', ')}.`,
    );
  }
  const model = headers[LLM_OVERRIDE_HEADERS.MODEL]?.trim();
  return {
    provider: provider as LlmProvider,
    apiKey,
    ...(model ? { model } : {}),
  };
}

import * as vscode from 'vscode';
import { BackendClient, SUPPORTED_MIME_TYPES, type UploadInput } from './backend-client';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export async function extractImageFromDataTransfer(
  dataTransfer: vscode.DataTransfer,
): Promise<UploadInput | undefined> {
  // 1. Direct image MIME — paste of clipboard image, or drag from a browser.
  for (const mime of SUPPORTED_MIME_TYPES) {
    const item = dataTransfer.get(mime);
    if (!item) continue;
    const file = item.asFile();
    if (!file) continue;
    const bytes = await file.data();
    return {
      bytes,
      mimeType: mime,
      filename: file.name || `screenshot${EXT_BY_MIME[mime] ?? '.png'}`,
    };
  }

  // 2. File drop from OS — VS Code surfaces these via text/uri-list.
  const uriList = dataTransfer.get('text/uri-list');
  if (uriList) {
    const text = await uriList.asString();
    for (const raw of text.split(/\r?\n/)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(trimmed, true);
      } catch {
        continue;
      }
      if (uri.scheme !== 'file') continue;
      if (!BackendClient.mimeFromPath(uri.fsPath)) continue;
      return BackendClient.loadFromPath(uri.fsPath);
    }
  }

  return undefined;
}

import * as vscode from 'vscode';
import type { BackendClient } from '../backend-client';
import { runAnalysisWithProgress } from '../analyze-flow';
import { extractImageFromDataTransfer } from '../extract-image';

export const CONTEXTIFLY_PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Text.append(
  'contextifly',
  'screenshot',
);

export class ContextiflyPasteEditProvider implements vscode.DocumentPasteEditProvider {
  constructor(
    private readonly getClient: () => BackendClient,
    private readonly getTimeoutMs: () => number,
  ) {}

  async provideDocumentPasteEdits(
    _document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    const input = await extractImageFromDataTransfer(dataTransfer);
    if (!input || token.isCancellationRequested) {
      return undefined;
    }
    const markdown = await runAnalysisWithProgress(
      this.getClient(),
      input,
      this.getTimeoutMs(),
    );
    if (!markdown) {
      return undefined;
    }
    return [
      new vscode.DocumentPasteEdit(
        markdown,
        'Contextifly: insert structured markdown',
        CONTEXTIFLY_PASTE_KIND,
      ),
    ];
  }
}

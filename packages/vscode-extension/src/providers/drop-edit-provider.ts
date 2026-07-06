import * as vscode from 'vscode';
import type { BackendClient } from '../backend-client';
import { runAnalysisWithProgress } from '../analyze-flow';
import { extractImageFromDataTransfer } from '../extract-image';

export const CONTEXTIFLY_DROP_KIND = vscode.DocumentDropOrPasteEditKind.Text.append(
  'contextifly',
  'screenshot',
);

export class ContextiflyDropEditProvider implements vscode.DocumentDropEditProvider {
  constructor(
    private readonly getClient: () => BackendClient,
    private readonly getTimeoutMs: () => number,
  ) {}

  async provideDocumentDropEdits(
    _document: vscode.TextDocument,
    _position: vscode.Position,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentDropEdit | undefined> {
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
    return new vscode.DocumentDropEdit(
      markdown,
      'Contextifly: insert structured markdown',
      CONTEXTIFLY_DROP_KIND,
    );
  }
}

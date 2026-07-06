import * as vscode from 'vscode';
import { BackendClient, BackendError, type UploadInput } from './backend-client';

export async function runAnalysisWithProgress(
  client: BackendClient,
  input: UploadInput,
  timeoutMs: number,
): Promise<string | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Contextifly: analyzing ${input.filename}…`,
      cancellable: true,
    },
    async (_progress, token) => {
      const abort = new AbortController();
      const sub = token.onCancellationRequested(() => abort.abort());
      try {
        const record = await client.analyze(input, { timeoutMs, signal: abort.signal });

        if (record.status === 'failed') {
          void vscode.window.showErrorMessage(
            `Contextifly: ${record.errorMessage ?? 'analysis failed'}`,
          );
          return undefined;
        }
        if (!record.markdown) {
          void vscode.window.showWarningMessage('Contextifly: backend returned no markdown.');
          return undefined;
        }
        if (record.tokenSavings) {
          vscode.window.setStatusBarMessage(
            `Contextifly: ${record.tokenSavings.savingsPercent}% token savings`,
            5_000,
          );
        }
        return record.markdown;
      } catch (err) {
        if (abort.signal.aborted) {
          return undefined;
        }
        const msg = err instanceof BackendError ? err.message : (err as Error).message;
        void vscode.window.showErrorMessage(`Contextifly: ${msg}`);
        return undefined;
      } finally {
        sub.dispose();
      }
    },
  );
}

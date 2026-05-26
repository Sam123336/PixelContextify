import * as vscode from 'vscode';
import { BackendClient } from '../backend-client';
import { runAnalysisWithProgress } from '../analyze-flow';

export function registerAnalyzeFileCommand(
  getClient: () => BackendClient,
  getTimeoutMs: () => number,
): vscode.Disposable {
  return vscode.commands.registerCommand('contextify.analyzeFile', async () => {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Analyze with Contextify',
      filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] },
    });
    const uri = picks?.[0];
    if (!uri) {
      return;
    }

    let input;
    try {
      input = await BackendClient.loadFromPath(uri.fsPath);
    } catch (err) {
      void vscode.window.showErrorMessage(`Contextify: ${(err as Error).message}`);
      return;
    }

    const markdown = await runAnalysisWithProgress(getClient(), input, getTimeoutMs());
    if (!markdown) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((edit) => {
        edit.insert(editor.selection.active, markdown);
      });
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: markdown,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc);
  });
}

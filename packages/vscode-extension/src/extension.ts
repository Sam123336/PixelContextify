import * as vscode from 'vscode';
import { BackendClient, SUPPORTED_MIME_TYPES } from './backend-client';
import {
  CONTEXTIFY_DROP_KIND,
  ContextifyDropEditProvider,
} from './providers/drop-edit-provider';
import {
  CONTEXTIFY_PASTE_KIND,
  ContextifyPasteEditProvider,
} from './providers/paste-edit-provider';
import { registerAnalyzeFileCommand } from './commands/analyze-file';

const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 120_000;

export function activate(context: vscode.ExtensionContext): void {
  const getClient = (): BackendClient => {
    const baseUrl = vscode.workspace
      .getConfiguration('contextify')
      .get<string>('backendUrl', DEFAULT_BACKEND_URL);
    return new BackendClient({ baseUrl });
  };

  const getTimeoutMs = (): number =>
    vscode.workspace
      .getConfiguration('contextify')
      .get<number>('timeoutMs', DEFAULT_TIMEOUT_MS);

  const dropMimeTypes = [...SUPPORTED_MIME_TYPES, 'text/uri-list'];
  const pasteMimeTypes = [...SUPPORTED_MIME_TYPES];
  const selector: vscode.DocumentSelector = '*';

  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider(
      selector,
      new ContextifyDropEditProvider(getClient, getTimeoutMs),
      {
        dropMimeTypes,
        providedDropEditKinds: [CONTEXTIFY_DROP_KIND],
      },
    ),
    vscode.languages.registerDocumentPasteEditProvider(
      selector,
      new ContextifyPasteEditProvider(getClient, getTimeoutMs),
      {
        pasteMimeTypes,
        providedPasteEditKinds: [CONTEXTIFY_PASTE_KIND],
      },
    ),
    registerAnalyzeFileCommand(getClient, getTimeoutMs),
  );
}

export function deactivate(): void {
  // disposables are managed via context.subscriptions
}

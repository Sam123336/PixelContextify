import * as vscode from 'vscode';
import type { LlmOverride, LlmProvider } from '@contextifly/shared';
import { BackendClient, SUPPORTED_MIME_TYPES } from './backend-client';
import {
  CONTEXTIFLY_DROP_KIND,
  ContextiflyDropEditProvider,
} from './providers/drop-edit-provider';
import {
  CONTEXTIFLY_PASTE_KIND,
  ContextiflyPasteEditProvider,
} from './providers/paste-edit-provider';
import { registerAnalyzeFileCommand } from './commands/analyze-file';
import { registerProviderStatusBar } from './provider-status-bar';

const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 120_000;

export function activate(context: vscode.ExtensionContext): void {
  const getLlmOverride = (): LlmOverride | null => {
    const cfg = vscode.workspace.getConfiguration('contextifly');
    const provider = cfg.get<string>('llm.provider', 'default');
    const apiKey = cfg.get<string>('llm.apiKey', '').trim();
    if (provider === 'default' || !apiKey) {
      return null;
    }
    const model = cfg.get<string>('llm.model', '').trim();
    const baseUrl = cfg.get<string>('llm.baseUrl', '').trim();
    return {
      provider: provider as LlmProvider,
      apiKey,
      ...(model ? { model } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  };

  const getClient = (): BackendClient => {
    const baseUrl = vscode.workspace
      .getConfiguration('contextifly')
      .get<string>('backendUrl', DEFAULT_BACKEND_URL);
    return new BackendClient({ baseUrl, llm: getLlmOverride() });
  };

  const getTimeoutMs = (): number =>
    vscode.workspace
      .getConfiguration('contextifly')
      .get<number>('timeoutMs', DEFAULT_TIMEOUT_MS);

  const dropMimeTypes = [...SUPPORTED_MIME_TYPES, 'text/uri-list'];
  const pasteMimeTypes = [...SUPPORTED_MIME_TYPES];
  const selector: vscode.DocumentSelector = '*';

  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider(
      selector,
      new ContextiflyDropEditProvider(getClient, getTimeoutMs),
      {
        dropMimeTypes,
        providedDropEditKinds: [CONTEXTIFLY_DROP_KIND],
      },
    ),
    vscode.languages.registerDocumentPasteEditProvider(
      selector,
      new ContextiflyPasteEditProvider(getClient, getTimeoutMs),
      {
        pasteMimeTypes,
        providedPasteEditKinds: [CONTEXTIFLY_PASTE_KIND],
      },
    ),
    registerAnalyzeFileCommand(getClient, getTimeoutMs),
    ...registerProviderStatusBar(),
  );
}

export function deactivate(): void {
  // disposables are managed via context.subscriptions
}

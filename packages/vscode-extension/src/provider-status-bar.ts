import * as vscode from 'vscode';

interface ProviderOption {
  value: string;
  label: string;
  detail: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'default',
    label: 'Default',
    detail: "Use the backend's own key — nothing sent from here.",
  },
  { value: 'gemini', label: 'Gemini', detail: 'Google — your own key.' },
  { value: 'openai', label: 'OpenAI', detail: 'OpenAI — your own key.' },
  {
    value: 'anthropic',
    label: 'Anthropic',
    detail: 'Anthropic Claude — your own key.',
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible',
    detail: 'Any OpenAI-compatible endpoint — needs base URL + model.',
  },
];

const labelFor = (value: string): string =>
  PROVIDER_OPTIONS.find((o) => o.value === value)?.label ?? value;

const SELECT_COMMAND = 'contextify.selectProvider';

/**
 * Adds a status-bar item showing the active LLM provider. Clicking it opens a
 * quick pick to switch — a one-click alternative to digging through Settings.
 */
export function registerProviderStatusBar(): vscode.Disposable[] {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = SELECT_COMMAND;

  const render = (): void => {
    const provider = vscode.workspace
      .getConfiguration('contextify')
      .get<string>('llm.provider', 'default');
    item.text = `$(sparkle) Contextify: ${labelFor(provider)}`;
    item.tooltip =
      provider === 'default'
        ? "Contextify is using the backend's default LLM. Click to switch."
        : `Contextify is using your own ${labelFor(provider)} key. Click to switch.`;
    item.show();
  };

  const command = vscode.commands.registerCommand(SELECT_COMMAND, async () => {
    const cfg = vscode.workspace.getConfiguration('contextify');
    const current = cfg.get<string>('llm.provider', 'default');

    const pick = await vscode.window.showQuickPick(
      PROVIDER_OPTIONS.map((o) => ({
        label: o.value === current ? `$(check) ${o.label}` : o.label,
        description: o.value === current ? 'current' : undefined,
        detail: o.detail,
        value: o.value,
      })),
      { placeHolder: 'Select the LLM provider Contextify should use' },
    );
    if (!pick || pick.value === current) {
      return;
    }

    await cfg.update(
      'llm.provider',
      pick.value,
      vscode.ConfigurationTarget.Global,
    );
    await warnIfIncomplete(pick.value);
  });

  const onChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('contextify.llm.provider')) {
      render();
    }
  });

  render();
  return [item, command, onChange];
}

/** Nudge the user to settings if the chosen provider is missing credentials. */
async function warnIfIncomplete(provider: string): Promise<void> {
  if (provider === 'default') {
    return;
  }
  const cfg = vscode.workspace.getConfiguration('contextify');
  const missing: string[] = [];
  if (!cfg.get<string>('llm.apiKey', '').trim()) {
    missing.push('API key');
  }
  if (provider === 'openai-compatible') {
    if (!cfg.get<string>('llm.baseUrl', '').trim()) {
      missing.push('base URL');
    }
    if (!cfg.get<string>('llm.model', '').trim()) {
      missing.push('model');
    }
  }
  if (missing.length === 0) {
    return;
  }

  const open = 'Open Settings';
  const choice = await vscode.window.showWarningMessage(
    `Contextify: switched to ${labelFor(provider)}, but its ${missing.join(' and ')} ${
      missing.length > 1 ? 'are' : 'is'
    } not set yet.`,
    open,
  );
  if (choice === open) {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'contextify.llm',
    );
  }
}

export {};

declare global {
  interface Window {
    opencodeCodexAuth: {
      appVersion: string;
      getState: () => Promise<unknown>;
      onStateChanged: (listener: (state: unknown) => void) => () => void;
      refreshAll: () => Promise<unknown>;
      refreshAccount: (accountId: string) => Promise<unknown>;
      updateSettings: (patch: { currentMode?: "opencode" | "codex"; opencodeAuthPath?: string; codexAuthPath?: string }) => Promise<unknown>;
      pickAuthPath: () => Promise<unknown>;
      loginImportAccount: () => Promise<unknown>;
      importLiveAccount: () => Promise<unknown>;
      importFileAccount: () => Promise<unknown>;
      importFilePayloads: (payloads: Array<{ name: string; raw: string }>) => Promise<unknown>;
      renameAccount: (accountId: string, label: string) => Promise<unknown>;
      deleteAccount: (accountId: string) => Promise<unknown>;
      activateAccount: (accountId: string) => Promise<unknown>;
      exportAccount: (accountIds?: string[]) => Promise<unknown>;
    };
  }
}

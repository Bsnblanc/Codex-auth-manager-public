export {};

declare global {
  interface Window {
    opencodeCodexAuth: {
      appVersion: string;
      getState: () => Promise<unknown>;
      refreshAll: () => Promise<unknown>;
      refreshAccount: (accountId: string) => Promise<unknown>;
      updateSettings: (patch: { opencodeAuthPath?: string; pollIntervalMs?: number }) => Promise<unknown>;
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

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opencodeCodexAuth", {
  appVersion: "0.1.0",
  getState: () => ipcRenderer.invoke("dashboard:get-state"),
  refreshAll: () => ipcRenderer.invoke("dashboard:refresh-all"),
  refreshAccount: (accountId: string) => ipcRenderer.invoke("dashboard:refresh-account", accountId),
  updateSettings: (patch: { currentMode?: "opencode" | "codex"; opencodeAuthPath?: string; codexAuthPath?: string; pollIntervalMs?: number }) => ipcRenderer.invoke("settings:update", patch),
  pickAuthPath: () => ipcRenderer.invoke("settings:pick-auth-path"),
  loginImportAccount: () => ipcRenderer.invoke("accounts:login-import"),
  importLiveAccount: () => ipcRenderer.invoke("accounts:import-live"),
  importFileAccount: () => ipcRenderer.invoke("accounts:import-file"),
  importFilePayloads: (payloads: Array<{ name: string; raw: string }>) => ipcRenderer.invoke("accounts:import-file-payloads", payloads),
  renameAccount: (accountId: string, label: string) => ipcRenderer.invoke("accounts:rename", accountId, label),
  deleteAccount: (accountId: string) => ipcRenderer.invoke("accounts:delete", accountId),
  activateAccount: (accountId: string) => ipcRenderer.invoke("accounts:activate", accountId),
  exportAccount: (accountIds?: string[]) => ipcRenderer.invoke("accounts:export", accountIds)
});

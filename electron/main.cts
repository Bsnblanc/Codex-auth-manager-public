import type { DashboardState, ExportResult, HistoryEntry, ImportResult, ManagedAccount } from "./types.js";

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const {
  buildExportPayload,
  captureJsonFileSnapshot,
  mergeAccountIntoOpenCodeAuth,
  normalizeAutoLabels,
  pickCodexAuthEntry,
  readJsonFile,
  readOpenCodeAuthFile,
  restoreJsonFileSnapshot,
  upsertManagedAccount,
  writeJsonAtomic
} = require("./opencode.js");
const { getImportNotices, getSameTeamAbortMessage } = require("./import-notices.js");
const { classifyLiveAuthSync } = require("./live-auth-sync.js");
const { fetchQuotaSnapshot } = require("./quotas.js");
const { loadStore, recordHistory, saveStore, toDashboardState } = require("./store.js");
const { pickAutoSwitchAccount } = require("./auto-switch.js");

let storeMutationQueue: Promise<void> = Promise.resolve();
let suppressLiveAuthSyncCount = 0;

function runStoreMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const queued = storeMutationQueue.then(mutation, mutation);
  storeMutationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function sanitizeExportFileName(value: string) {
  const normalized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized || "account";
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 360,
    minHeight: 300,
    useContentSize: true,
    backgroundColor: "#f4f1ea",
    title: "OpenCode Codex Auth Manager",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  window.setMenuBarVisibility(false);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function sortAccounts(accounts: ManagedAccount[], activeAccountId: string | null): ManagedAccount[] {
  return [...accounts].sort((left, right) => {
    if (left.id === activeAccountId) return -1;
    if (right.id === activeAccountId) return 1;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

async function importManagedAccountWithQuota(
  store: Awaited<ReturnType<typeof loadStore>>,
  providerKey: string,
  authFragment: ManagedAccount["authFragment"],
  options?: {
    abortOnSameTeam?: boolean;
    activateImportedAccount?: boolean;
  }
): Promise<ImportResult> {
  const { accounts, accountId } = upsertManagedAccount(store.accounts, providerKey, authFragment);
  const importedAccount = accounts.find((account: ManagedAccount) => account.id === accountId);

  if (!importedAccount) {
    throw new Error("Imported account could not be resolved after creation.");
  }

  const shouldAbortOnSameTeam = options?.abortOnSameTeam ?? true;
  const shouldActivateImportedAccount = options?.activateImportedAccount ?? false;
  if (shouldAbortOnSameTeam) {
    const duplicateTeamMessage = getSameTeamAbortMessage(accounts, accountId);
    if (duplicateTeamMessage) {
      throw new Error(duplicateTeamMessage);
    }
  }

  const fetchedAt = new Date().toISOString();
  const historyEntries: HistoryEntry[] = [];
  let finalAccountId = accountId;
  let hydratedAccounts: ManagedAccount[];

  try {
    const snapshot = await fetchQuotaSnapshot(importedAccount, fetchedAt);
    const upserted = upsertManagedAccount(accounts, providerKey, authFragment, {
      email: snapshot.email ?? importedAccount.email,
      accountId: snapshot.accountId ?? importedAccount.accountId,
      planType: snapshot.planType ?? importedAccount.planType,
      jwtMetadata: snapshot.jwtMetadata ?? importedAccount.jwtMetadata
    });
    finalAccountId = upserted.accountId;
    if (shouldAbortOnSameTeam) {
      const duplicateTeamMessage = getSameTeamAbortMessage(upserted.accounts, upserted.accountId);
      if (duplicateTeamMessage) {
        throw new Error(duplicateTeamMessage);
      }
    }
    historyEntries.push({
      accountId: upserted.accountId,
      batchAt: fetchedAt,
      windows: snapshot.windows
    });

    hydratedAccounts = upserted.accounts.map((account: ManagedAccount) =>
      account.id === upserted.accountId
        ? {
            ...account,
            updatedAt: fetchedAt,
            email: snapshot.email ?? account.email,
            accountId: snapshot.accountId ?? account.accountId,
            planType: snapshot.planType ?? account.planType,
            jwtMetadata: snapshot.jwtMetadata ?? account.jwtMetadata,
            lastQuota: snapshot,
            lastError: null
          }
        : account
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("已存在相同 team/account 容器")) {
      throw error;
    }
    hydratedAccounts = accounts.map((account: ManagedAccount) =>
      account.id === accountId
        ? {
            ...account,
            updatedAt: fetchedAt,
            jwtMetadata: account.jwtMetadata,
            lastError: error instanceof Error ? error.message : String(error)
          }
        : account
    );
  }

  const nextStore = {
    ...store,
    revision: store.revision + 1,
    activeAccountId: shouldActivateImportedAccount ? finalAccountId : store.activeAccountId,
    accounts: sortAccounts(normalizeAutoLabels(hydratedAccounts), store.activeAccountId),
    history: recordHistory(store.history, historyEntries)
  };

  nextStore.accounts = sortAccounts(nextStore.accounts, nextStore.activeAccountId);

  await saveStore(nextStore);
  const notices = getImportNotices(nextStore.accounts, finalAccountId);

  return {
    importedAccountId: finalAccountId,
    importedAccountIds: [finalAccountId],
    state: toDashboardState(nextStore),
    notices
  };
}

async function importAuthFiles(
  filePaths: string[],
  store: Awaited<ReturnType<typeof loadStore>>
): Promise<ImportResult> {
  let workingStore = store;
  let latestState = toDashboardState(store);
  const importedAccountIds: string[] = [];
  const notices: string[] = [];

  for (const filePath of filePaths) {
    try {
      const imported = await readJsonFile(filePath);
      const picked = pickCodexAuthEntry(imported);
      if (!picked) {
        throw new Error("所选文件不包含 Codex/OpenAI OAuth 片段");
      }

      const result = await importManagedAccountWithQuota(workingStore, picked.providerKey, picked.authFragment);
      workingStore = await loadStore();
      latestState = result.state;
      importedAccountIds.push(...result.importedAccountIds);
      notices.push(...result.notices);
    } catch (error) {
      notices.push(`${path.basename(filePath)}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (importedAccountIds.length === 0 && notices.length > 0) {
    throw new Error(notices.join("\n"));
  }

  return {
    importedAccountId: importedAccountIds[importedAccountIds.length - 1] ?? null,
    importedAccountIds,
    state: latestState,
    notices
  };
}

async function importAuthPayloads(
  payloads: Array<{ name: string; raw: string }>,
  store: Awaited<ReturnType<typeof loadStore>>
): Promise<ImportResult> {
  let workingStore = store;
  let latestState = toDashboardState(store);
  const importedAccountIds: string[] = [];
  const notices: string[] = [];

  for (const payload of payloads) {
    try {
      const imported = JSON.parse(payload.raw) as unknown;
      const picked = pickCodexAuthEntry(imported);
      if (!picked) {
        throw new Error("所选文件不包含 Codex/OpenAI OAuth 片段");
      }

      const result = await importManagedAccountWithQuota(workingStore, picked.providerKey, picked.authFragment);
      workingStore = await loadStore();
      latestState = result.state;
      importedAccountIds.push(...result.importedAccountIds);
      notices.push(...result.notices);
    } catch (error) {
      notices.push(`${payload.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (importedAccountIds.length === 0 && notices.length > 0) {
    throw new Error(notices.join("\n"));
  }

  return {
    importedAccountId: importedAccountIds[importedAccountIds.length - 1] ?? null,
    importedAccountIds,
    state: latestState,
    notices
  };
}

async function refreshAllState() {
  let store = await loadStore();
  let liveAuthSyncChangedActive = false;

  const liveAuth = suppressLiveAuthSyncCount > 0 ? {} : await readOpenCodeAuthFile(store.settings.opencodeAuthPath);
  const liveAuthEntry = suppressLiveAuthSyncCount > 0 ? null : pickCodexAuthEntry(liveAuth);
  if (liveAuthEntry?.authFragment?.access) {
    const liveAuthSync = classifyLiveAuthSync(store.accounts, store.activeAccountId, liveAuthEntry.authFragment.access);
    if (liveAuthSync.kind === "existing" || liveAuthSync.kind === "current") {
      const synced = upsertManagedAccount(store.accounts, liveAuthEntry.providerKey, liveAuthEntry.authFragment);
      liveAuthSyncChangedActive = liveAuthSync.changedActiveAccount;
      store = {
        ...store,
        activeAccountId: synced.accountId,
        accounts: sortAccounts(normalizeAutoLabels(synced.accounts), synced.accountId)
      };
    } else if (liveAuthSync.kind === "new") {
      await importManagedAccountWithQuota(store, liveAuthEntry.providerKey, liveAuthEntry.authFragment, {
        abortOnSameTeam: false,
        activateImportedAccount: true
      });
      store = await loadStore();
      liveAuthSyncChangedActive = true;
    }
  }

  const batchAt = new Date().toISOString();
  const historyEntries: HistoryEntry[] = [];

  const refreshedAccounts = await Promise.all(
    store.accounts.map(async (account: ManagedAccount) => {
      try {
        const snapshot = await fetchQuotaSnapshot(account, batchAt);
        historyEntries.push({
          accountId: account.id,
          batchAt,
          windows: snapshot.windows
        });
        return {
            ...account,
            updatedAt: batchAt,
            email: snapshot.email ?? account.email,
            accountId: snapshot.accountId ?? account.accountId,
            planType: snapshot.planType ?? account.planType,
            jwtMetadata: snapshot.jwtMetadata ?? account.jwtMetadata,
            lastQuota: snapshot,
            lastError: null
          };
      } catch (error) {
        return {
            ...account,
            updatedAt: batchAt,
            jwtMetadata: account.jwtMetadata,
            lastError: error instanceof Error ? error.message : String(error)
          };
      }
    })
  );

  const nextStore = {
    ...store,
    revision: store.revision + 1,
    accounts: sortAccounts(normalizeAutoLabels(refreshedAccounts), store.activeAccountId),
    history: recordHistory(store.history, historyEntries)
  };

  const replacementAccount = liveAuthSyncChangedActive ? null : pickAutoSwitchAccount(nextStore.accounts, nextStore.activeAccountId);
  if (replacementAccount) {
    try {
      await mergeAccountIntoOpenCodeAuth(store.settings.opencodeAuthPath, replacementAccount);
      nextStore.activeAccountId = replacementAccount.id;
      nextStore.accounts = sortAccounts(
        nextStore.accounts.map((account: ManagedAccount) =>
          account.id === replacementAccount.id
            ? {
                ...account,
                lastSyncedAt: batchAt,
                updatedAt: batchAt
              }
            : account
        ),
        replacementAccount.id
      );
    } catch {
      // Keep refreshed state even if the auth handoff fails.
    }
  }

  await saveStore(nextStore);
  return toDashboardState(nextStore);
}

async function refreshAccountState(accountId: string) {
  let store = await loadStore();
  let liveAuthSyncChangedActive = false;

  const liveAuth = suppressLiveAuthSyncCount > 0 ? {} : await readOpenCodeAuthFile(store.settings.opencodeAuthPath);
  const liveAuthEntry = suppressLiveAuthSyncCount > 0 ? null : pickCodexAuthEntry(liveAuth);
  if (liveAuthEntry?.authFragment?.access) {
    const liveAuthSync = classifyLiveAuthSync(store.accounts, store.activeAccountId, liveAuthEntry.authFragment.access);
    if (liveAuthSync.kind === "existing" || liveAuthSync.kind === "current") {
      const synced = upsertManagedAccount(store.accounts, liveAuthEntry.providerKey, liveAuthEntry.authFragment);
      liveAuthSyncChangedActive = liveAuthSync.changedActiveAccount;
      store = {
        ...store,
        activeAccountId: synced.accountId,
        accounts: sortAccounts(normalizeAutoLabels(synced.accounts), synced.accountId)
      };
    } else if (liveAuthSync.kind === "new") {
      await importManagedAccountWithQuota(store, liveAuthEntry.providerKey, liveAuthEntry.authFragment, {
        abortOnSameTeam: false,
        activateImportedAccount: true
      });
      store = await loadStore();
      liveAuthSyncChangedActive = true;
    }
  }

  const targetAccount = store.accounts.find((account: ManagedAccount) => account.id === accountId);
  if (!targetAccount) {
    throw new Error("Managed account not found.");
  }

  const batchAt = new Date().toISOString();
  const historyEntries: HistoryEntry[] = [];

  let refreshedAccount: ManagedAccount;
  try {
    const snapshot = await fetchQuotaSnapshot(targetAccount, batchAt);
    historyEntries.push({
      accountId: targetAccount.id,
      batchAt,
      windows: snapshot.windows
    });
    refreshedAccount = {
      ...targetAccount,
      updatedAt: batchAt,
      email: snapshot.email ?? targetAccount.email,
      accountId: snapshot.accountId ?? targetAccount.accountId,
      planType: snapshot.planType ?? targetAccount.planType,
      jwtMetadata: snapshot.jwtMetadata ?? targetAccount.jwtMetadata,
      lastQuota: snapshot,
      lastError: null
    };
  } catch (error) {
    refreshedAccount = {
      ...targetAccount,
      updatedAt: batchAt,
      jwtMetadata: targetAccount.jwtMetadata,
      lastError: error instanceof Error ? error.message : String(error)
    };
  }

  const refreshedAccounts = store.accounts.map((account: ManagedAccount) => account.id === accountId ? refreshedAccount : account);
  const nextStore = {
    ...store,
    revision: store.revision + 1,
    accounts: sortAccounts(normalizeAutoLabels(refreshedAccounts), store.activeAccountId),
    history: recordHistory(store.history, historyEntries)
  };

  const replacementAccount = liveAuthSyncChangedActive ? null : pickAutoSwitchAccount(nextStore.accounts, nextStore.activeAccountId);
  if (replacementAccount) {
    try {
      await mergeAccountIntoOpenCodeAuth(store.settings.opencodeAuthPath, replacementAccount);
      nextStore.activeAccountId = replacementAccount.id;
      nextStore.accounts = sortAccounts(
        nextStore.accounts.map((account: ManagedAccount) =>
          account.id === replacementAccount.id
            ? {
                ...account,
                lastSyncedAt: batchAt,
                updatedAt: batchAt
              }
            : account
        ),
        replacementAccount.id
      );
    } catch {
      // Keep refreshed state even if auth handoff fails.
    }
  }

  await saveStore(nextStore);
  return toDashboardState(nextStore);
}

async function bootstrapState(): Promise<DashboardState> {
  const store = await loadStore();
  const nextStore = {
    ...store,
    accounts: sortAccounts(store.accounts, store.activeAccountId)
  };
  return toDashboardState(nextStore);
}

function registerIpcHandlers() {
  ipcMain.handle("dashboard:get-state", async () => bootstrapState());
  ipcMain.handle("dashboard:refresh-all", async () => runStoreMutation(() => refreshAllState()));
  ipcMain.handle("dashboard:refresh-account", async (_event: unknown, accountId: string) => runStoreMutation(() => refreshAccountState(accountId)));

  ipcMain.handle("settings:update", async (_event: unknown, patch: { opencodeAuthPath?: string; pollIntervalMs?: number }) => runStoreMutation(async () => {
    const store = await loadStore();
    const nextStore = {
      ...store,
      revision: store.revision + 1,
      settings: {
        ...store.settings,
        ...(patch.opencodeAuthPath ? { opencodeAuthPath: patch.opencodeAuthPath } : {}),
        ...(typeof patch.pollIntervalMs === "number" ? { pollIntervalMs: Math.max(60000, patch.pollIntervalMs) } : {})
      }
    };
    await saveStore(nextStore);
    return toDashboardState(nextStore);
  }));

  ipcMain.handle("settings:pick-auth-path", async () => runStoreMutation(async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose OpenCode auth.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const store = await loadStore();
    const nextStore = {
      ...store,
      revision: store.revision + 1,
      settings: {
        ...store.settings,
        opencodeAuthPath: result.filePaths[0]
      }
    };
    await saveStore(nextStore);
    return toDashboardState(nextStore);
  }));

  ipcMain.handle("accounts:import-live", async () => runStoreMutation(async () => {
    const store = await loadStore();
    const liveAuth = await readOpenCodeAuthFile(store.settings.opencodeAuthPath);
    const picked = pickCodexAuthEntry(liveAuth);
    if (!picked) {
      throw new Error("No Codex/OpenAI OAuth entry was found in the configured OpenCode auth file.");
    }
    const importedResult = await importManagedAccountWithQuota(store, picked.providerKey, picked.authFragment);
    return importedResult;
  }));

  ipcMain.handle("accounts:login-import", async () => runStoreMutation(async () => {
    const store = await loadStore();
    const authSnapshot = await captureJsonFileSnapshot(store.settings.opencodeAuthPath);
    suppressLiveAuthSyncCount += 1;

    try {
      await new Promise((resolve, reject) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Start-Process cmd.exe -ArgumentList '/c opencode auth login' -Wait"
          ],
          {
            windowsHide: false,
            cwd: process.cwd(),
            stdio: "ignore"
          }
        );

        child.once("error", reject);
        child.once("exit", (code: number | null) => {
          if (code === 0) {
            resolve(null);
          } else {
            reject(new Error(`opencode auth login exited with code ${code}`));
          }
        });
      });

      let picked;
      try {
        const liveAuth = await readOpenCodeAuthFile(store.settings.opencodeAuthPath);
        picked = pickCodexAuthEntry(liveAuth);
        if (!picked) {
          throw new Error("No Codex/OpenAI OAuth entry was found in the configured OpenCode auth file after login.");
        }
      } finally {
        await restoreJsonFileSnapshot(store.settings.opencodeAuthPath, authSnapshot);
      }
      const importedResult = await importManagedAccountWithQuota(store, picked.providerKey, picked.authFragment);
      return importedResult;
    } finally {
      suppressLiveAuthSyncCount = Math.max(0, suppressLiveAuthSyncCount - 1);
    }
  }));

  ipcMain.handle("accounts:import-file", async () => runStoreMutation(async () => {
    const dialogResult = await dialog.showOpenDialog({
      title: "Import Codex auth JSON files",
      buttonLabel: "Import selected JSON files",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return null;
    }

    const store = await loadStore();
    return importAuthFiles(dialogResult.filePaths, store);
  }));

  ipcMain.handle("accounts:import-file-payloads", async (_event: unknown, payloads: Array<{ name: string; raw: string }>) => runStoreMutation(async () => {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return null;
    }

    const store = await loadStore();
    return importAuthPayloads(payloads, store);
  }));

  ipcMain.handle("accounts:rename", async (_event: unknown, accountId: string, label: string) => runStoreMutation(async () => {
    const store = await loadStore();
    const nextStore = {
      ...store,
      revision: store.revision + 1,
      accounts: store.accounts.map((account: ManagedAccount) =>
        account.id === accountId ? { ...account, label: label.trim() || account.label, labelIsAuto: false, updatedAt: new Date().toISOString() } : account
      )
    };
    await saveStore(nextStore);
    return toDashboardState(nextStore);
  }));

  ipcMain.handle("accounts:delete", async (_event: unknown, accountId: string) => runStoreMutation(async () => {
    const store = await loadStore();
    const nextAccounts = store.accounts.filter((account: ManagedAccount) => account.id !== accountId);
    const nextStore = {
      ...store,
      revision: store.revision + 1,
      accounts: sortAccounts(normalizeAutoLabels(nextAccounts), store.activeAccountId === accountId ? null : store.activeAccountId),
      activeAccountId: store.activeAccountId === accountId ? null : store.activeAccountId,
      history: store.history.filter((entry: HistoryEntry) => entry.accountId !== accountId)
    };
    await saveStore(nextStore);
    return toDashboardState(nextStore);
  }));

  ipcMain.handle("accounts:activate", async (_event: unknown, accountId: string) => runStoreMutation(async () => {
    const store = await loadStore();
    const account = store.accounts.find((item: ManagedAccount) => item.id === accountId);
    if (!account) {
      throw new Error("Managed account not found.");
    }

    await mergeAccountIntoOpenCodeAuth(store.settings.opencodeAuthPath, account);
    const timestamp = new Date().toISOString();
    const nextStore = {
      ...store,
      revision: store.revision + 1,
      activeAccountId: accountId,
      accounts: sortAccounts(normalizeAutoLabels(
        store.accounts.map((item: ManagedAccount) =>
          item.id === accountId
            ? {
                ...item,
                lastSyncedAt: timestamp,
                updatedAt: timestamp
              }
            : item
        ),
      ),
        accountId
      )
    };
    await saveStore(nextStore);
    return toDashboardState(nextStore);
  }));

  ipcMain.handle("accounts:export", async (_event: unknown, accountIds?: string | string[]) => {
    const store = await loadStore();
    const normalizedAccountIds = Array.isArray(accountIds)
      ? accountIds
      : typeof accountIds === "string" && accountIds.trim().length > 0
        ? [accountIds]
        : [];
    const targetIds = normalizedAccountIds.length > 0 ? normalizedAccountIds : store.accounts.map((account: ManagedAccount) => account.id);
    const accounts = targetIds
      .map((accountId: string) => store.accounts.find((item: ManagedAccount) => item.id === accountId) ?? null)
      .filter((account: ManagedAccount | null): account is ManagedAccount => Boolean(account));

    if (accounts.length === 0) {
      throw new Error("No managed accounts were selected for export.");
    }

    if (accounts.length === 1) {
      const [account] = accounts;
      const result = await dialog.showSaveDialog({
        title: "Export Codex auth",
        defaultPath: `${sanitizeExportFileName(account.label)}.codex-auth.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      await writeJsonAtomic(result.filePath, await buildExportPayload(account));
      const exportResult: ExportResult = {
        exportedAccountIds: [account.id],
        filePaths: [result.filePath]
      };
      return exportResult;
    }

    const result = await dialog.showOpenDialog({
      title: "Export Codex auth batch",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const exportDirectory = result.filePaths[0];
    const filePaths: string[] = [];
    for (const account of accounts) {
      const filePath = path.join(exportDirectory, `${sanitizeExportFileName(account.label)}-${account.id.slice(0, 8)}.codex-auth.json`);
      await writeJsonAtomic(filePath, await buildExportPayload(account));
      filePaths.push(filePath);
    }

    const exportResult: ExportResult = {
      exportedAccountIds: accounts.map((account: ManagedAccount) => account.id),
      filePaths
    };
    return exportResult;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

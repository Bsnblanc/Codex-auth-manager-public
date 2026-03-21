import { app } from "electron";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { AppSettings, AppStore, DashboardState, HistoryEntry, ManagedAccount } from "./types.js";

const HISTORY_LIMIT = 1200;

const FALLBACK_COLORS = [
  "#4C7A67",
  "#C76B50",
  "#6A78C7",
  "#8B6CC2",
  "#C89D49",
  "#A45E78",
  "#577A9B",
  "#6F8C55"
];

function defaultOpenCodeAuthPath() {
  return path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
}

function defaultCodexAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function canUseAccountInMode(account: ManagedAccount, mode: AppSettings["currentMode"]) {
  if (mode === "opencode") {
    return typeof account.authFragment.access === "string" && typeof account.authFragment.refresh === "string";
  }

  return typeof account.authFragment.access === "string"
    && typeof account.authFragment.refresh === "string"
    && typeof account.authFragment.id_token === "string";
}

function defaultSettings(): AppSettings {
  return {
    currentMode: "opencode",
    opencodeAuthPath: defaultOpenCodeAuthPath(),
    codexAuthPath: defaultCodexAuthPath(),
    pollIntervalMs: 600000
  };
}

function defaultStore(): AppStore {
  return {
    revision: 0,
    settings: defaultSettings(),
    activeOpenCodeAccountId: null,
    activeCodexAccountId: null,
    accounts: [],
    history: []
  };
}

function getStoreFilePath() {
  return path.join(app.getPath("userData"), "manager-store.json");
}

async function ensureStoreDir() {
  await mkdir(path.dirname(getStoreFilePath()), { recursive: true });
}

export async function loadStore(): Promise<AppStore> {
  try {
    const raw = await readFile(getStoreFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppStore>;
    return {
      ...defaultStore(),
      ...parsed,
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
      settings: {
        ...defaultSettings(),
        ...(parsed.settings ?? {})
      },
      activeOpenCodeAccountId:
        typeof (parsed as Partial<AppStore> & { activeAccountId?: unknown }).activeAccountId === "string"
          ? (parsed as Partial<AppStore> & { activeAccountId?: string | null }).activeAccountId ?? null
          : parsed.activeOpenCodeAccountId ?? null,
      activeCodexAccountId: parsed.activeCodexAccountId ?? null,
      accounts: (parsed.accounts ?? []).map((account) => ({
        ...account,
        labelIsAuto: account.labelIsAuto ?? true
      })),
      history: parsed.history ?? []
    };
  } catch {
    return defaultStore();
  }
}

export async function saveStore(store: AppStore): Promise<void> {
  await ensureStoreDir();
  const target = getStoreFilePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

export function toDashboardState(store: AppStore): DashboardState {
  const visibleAccounts = store.accounts.filter((account) => canUseAccountInMode(account, store.settings.currentMode));
  return {
    revision: store.revision,
    settings: store.settings,
    activeOpenCodeAccountId: store.activeOpenCodeAccountId,
    activeCodexAccountId: store.activeCodexAccountId,
    accounts: visibleAccounts,
    history: store.history
  };
}

export function nextAccountColor(accounts: ManagedAccount[]) {
  return FALLBACK_COLORS[accounts.length % FALLBACK_COLORS.length];
}

export function recordHistory(history: HistoryEntry[], nextEntries: HistoryEntry[]): HistoryEntry[] {
  return [...history, ...nextEntries].slice(-HISTORY_LIMIT);
}

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

function defaultSettings(): AppSettings {
  return {
    opencodeAuthPath: defaultOpenCodeAuthPath(),
    pollIntervalMs: 600000
  };
}

function defaultStore(): AppStore {
  return {
    revision: 0,
    settings: defaultSettings(),
    activeAccountId: null,
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
  return {
    revision: store.revision,
    settings: store.settings,
    activeAccountId: store.activeAccountId,
    accounts: store.accounts,
    history: store.history
  };
}

export function nextAccountColor(accounts: ManagedAccount[]) {
  return FALLBACK_COLORS[accounts.length % FALLBACK_COLORS.length];
}

export function recordHistory(history: HistoryEntry[], nextEntries: HistoryEntry[]): HistoryEntry[] {
  return [...history, ...nextEntries].slice(-HISTORY_LIMIT);
}

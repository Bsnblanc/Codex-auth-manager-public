import { app } from "electron";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { AppSettings, AppStore, AuthBase, CodexAuthExtras, DashboardState, HistoryEntry, ManagedAccount } from "./types.js";

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

export class StoreReadError extends Error {
  readonly storePath: string;
  readonly cause: unknown;

  constructor(message: string, storePath: string, cause: unknown) {
    super(message);
    this.name = "StoreReadError";
    this.storePath = storePath;
    this.cause = cause;
  }
}

type RecoveredStore = {
  store: AppStore;
  notice: string | null;
  quarantinedStorePath: string | null;
};

function defaultOpenCodeAuthPath() {
  return path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
}

function defaultCodexAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFileError(value: unknown): value is { code: "ENOENT" } {
  return isObject(value) && value.code === "ENOENT";
}

function toAuthBase(value: unknown): AuthBase | null {
  if (!isObject(value) || value.type !== "oauth" || typeof value.access !== "string" || typeof value.refresh !== "string") {
    return null;
  }

  return {
    type: "oauth",
    access: value.access,
    refresh: value.refresh,
    ...(typeof value.expires === "number" ? { expires: value.expires } : {}),
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    ...(typeof value.enterpriseUrl === "string" ? { enterpriseUrl: value.enterpriseUrl } : {})
  };
}

function toCodexAuthExtras(value: unknown): CodexAuthExtras | null {
  if (!isObject(value) || typeof value.idToken !== "string") {
    return null;
  }

  return {
    idToken: value.idToken,
    ...(typeof value.authMode === "string" ? { authMode: value.authMode } : {}),
    ...(typeof value.lastRefresh === "string" ? { lastRefresh: value.lastRefresh } : {}),
    ...(typeof value.openaiApiKey === "string" || value.openaiApiKey === null ? { openaiApiKey: value.openaiApiKey } : {})
  };
}

function getManagedUserKey(account: Pick<ManagedAccount, "email" | "jwtMetadata">) {
  return account.jwtMetadata?.userId
    ?? account.jwtMetadata?.chatgptUserId
    ?? account.jwtMetadata?.subject
    ?? account.email
    ?? null;
}

function mergeCodexExtras(current: CodexAuthExtras | null, incoming: CodexAuthExtras | null): CodexAuthExtras | null {
  if (!current) {
    return incoming ? { ...incoming } : null;
  }

  if (!incoming) {
    return current;
  }

  return {
    idToken: incoming.idToken || current.idToken,
    authMode: incoming.authMode ?? current.authMode,
    lastRefresh: incoming.lastRefresh ?? current.lastRefresh,
    openaiApiKey: incoming.openaiApiKey ?? current.openaiApiKey
  };
}

function maxIso(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function choosePrimaryAccount(left: ManagedAccount, right: ManagedAccount, preferredIds: Set<string>) {
  const leftPreferred = preferredIds.has(left.id);
  const rightPreferred = preferredIds.has(right.id);
  if (leftPreferred !== rightPreferred) {
    return leftPreferred ? left : right;
  }

  if (Boolean(left.codexExtras) !== Boolean(right.codexExtras)) {
    return left.codexExtras ? left : right;
  }

  if (Boolean(left.lastQuota) !== Boolean(right.lastQuota)) {
    return left.lastQuota ? left : right;
  }

  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt >= right.updatedAt ? left : right;
  }

  return left;
}

function mergeManagedAccounts(primary: ManagedAccount, secondary: ManagedAccount): ManagedAccount {

  return {
    ...primary,
    label: primary.labelIsAuto && !secondary.labelIsAuto ? secondary.label : primary.label,
    labelIsAuto: primary.labelIsAuto && secondary.labelIsAuto,
    authBase: primary.authBase,
    codexExtras: mergeCodexExtras(primary.codexExtras, secondary.codexExtras),
    createdAt: primary.createdAt <= secondary.createdAt ? primary.createdAt : secondary.createdAt,
    updatedAt: primary.updatedAt >= secondary.updatedAt ? primary.updatedAt : secondary.updatedAt,
    lastSyncedAt: maxIso(primary.lastSyncedAt, secondary.lastSyncedAt),
    planType: primary.planType ?? secondary.planType,
    email: primary.email ?? secondary.email,
    accountId: primary.accountId ?? secondary.accountId,
    jwtMetadata: primary.jwtMetadata ?? secondary.jwtMetadata,
    lastQuota: primary.lastQuota ?? secondary.lastQuota,
    lastError: primary.lastError ?? secondary.lastError
  };
}

function dedupeManagedAccounts(accounts: ManagedAccount[], preferredIds: Set<string>) {
  const deduped: ManagedAccount[] = [];
  const identityToCanonicalId = new Map<string, string>();
  const canonicalById = new Map<string, ManagedAccount>();
  const idMap = new Map<string, string>();

  for (const account of accounts) {
    const userKey = getManagedUserKey(account);
    const identityKey = account.accountId && userKey ? `${account.accountId}::${userKey}` : null;

    if (!identityKey) {
      deduped.push(account);
      canonicalById.set(account.id, account);
      continue;
    }

    const canonicalId = identityToCanonicalId.get(identityKey);
    if (!canonicalId) {
      identityToCanonicalId.set(identityKey, account.id);
      canonicalById.set(account.id, account);
      deduped.push(account);
      continue;
    }

    if (preferredIds.has(canonicalId) && preferredIds.has(account.id)) {
      identityToCanonicalId.delete(identityKey);
      canonicalById.set(account.id, account);
      deduped.push(account);
      continue;
    }

    const currentCanonical = canonicalById.get(canonicalId) ?? account;
    const primary = choosePrimaryAccount(currentCanonical, account, preferredIds);
    const secondary = primary.id === currentCanonical.id ? account : currentCanonical;
    const nextCanonicalId = primary.id;
    const merged = mergeManagedAccounts(primary, secondary);

    canonicalById.delete(canonicalId);
    canonicalById.set(nextCanonicalId, merged);
    identityToCanonicalId.set(identityKey, nextCanonicalId);
    if (canonicalId !== nextCanonicalId) {
      idMap.set(canonicalId, nextCanonicalId);
    }
    if (account.id !== nextCanonicalId) {
      idMap.set(account.id, nextCanonicalId);
    }

    const dedupedIndex = deduped.findIndex((item) => item.id === canonicalId || item.id === nextCanonicalId);
    if (dedupedIndex >= 0) {
      deduped[dedupedIndex] = merged;
    }
  }

  return { accounts: deduped, idMap };
}

function remapHistoryEntries(history: HistoryEntry[], idMap: Map<string, string>) {
  const remapped = history.map((entry) => ({
    ...entry,
    accountId: idMap.get(entry.accountId) ?? entry.accountId
  }));

  return Array.from(new Map(remapped.map((entry) => [`${entry.accountId}::${entry.batchAt}`, entry])).values());
}

function normalizeManagedAccount(account: unknown): ManagedAccount | null {
  if (!isObject(account)) {
    return null;
  }

  const authBase = toAuthBase(account.authBase) ?? toAuthBase(account.authFragment);
  if (!authBase || typeof account.id !== "string" || typeof account.label !== "string" || typeof account.color !== "string") {
    return null;
  }

  const legacyFragment = isObject(account.authFragment) ? account.authFragment : null;
  const legacyIdToken = legacyFragment && typeof legacyFragment.id_token === "string" ? legacyFragment.id_token : null;
  const legacyAuthMode = legacyFragment && typeof legacyFragment.auth_mode === "string" ? legacyFragment.auth_mode : undefined;
  const legacyLastRefresh = legacyFragment && typeof legacyFragment.last_refresh === "string" ? legacyFragment.last_refresh : undefined;
  const jwtMetadata = isObject(account.jwtMetadata) ? account.jwtMetadata as ManagedAccount["jwtMetadata"] : null;
  const lastQuota = isObject(account.lastQuota) ? account.lastQuota as ManagedAccount["lastQuota"] : null;
  const codexExtras = toCodexAuthExtras(account.codexExtras) ?? (legacyIdToken
    ? {
        idToken: legacyIdToken,
        ...(legacyAuthMode ? { authMode: legacyAuthMode } : {}),
        ...(legacyLastRefresh ? { lastRefresh: legacyLastRefresh } : {})
      }
    : null);

  return {
    id: account.id,
    label: account.label,
    labelIsAuto: typeof account.labelIsAuto === "boolean" ? account.labelIsAuto : true,
    color: account.color,
    providerKey: typeof account.providerKey === "string" ? account.providerKey : "openai",
    authBase,
    codexExtras,
    createdAt: typeof account.createdAt === "string" ? account.createdAt : new Date(0).toISOString(),
    updatedAt: typeof account.updatedAt === "string" ? account.updatedAt : new Date(0).toISOString(),
    lastSyncedAt: typeof account.lastSyncedAt === "string" ? account.lastSyncedAt : null,
    planType: typeof account.planType === "string" ? account.planType : null,
    email: typeof account.email === "string" ? account.email : null,
    accountId: typeof account.accountId === "string" ? account.accountId : authBase.accountId ?? null,
    jwtMetadata,
    lastQuota,
    lastError: typeof account.lastError === "string" ? account.lastError : null
  };
}

function canUseAccountInMode(account: ManagedAccount, mode: AppSettings["currentMode"]) {
  if (mode === "opencode") {
    return typeof account.authBase.access === "string" && typeof account.authBase.refresh === "string";
  }

  return typeof account.authBase.access === "string"
    && typeof account.authBase.refresh === "string"
    && typeof account.codexExtras?.idToken === "string";
}

function sortVisibleAccounts(accounts: ManagedAccount[], activeAccountId: string | null) {
  return [...accounts].sort((left, right) => {
    if (left.id === activeAccountId) return -1;
    if (right.id === activeAccountId) return 1;

    const byLabel = left.label.localeCompare(right.label, undefined, { sensitivity: "base", numeric: true });
    if (byLabel !== 0) {
      return byLabel;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function defaultSettings(): AppSettings {
  return {
    currentMode: "opencode",
    opencodeAuthPath: defaultOpenCodeAuthPath(),
    codexAuthPath: defaultCodexAuthPath()
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

function parseStore(raw: string): AppStore {
  const parsedJson = JSON.parse(raw) as unknown;
  if (!isObject(parsedJson)) {
    throw new Error("Managed store JSON must be an object.");
  }

  const parsed = parsedJson as Partial<AppStore>;
  const parsedSettings = isObject(parsed.settings) ? parsed.settings as Record<string, unknown> : null;
  const normalizedAccounts = (parsed.accounts ?? []).map((account) => normalizeManagedAccount(account)).filter((account): account is ManagedAccount => Boolean(account));
  const legacyActiveOpenCodeId = typeof (parsed as Partial<AppStore> & { activeAccountId?: unknown }).activeAccountId === "string"
    ? (parsed as Partial<AppStore> & { activeAccountId?: string | null }).activeAccountId ?? null
    : null;
  const preferredIds = new Set<string>([
    legacyActiveOpenCodeId,
    parsed.activeOpenCodeAccountId ?? null,
    parsed.activeCodexAccountId ?? null
  ].filter((value): value is string => Boolean(value)));
  const dedupedAccounts = dedupeManagedAccounts(normalizedAccounts, preferredIds);
  const remapId = (accountId: string | null | undefined) => accountId ? dedupedAccounts.idMap.get(accountId) ?? accountId : null;

  return {
    ...defaultStore(),
    ...parsed,
    revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    settings: {
      ...defaultSettings(),
      ...(((parsed as Partial<AppStore> & { currentMode?: unknown }).currentMode === "opencode"
        || (parsed as Partial<AppStore> & { currentMode?: unknown }).currentMode === "codex")
        ? { currentMode: (parsed as Partial<AppStore> & { currentMode?: AppSettings["currentMode"] }).currentMode ?? "opencode" }
        : {}),
      ...((parsedSettings?.currentMode === "opencode" || parsedSettings?.currentMode === "codex")
        ? { currentMode: parsedSettings.currentMode }
        : {}),
      ...(typeof (parsed as Partial<AppStore> & { opencodeAuthPath?: unknown }).opencodeAuthPath === "string"
        ? { opencodeAuthPath: (parsed as Partial<AppStore> & { opencodeAuthPath?: string }).opencodeAuthPath ?? defaultOpenCodeAuthPath() }
        : {}),
      ...(typeof parsedSettings?.opencodeAuthPath === "string"
        ? { opencodeAuthPath: parsedSettings.opencodeAuthPath }
        : {}),
      ...(typeof (parsed as Partial<AppStore> & { codexAuthPath?: unknown }).codexAuthPath === "string"
        ? { codexAuthPath: (parsed as Partial<AppStore> & { codexAuthPath?: string }).codexAuthPath ?? defaultCodexAuthPath() }
        : {}),
      ...(typeof parsedSettings?.codexAuthPath === "string"
        ? { codexAuthPath: parsedSettings.codexAuthPath }
        : {})
    },
    activeOpenCodeAccountId:
      typeof (parsed as Partial<AppStore> & { activeAccountId?: unknown }).activeAccountId === "string"
        ? remapId(legacyActiveOpenCodeId)
        : remapId(parsed.activeOpenCodeAccountId ?? null),
    activeCodexAccountId: remapId(parsed.activeCodexAccountId ?? null),
    accounts: dedupedAccounts.accounts,
    history: remapHistoryEntries(parsed.history ?? [], dedupedAccounts.idMap)
  };
}

function getQuarantinedStorePath(storePath: string) {
  const parsedPath = path.parse(storePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(parsedPath.dir, `${parsedPath.name}.corrupt-${timestamp}${parsedPath.ext}`);
}

export async function loadStore(): Promise<AppStore> {
  const storePath = getStoreFilePath();
  let raw: string;

  try {
    raw = await readFile(storePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultStore();
    }

    throw new StoreReadError(`Managed store could not be read: ${storePath}`, storePath, error);
  }

  try {
    return parseStore(raw);
  } catch (error) {
    throw new StoreReadError(`Managed store is unreadable or corrupt: ${storePath}`, storePath, error);
  }
}

export async function loadStoreWithRecovery(): Promise<RecoveredStore> {
  try {
    return {
      store: await loadStore(),
      notice: null,
      quarantinedStorePath: null
    };
  } catch (error) {
    if (!(error instanceof StoreReadError)) {
      throw error;
    }

    const quarantinedStorePath = getQuarantinedStorePath(error.storePath);
    await rename(error.storePath, quarantinedStorePath);

    return {
      store: defaultStore(),
      notice: `The existing managed store could not be read, so it was quarantined at ${quarantinedStorePath}. A fresh store will be used.`,
      quarantinedStorePath
    };
  }
}

export async function loadStoreForImportRecovery(): Promise<RecoveredStore> {
  const recovered = await loadStoreWithRecovery();
  return {
    ...recovered,
    notice: recovered.quarantinedStorePath
      ? `The existing managed store could not be read, so it was quarantined at ${recovered.quarantinedStorePath}. Imported accounts will be saved into a fresh store.`
      : recovered.notice
  };
}

export async function saveStore(store: AppStore): Promise<void> {
  await ensureStoreDir();
  const target = getStoreFilePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

export function toDashboardState(store: AppStore): DashboardState {
  const activeAccountId = store.settings.currentMode === "codex" ? store.activeCodexAccountId : store.activeOpenCodeAccountId;
  const visibleAccounts = sortVisibleAccounts(
    store.accounts.filter((account) => canUseAccountInMode(account, store.settings.currentMode)),
    activeAccountId
  );
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

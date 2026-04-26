import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAccountIdFromJwt, getEmailFromJwt, getJwtMetadata } from "./jwt.js";
import { nextAccountColor } from "./store.js";
import type { AuthBase, AuthFileRecord, AuthMode, AuthProviderEntry, CodexAuthExtras, ManagedAccount, ProviderKey } from "./types.js";

const PREFERRED_KEYS: ProviderKey[] = ["opencode", "codex", "openai", "chatgpt"];

type CodexDirectAuthFile = {
  auth_mode?: string | null;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
    account_id?: string | null;
  } | null;
  last_refresh?: string | null;
};

type PickedManagedAuth = {
  providerKey: ProviderKey;
  authBase: AuthBase;
  codexExtras: CodexAuthExtras | null;
};

type Sub2ApiCredential = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  chatgpt_account_id?: string;
  expires_at?: number | string;
};

type Sub2ApiAccount = {
  platform: "openai";
  type: "oauth";
  credentials: Sub2ApiCredential;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOauthEntry(value: unknown): value is AuthProviderEntry {
  return isObject(value) && value.type === "oauth" && typeof value.access === "string" && typeof value.refresh === "string";
}

function isCodexDirectAuthFile(value: unknown): value is CodexDirectAuthFile {
  if (!isObject(value)) {
    return false;
  }

  const tokens = value.tokens;
  return isObject(tokens)
    && typeof tokens.id_token === "string"
    && typeof tokens.access_token === "string"
    && typeof tokens.refresh_token === "string";
}

function isSub2ApiCredential(value: unknown): value is Sub2ApiCredential {
  return isObject(value)
    && typeof value.access_token === "string"
    && typeof value.refresh_token === "string"
    && typeof value.id_token === "string";
}

function isSub2ApiAccount(value: unknown): value is Sub2ApiAccount {
  return isObject(value)
    && value.platform === "openai"
    && value.type === "oauth"
    && isSub2ApiCredential(value.credentials);
}

function normalizeSub2ApiExpires(value: unknown): number | null {
  let timestamp: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    timestamp = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      timestamp = numeric;
    } else {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        timestamp = parsed;
      }
    }
  }

  if (timestamp === null) {
    return null;
  }

  return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
}

function pickSub2ApiAuthEntries(source: unknown): PickedManagedAuth[] {
  if (!isObject(source) || !Array.isArray(source.accounts)) {
    return [];
  }

  const exportedAt = typeof source.exported_at === "string" ? source.exported_at : new Date().toISOString();

  return source.accounts.flatMap((account): PickedManagedAuth[] => {
    if (!isSub2ApiAccount(account)) {
      return [];
    }

    const credentials = account.credentials;
    const expires = normalizeSub2ApiExpires(credentials.expires_at);
    return [{
      providerKey: "openai",
      authBase: {
        type: "oauth",
        access: credentials.access_token,
        refresh: credentials.refresh_token,
        ...(typeof credentials.chatgpt_account_id === "string" ? { accountId: credentials.chatgpt_account_id } : {}),
        ...(typeof expires === "number" ? { expires } : {})
      },
      codexExtras: {
        idToken: credentials.id_token,
        authMode: "chatgpt",
        lastRefresh: exportedAt
      }
    }];
  });
}

function pickDirectCodexAuthEntry(source: unknown): PickedManagedAuth | null {
  if (!isCodexDirectAuthFile(source)) {
    return null;
  }

  const tokens = source.tokens;
  const accessToken = tokens?.access_token;
  const refreshToken = tokens?.refresh_token;
  const idToken = tokens?.id_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string" || typeof idToken !== "string") {
    return null;
  }

  const jwtMetadata = getJwtMetadata(accessToken);
  return {
    providerKey: "codex",
    authBase: {
      type: "oauth",
      access: accessToken,
      refresh: refreshToken,
      ...(jwtMetadata?.expiresAt ? { expires: jwtMetadata.expiresAt * 1000 } : {}),
      ...(typeof source.tokens?.account_id === "string" ? { accountId: source.tokens.account_id } : {})
    },
    codexExtras: {
      idToken,
      ...(typeof source.auth_mode === "string" ? { authMode: source.auth_mode } : {}),
      ...(typeof source.last_refresh === "string" ? { lastRefresh: source.last_refresh } : {}),
      ...(typeof source.OPENAI_API_KEY === "string" || source.OPENAI_API_KEY === null ? { openaiApiKey: source.OPENAI_API_KEY } : {})
    }
  };
}

function pickPreferredOauthAuth(source: unknown): PickedManagedAuth | null {
  if (isOauthEntry(source)) {
    return buildPickedOauthAuth("openai", source);
  }

  if (!isObject(source)) {
    return null;
  }

  for (const preferredKey of PREFERRED_KEYS) {
    const candidate = source[preferredKey];
    if (isOauthEntry(candidate)) {
      return buildPickedOauthAuth(preferredKey, candidate);
    }
  }

  return null;
}

function toAuthBase(fragment: AuthProviderEntry): AuthBase | null {
  if (fragment.type !== "oauth" || typeof fragment.access !== "string" || typeof fragment.refresh !== "string") {
    return null;
  }

  return {
    type: "oauth",
    access: fragment.access,
    refresh: fragment.refresh,
    ...(typeof fragment.expires === "number" ? { expires: fragment.expires } : {}),
    ...(typeof fragment.accountId === "string" ? { accountId: fragment.accountId } : {}),
    ...(typeof fragment.enterpriseUrl === "string" ? { enterpriseUrl: fragment.enterpriseUrl } : {})
  };
}

function toCodexAuthExtras(fragment: AuthProviderEntry): CodexAuthExtras | null {
  if (typeof fragment.id_token !== "string") {
    return null;
  }

  return {
    idToken: fragment.id_token,
    ...(typeof fragment.auth_mode === "string" ? { authMode: fragment.auth_mode } : {}),
    ...(typeof fragment.last_refresh === "string" ? { lastRefresh: fragment.last_refresh } : {})
  };
}

function toOpenCodeAuthFragment(authBase: AuthBase): AuthProviderEntry {
  return {
    type: "oauth",
    access: authBase.access,
    refresh: authBase.refresh,
    ...(typeof authBase.expires === "number" ? { expires: authBase.expires } : {}),
    ...(typeof authBase.accountId === "string" ? { accountId: authBase.accountId } : {}),
    ...(typeof authBase.enterpriseUrl === "string" ? { enterpriseUrl: authBase.enterpriseUrl } : {})
  };
}

function buildOpenCodeAuthFile(authBase: AuthBase): AuthFileRecord {
  return {
    openai: toOpenCodeAuthFragment(authBase)
  };
}

function buildDirectCodexAuthFile(account: Pick<ManagedAccount, "authBase" | "codexExtras">): CodexDirectAuthFile {
  const { authBase, codexExtras } = account;
  if (!codexExtras?.idToken) {
    throw new Error("Managed account is missing direct Codex auth fields and must be reacquired from a direct Codex auth file.");
  }

  return {
    auth_mode: codexExtras.authMode ?? "chatgpt",
    OPENAI_API_KEY: codexExtras.openaiApiKey ?? null,
    tokens: {
      id_token: codexExtras.idToken,
      access_token: authBase.access,
      refresh_token: authBase.refresh,
      account_id: authBase.accountId ?? getAccountIdFromJwt(authBase.access)
    },
    last_refresh: codexExtras.lastRefresh ?? new Date().toISOString()
  };
}

function buildPickedOauthAuth(providerKey: ProviderKey, fragment: AuthProviderEntry): PickedManagedAuth | null {
  const authBase = toAuthBase(fragment);
  if (!authBase) {
    return null;
  }

  return {
    providerKey,
    authBase,
    codexExtras: toCodexAuthExtras(fragment)
  };
}

function resolveAccountId(authBase: AuthBase, resolved?: { accountId: string | null }) {
  return resolved?.accountId ?? authBase.accountId ?? getAccountIdFromJwt(authBase.access);
}

function mergeCodexAuthExtras(current: CodexAuthExtras | null, incoming: CodexAuthExtras | null): CodexAuthExtras | null {
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

function mergeAuthBase(current: AuthBase, incoming: AuthBase, resolved?: { accountId: string | null }): AuthBase {
  const accountId = resolveAccountId(incoming, resolved);
  return {
    type: "oauth",
    access: incoming.access,
    refresh: incoming.refresh,
    expires: incoming.expires ?? current.expires,
    accountId: accountId ?? undefined,
    enterpriseUrl: incoming.enterpriseUrl ?? current.enterpriseUrl
  };
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

export async function readOpenCodeAuthFile(filePath: string): Promise<AuthFileRecord> {
  try {
    const parsed = await readJsonFile(filePath);
    return isObject(parsed) ? (parsed as AuthFileRecord) : {};
  } catch {
    return {};
  }
}

export function pickCodexAuthEntry(source: unknown): PickedManagedAuth | null {
  return pickDirectCodexAuthEntry(source) ?? pickPreferredOauthAuth(source);
}

export function pickAuthEntriesForMode(mode: AuthMode, source: unknown): PickedManagedAuth[] {
  const sub2ApiEntries = pickSub2ApiAuthEntries(source);
  if (sub2ApiEntries.length > 0) {
    return sub2ApiEntries;
  }

  const picked = mode === "codex"
    ? pickDirectCodexAuthEntry(source)
    : pickPreferredOauthAuth(source);
  return picked ? [picked] : [];
}

export function pickAuthEntryForMode(mode: AuthMode, source: unknown): PickedManagedAuth | null {
  return pickAuthEntriesForMode(mode, source)[0] ?? null;
}

export function canUseAccountInMode(account: ManagedAccount, mode: AuthMode) {
  if (mode === "opencode") {
    return typeof account.authBase.access === "string" && typeof account.authBase.refresh === "string";
  }

  return typeof account.authBase.access === "string"
    && typeof account.authBase.refresh === "string"
    && typeof account.codexExtras?.idToken === "string";
}

function inferAccountLabel(authBase: AuthBase, fallback: string) {
  const email = getEmailFromJwt(authBase.access);
  if (email) {
    return email;
  }
  return fallback;
}

function buildAutoLabel(account: Pick<ManagedAccount, "email" | "planType" | "accountId">, fallback: string) {
  const identity = account.email ?? account.accountId ?? fallback;
  const plan = account.planType ?? "Subscription";
  return `${identity} · ${plan}`;
}

function getManagedUserKey(account: Pick<ManagedAccount, "email" | "jwtMetadata">) {
  return account.jwtMetadata?.userId
    ?? account.jwtMetadata?.chatgptUserId
    ?? account.jwtMetadata?.subject
    ?? account.email
    ?? null;
}

export function normalizeAutoLabels(accounts: ManagedAccount[]): ManagedAccount[] {
  const groupedCounts = new Map<string, number>();

  return accounts.map((account) => {
    if (!account.labelIsAuto) {
      return account;
    }

    const base = buildAutoLabel(account, `Account ${groupedCounts.size + 1}`);
    const seen = groupedCounts.get(base) ?? 0;
    groupedCounts.set(base, seen + 1);

    return {
      ...account,
      label: seen === 0 ? base : `${base} #${seen + 1}`
    };
  });
}

function sameSubscription(left: ManagedAccount, authBase: AuthBase) {
  return left.authBase.access === authBase.access;
}

export function upsertManagedAccount(
  accounts: ManagedAccount[],
  providerKey: ProviderKey,
  authBase: AuthBase,
  codexExtras: CodexAuthExtras | null,
  resolved?: { email: string | null; accountId: string | null; planType: string | null; jwtMetadata?: ManagedAccount["jwtMetadata"] | null }
): { accounts: ManagedAccount[]; accountId: string; operation: "created" | "token-update" | "account-merge" } {
  const now = new Date().toISOString();
  const importedAccountId = resolveAccountId(authBase, resolved);
  const email = resolved?.email ?? getEmailFromJwt(authBase.access);
  const jwtMetadata = resolved?.jwtMetadata ?? getJwtMetadata(authBase.access);
  const importedUserKey = getManagedUserKey({ email, jwtMetadata });
  const existingByToken = accounts.find((account) => sameSubscription(account, authBase)) ?? null;

  if (existingByToken) {
    return {
      accounts: normalizeAutoLabels(accounts.map((account) => account.id === existingByToken.id
        ? {
            ...account,
            providerKey: account.providerKey || providerKey,
            authBase: mergeAuthBase(account.authBase, authBase, resolved),
            codexExtras: mergeCodexAuthExtras(account.codexExtras, codexExtras),
            updatedAt: now,
            email: email ?? account.email,
            accountId: importedAccountId ?? account.accountId,
            planType: resolved?.planType ?? account.planType,
            jwtMetadata: jwtMetadata ?? account.jwtMetadata
          }
        : account)),
      accountId: existingByToken.id,
      operation: "token-update"
    };
  }

  const existingByAccountId = importedAccountId && importedUserKey
    ? accounts.find((account) => account.accountId === importedAccountId && getManagedUserKey(account) === importedUserKey)
    : null;

  if (existingByAccountId) {
    return {
      accounts: normalizeAutoLabels(accounts.map((account) => account.id === existingByAccountId.id
        ? {
            ...account,
            authBase: mergeAuthBase(account.authBase, authBase, resolved),
            codexExtras: mergeCodexAuthExtras(account.codexExtras, codexExtras),
            updatedAt: now,
            email: email ?? account.email,
            accountId: importedAccountId ?? account.accountId,
            planType: resolved?.planType ?? account.planType,
            jwtMetadata: jwtMetadata ?? account.jwtMetadata
          }
        : account)),
      accountId: existingByAccountId.id,
      operation: "account-merge"
    };
  }

  const created: ManagedAccount = {
    id: randomUUID(),
    label: inferAccountLabel(authBase, `Account ${accounts.length + 1}`),
    labelIsAuto: true,
    color: nextAccountColor(accounts),
    providerKey,
    authBase,
    codexExtras: codexExtras ? { ...codexExtras } : null,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    planType: resolved?.planType ?? null,
    email,
    accountId: importedAccountId,
    jwtMetadata,
    lastQuota: null,
    lastError: null
  };

  return {
    accounts: normalizeAutoLabels([...accounts, created]),
    accountId: created.id,
    operation: "created"
  };
}

export async function writeJsonAtomic(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await writeFile(temp, JSON.stringify(payload, null, 2), "utf8");
  await rename(temp, filePath);
}

export async function mergeAccountIntoOpenCodeAuth(filePath: string, account: ManagedAccount): Promise<void> {
  const authFile = await readOpenCodeAuthFile(filePath);
  if (isCodexDirectAuthFile(authFile)) {
    await writeJsonAtomic(filePath, buildDirectCodexAuthFile(account));
    return;
  }

  const currentEntry = pickCodexAuthEntry(authFile);
  const targetKey = currentEntry?.providerKey ?? "openai";
  authFile[targetKey] = toOpenCodeAuthFragment(account.authBase);
  await writeJsonAtomic(filePath, authFile);
}

export async function buildExportPayload(account: ManagedAccount, mode: AuthMode) {
  return mode === "codex"
    ? buildDirectCodexAuthFile(account)
    : buildOpenCodeAuthFile(account.authBase);
}

export type JsonFileSnapshot = {
  exists: boolean;
  raw: string | null;
};

export async function captureJsonFileSnapshot(filePath: string): Promise<JsonFileSnapshot> {
  try {
    return {
      exists: true,
      raw: await readFile(filePath, "utf8")
    };
  } catch {
    return {
      exists: false,
      raw: null
    };
  }
}

export async function restoreJsonFileSnapshot(filePath: string, snapshot: JsonFileSnapshot): Promise<void> {
  if (!snapshot.exists) {
    try {
      await unlink(filePath);
    } catch {
      // Ignore missing file on restore.
    }
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, snapshot.raw ?? "{}", "utf8");
}

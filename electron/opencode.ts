import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAccountIdFromJwt, getEmailFromJwt, getJwtMetadata } from "./jwt.js";
import { nextAccountColor } from "./store.js";
import type { AuthFileRecord, AuthProviderEntry, ManagedAccount, ProviderKey } from "./types.js";

const PREFERRED_KEYS: ProviderKey[] = ["opencode", "codex", "openai", "chatgpt"];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOauthEntry(value: unknown): value is AuthProviderEntry {
  return isObject(value) && value.type === "oauth" && typeof value.access === "string";
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

export function pickCodexAuthEntry(source: unknown): { providerKey: ProviderKey; authFragment: AuthProviderEntry } | null {
  if (isOauthEntry(source)) {
    return {
      providerKey: "openai",
      authFragment: source
    };
  }

  if (!isObject(source)) return null;

  const managerFragment = source["authFragment"];
  const managerKey = source["providerKey"];
  if (typeof managerKey === "string" && isOauthEntry(managerFragment)) {
    return {
      providerKey: managerKey,
      authFragment: managerFragment
    };
  }

  for (const preferredKey of PREFERRED_KEYS) {
    const candidate = source[preferredKey];
    if (isOauthEntry(candidate)) {
      return {
        providerKey: preferredKey,
        authFragment: candidate
      };
    }
  }

  for (const [providerKey, candidate] of Object.entries(source)) {
    if (isOauthEntry(candidate)) {
      return {
        providerKey,
        authFragment: candidate
      };
    }
  }

  return null;
}

function inferAccountLabel(fragment: AuthProviderEntry, fallback: string) {
  const email = typeof fragment.access === "string" ? getEmailFromJwt(fragment.access) : null;
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

function sameSubscription(
  left: ManagedAccount,
  providerKey: ProviderKey,
  fragment: AuthProviderEntry
) {
  return left.authFragment.access === fragment.access;
}

export function upsertManagedAccount(
  accounts: ManagedAccount[],
  providerKey: ProviderKey,
  authFragment: AuthProviderEntry,
  resolved?: { email: string | null; accountId: string | null; planType: string | null; jwtMetadata?: ManagedAccount["jwtMetadata"] | null }
): { accounts: ManagedAccount[]; accountId: string } {
  const existing = accounts.find((account) => sameSubscription(account, providerKey, authFragment));
  const now = new Date().toISOString();

  if (existing) {
    existing.authFragment = authFragment;
    existing.updatedAt = now;
    existing.email = resolved?.email ?? (typeof authFragment.access === "string" ? getEmailFromJwt(authFragment.access) : existing.email);
    existing.accountId = resolved?.accountId ?? (typeof authFragment.access === "string" ? getAccountIdFromJwt(authFragment.access) : existing.accountId);
    existing.planType = resolved?.planType ?? existing.planType;
    existing.jwtMetadata = resolved?.jwtMetadata ?? (typeof authFragment.access === "string" ? getJwtMetadata(authFragment.access) : existing.jwtMetadata);
    return {
      accounts: normalizeAutoLabels([...accounts]),
      accountId: existing.id
    };
  }

  const created: ManagedAccount = {
    id: randomUUID(),
    label: inferAccountLabel(authFragment, `Account ${accounts.length + 1}`),
    labelIsAuto: true,
    color: nextAccountColor(accounts),
    providerKey,
    authFragment,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    planType: resolved?.planType ?? null,
    email: resolved?.email ?? (typeof authFragment.access === "string" ? getEmailFromJwt(authFragment.access) : null),
    accountId: resolved?.accountId ?? (typeof authFragment.access === "string" ? getAccountIdFromJwt(authFragment.access) : null),
    jwtMetadata: resolved?.jwtMetadata ?? (typeof authFragment.access === "string" ? getJwtMetadata(authFragment.access) : null),
    lastQuota: null,
    lastError: null
  };

  return {
    accounts: normalizeAutoLabels([...accounts, created]),
    accountId: created.id
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
  const currentEntry = pickCodexAuthEntry(authFile);
  const targetKey = currentEntry?.providerKey ?? account.providerKey;
  authFile[targetKey] = account.authFragment;
  await writeJsonAtomic(filePath, authFile);
}

export async function buildExportPayload(account: ManagedAccount) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    providerKey: account.providerKey,
    label: account.label,
    color: account.color,
    authFragment: account.authFragment
  };
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

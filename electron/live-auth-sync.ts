import type { ManagedAccount } from "./types.js";

export function findManagedAccountByAccess(accounts: ManagedAccount[], accessToken: string | null | undefined): ManagedAccount | null {
  if (!accessToken) {
    return null;
  }

  return accounts.find((account) => account.authFragment.access === accessToken) ?? null;
}

export function classifyLiveAuthSync(accounts: ManagedAccount[], activeAccountId: string | null, accessToken: string | null | undefined) {
  const matchedAccount = findManagedAccountByAccess(accounts, accessToken);
  if (!matchedAccount) {
    return {
      kind: accessToken ? "new" : "missing",
      matchedAccountId: null,
      changedActiveAccount: false
    } as const;
  }

  return {
    kind: activeAccountId === matchedAccount.id ? "current" : "existing",
    matchedAccountId: matchedAccount.id,
    changedActiveAccount: activeAccountId !== matchedAccount.id
  } as const;
}

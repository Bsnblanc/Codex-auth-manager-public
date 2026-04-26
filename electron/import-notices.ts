import type { ManagedAccount } from "./types.js";

export function getSameTeamAccounts(_accounts: ManagedAccount[], _importedAccountId: string): ManagedAccount[] {
  return [];
}

export function getSameTeamAbortMessage(_accounts: ManagedAccount[], _importedAccountId: string): string | null {
  return null;
}

export function getImportNotices(_accounts: ManagedAccount[], _importedAccountId: string): string[] {
  return [];
}

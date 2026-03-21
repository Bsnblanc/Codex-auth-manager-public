import type { ManagedAccount } from "./types.js";

export function getSameTeamAccounts(accounts: ManagedAccount[], importedAccountId: string): ManagedAccount[] {
  const importedAccount = accounts.find((account) => account.id === importedAccountId) ?? null;
  if (!importedAccount?.accountId) {
    return [];
  }

  return accounts.filter(
    (account) => account.id !== importedAccountId && account.accountId === importedAccount.accountId
  );
}

export function getSameTeamAbortMessage(accounts: ManagedAccount[], importedAccountId: string): string | null {
  const importedAccount = accounts.find((account) => account.id === importedAccountId) ?? null;
  if (!importedAccount?.accountId) {
    return null;
  }

  const sameTeamAccounts = getSameTeamAccounts(accounts, importedAccountId);
  if (sameTeamAccounts.length === 0) {
    return null;
  }

  return `检测到已存在相同 team/account 容器，已终止导入：${sameTeamAccounts.map((account) => account.label).join("、")}（accountId: ${importedAccount.accountId}）`;
}

export function getImportNotices(accounts: ManagedAccount[], importedAccountId: string): string[] {
  const importedAccount = accounts.find((account) => account.id === importedAccountId) ?? null;
  if (!importedAccount?.accountId) {
    return [];
  }

  const sameTeamAccounts = getSameTeamAccounts(accounts, importedAccountId);

  if (sameTeamAccounts.length === 0) {
    return [];
  }

  return [
    `检测到已存在相同 team/account 容器：${sameTeamAccounts.map((account) => account.label).join("、")}（accountId: ${importedAccount.accountId}）。当前记录已单独保留，不会自动合并。`
  ];
}

import type { ManagedAccount } from "./types.js";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getUsableFiveHourRemaining(account: Pick<ManagedAccount, "lastQuota">): number | null {
  const rawRemaining = account.lastQuota?.windows.fiveHour.remainingPercent;
  if (rawRemaining === null || rawRemaining === undefined) {
    return null;
  }

  const weeklyRemaining = account.lastQuota?.windows.weekly.remainingPercent;
  if (weeklyRemaining === null || weeklyRemaining === undefined) {
    return rawRemaining;
  }

  return clamp(Math.min(rawRemaining, weeklyRemaining * 3), 0, 100);
}

export function pickAutoSwitchAccount(accounts: ManagedAccount[], activeAccountId: string | null): ManagedAccount | null {
  if (!activeAccountId) {
    return null;
  }

  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  if (!activeAccount) {
    return null;
  }

  const activeRemaining = getUsableFiveHourRemaining(activeAccount);
  if (activeRemaining === null || activeRemaining > 0) {
    return null;
  }

  return accounts.find((account) => account.id !== activeAccountId && (getUsableFiveHourRemaining(account) ?? 0) > 0) ?? null;
}

import { getAccountIdFromJwt, getEmailFromJwt, getJwtMetadata } from "./jwt.js";
import type { AuthProviderEntry, CreditsSnapshot, ManagedAccount, QuotaSnapshot, QuotaWindowSnapshot } from "./types.js";

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const FETCH_TIMEOUT_MS = 20000;

type RateLimitWindow = {
  used_percent?: number;
  reset_after_seconds?: number;
  reset_at?: number;
};

type UsagePayload = {
  plan_type?: string;
  rate_limit?: {
    primary_window?: RateLimitWindow | null;
    secondary_window?: RateLimitWindow | null;
  } | null;
  code_review_rate_limit?: {
    primary_window?: RateLimitWindow | null;
  } | null;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string | null;
  } | null;
};

function clampPercent(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function normalizeReset(window: RateLimitWindow | null | undefined): string | null {
  if (!window) return null;
  if (typeof window.reset_at === "number" && Number.isFinite(window.reset_at)) {
    return new Date(window.reset_at * 1000).toISOString();
  }
  if (typeof window.reset_after_seconds === "number" && Number.isFinite(window.reset_after_seconds)) {
    return new Date(Date.now() + window.reset_after_seconds * 1000).toISOString();
  }
  return null;
}

function normalizeWindow(window: RateLimitWindow | null | undefined): QuotaWindowSnapshot {
  if (!window || typeof window.used_percent !== "number") {
    return {
      usedPercent: null,
      remainingPercent: null,
      resetAt: null,
      status: "unknown"
    };
  }

  const usedPercent = clampPercent(window.used_percent);
  const remainingPercent = clampPercent(100 - window.used_percent);

  let status: QuotaWindowSnapshot["status"] = "ok";
  if (remainingPercent === null) {
    status = "unknown";
  } else if (remainingPercent <= 0) {
    status = "empty";
  } else if (remainingPercent < 20) {
    status = "critical";
  } else if (remainingPercent < 45) {
    status = "warning";
  }

  return {
    usedPercent,
    remainingPercent,
    resetAt: normalizeReset(window),
    status
  };
}

function normalizeCredits(payload: UsagePayload["credits"]): CreditsSnapshot | null {
  if (!payload) return null;
  return {
    hasCredits: Boolean(payload.has_credits),
    unlimited: Boolean(payload.unlimited),
    balance: payload.balance ?? null
  };
}

function buildUsageUrl(baseUrl?: string) {
  const trimmed = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return trimmed.includes("/backend-api") ? `${trimmed}/wham/usage` : `${trimmed}/api/codex/usage`;
}

export function canPollAccount(fragment: AuthProviderEntry): boolean {
  return fragment.type === "oauth" && typeof fragment.access === "string" && fragment.access.length > 0;
}

export async function fetchQuotaSnapshot(account: ManagedAccount, fetchedAt: string): Promise<QuotaSnapshot> {
  const { authFragment } = account;
  if (!canPollAccount(authFragment)) {
    throw new Error("Managed account is missing OAuth access credentials.");
  }

  const accessToken = authFragment.access as string;
  const jwtMetadata = getJwtMetadata(accessToken);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "OpenCode-Codex-Auth-Manager/0.1"
  };

  const accountId = getAccountIdFromJwt(accessToken);
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(buildUsageUrl(authFragment.enterpriseUrl), { headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Quota request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Quota request failed (${response.status}): ${text.slice(0, 160)}`);
  }

  const payload = (await response.json()) as UsagePayload;
  return {
    fetchedAt,
    planType: payload.plan_type ?? null,
    email: getEmailFromJwt(accessToken) ?? null,
    accountId,
    jwtMetadata,
    windows: {
      fiveHour: normalizeWindow(payload.rate_limit?.primary_window),
      weekly: normalizeWindow(payload.rate_limit?.secondary_window),
      codeReview: normalizeWindow(payload.code_review_rate_limit?.primary_window)
    },
    credits: normalizeCredits(payload.credits),
    source: "wham"
  };
}

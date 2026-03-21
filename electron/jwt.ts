import type { JwtMetadata } from "./types.js";

type JwtPayload = {
  aud?: string[];
  client_id?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  jti?: string;
  nbf?: number;
  pwd_auth_time?: number;
  scp?: string[];
  session_id?: string;
  sl?: boolean;
  sub?: string;
  "https://api.openai.com/profile"?: {
    email?: string;
    email_verified?: boolean;
  };
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    chatgpt_account_user_id?: string;
    chatgpt_compute_residency?: string;
    chatgpt_plan_type?: string;
    chatgpt_user_id?: string;
    user_id?: string;
  };
};

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + "=".repeat(padLen), "base64").toString("utf8");
}

export function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

export function getEmailFromJwt(token: string): string | null {
  return parseJwt(token)?.["https://api.openai.com/profile"]?.email ?? null;
}

export function getAccountIdFromJwt(token: string): string | null {
  return parseJwt(token)?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
}

export function getJwtMetadata(token: string): JwtMetadata | null {
  const payload = parseJwt(token);
  if (!payload) return null;

  const auth = payload["https://api.openai.com/auth"];
  const profile = payload["https://api.openai.com/profile"];

  return {
    audience: Array.isArray(payload.aud) ? payload.aud : [],
    clientId: payload.client_id ?? null,
    expiresAt: payload.exp ?? null,
    issuedAt: payload.iat ?? null,
    issuer: payload.iss ?? null,
    jwtId: payload.jti ?? null,
    notBefore: payload.nbf ?? null,
    passwordAuthTime: payload.pwd_auth_time ?? null,
    scopes: Array.isArray(payload.scp) ? payload.scp : [],
    sessionId: payload.session_id ?? null,
    sessionLogin: typeof payload.sl === "boolean" ? payload.sl : null,
    subject: payload.sub ?? null,
    email: profile?.email ?? null,
    emailVerified: typeof profile?.email_verified === "boolean" ? profile.email_verified : null,
    accountId: auth?.chatgpt_account_id ?? null,
    accountUserId: auth?.chatgpt_account_user_id ?? null,
    computeResidency: auth?.chatgpt_compute_residency ?? null,
    chatgptPlanType: auth?.chatgpt_plan_type ?? null,
    chatgptUserId: auth?.chatgpt_user_id ?? null,
    userId: auth?.user_id ?? null
  };
}

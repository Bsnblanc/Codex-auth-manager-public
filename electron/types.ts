export type ProviderKey = "opencode" | "codex" | "openai" | "chatgpt" | string;

export type AuthMode = "opencode" | "codex";

export type AuthProviderEntry = {
  type?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  enterpriseUrl?: string;
  [key: string]: unknown;
};

export type AuthFileRecord = Record<string, AuthProviderEntry | unknown>;

export type JwtMetadata = {
  audience: string[];
  clientId: string | null;
  expiresAt: number | null;
  issuedAt: number | null;
  issuer: string | null;
  jwtId: string | null;
  notBefore: number | null;
  passwordAuthTime: number | null;
  scopes: string[];
  sessionId: string | null;
  sessionLogin: boolean | null;
  subject: string | null;
  email: string | null;
  emailVerified: boolean | null;
  accountId: string | null;
  accountUserId: string | null;
  computeResidency: string | null;
  chatgptPlanType: string | null;
  chatgptUserId: string | null;
  userId: string | null;
};

export type QuotaWindowKey = "fiveHour" | "weekly" | "codeReview";

export type QuotaWindowSnapshot = {
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
  status: "ok" | "warning" | "critical" | "empty" | "unknown";
};

export type CreditsSnapshot = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

export type QuotaSnapshot = {
  fetchedAt: string;
  planType: string | null;
  email: string | null;
  accountId: string | null;
  jwtMetadata: JwtMetadata | null;
  windows: Record<QuotaWindowKey, QuotaWindowSnapshot>;
  credits: CreditsSnapshot | null;
  source: "wham";
};

export type HistoryEntry = {
  accountId: string;
  batchAt: string;
  windows: Record<QuotaWindowKey, QuotaWindowSnapshot>;
};

export type ManagedAccount = {
  id: string;
  label: string;
  labelIsAuto: boolean;
  color: string;
  providerKey: ProviderKey;
  authFragment: AuthProviderEntry;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  planType: string | null;
  email: string | null;
  accountId: string | null;
  jwtMetadata: JwtMetadata | null;
  lastQuota: QuotaSnapshot | null;
  lastError: string | null;
};

export type AppSettings = {
  currentMode: AuthMode;
  opencodeAuthPath: string;
  codexAuthPath: string;
  pollIntervalMs: number;
};

export type AppStore = {
  revision: number;
  settings: AppSettings;
  activeOpenCodeAccountId: string | null;
  activeCodexAccountId: string | null;
  accounts: ManagedAccount[];
  history: HistoryEntry[];
};

export type DashboardState = {
  revision: number;
  settings: AppSettings;
  activeOpenCodeAccountId: string | null;
  activeCodexAccountId: string | null;
  accounts: ManagedAccount[];
  history: HistoryEntry[];
};

export type ImportResult = {
  importedAccountId: string | null;
  importedAccountIds: string[];
  state: DashboardState;
  notices: string[];
};

export type ExportResult = {
  exportedAccountIds: string[];
  filePaths: string[];
};

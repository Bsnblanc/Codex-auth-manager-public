import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";

type QuotaWindowKey = "fiveHour" | "weekly" | "codeReview";
type Locale = "en-US" | "zh-CN";
type ThemeMode = "light" | "dark";

type QuotaWindowSnapshot = {
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
  status: "ok" | "warning" | "critical" | "empty" | "unknown";
};

type QuotaSnapshot = {
  fetchedAt: string;
  planType: string | null;
  email: string | null;
  accountId: string | null;
  windows: Record<QuotaWindowKey, QuotaWindowSnapshot>;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  source: "wham";
};

type ManagedAccount = {
  id: string;
  label: string;
  color: string;
  providerKey: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  planType: string | null;
  email: string | null;
  accountId: string | null;
  lastQuota: QuotaSnapshot | null;
  lastError: string | null;
};

type HistoryEntry = {
  accountId: string;
  batchAt: string;
  windows: Record<QuotaWindowKey, QuotaWindowSnapshot>;
};

type DashboardState = {
  revision: number;
  settings: {
    opencodeAuthPath: string;
    pollIntervalMs: number;
  };
  activeAccountId: string | null;
  accounts: ManagedAccount[];
  history: HistoryEntry[];
};

type ImportResult = {
  importedAccountId: string | null;
  importedAccountIds: string[];
  state: DashboardState;
  notices: string[];
};

type ExportResult = {
  exportedAccountIds: string[];
  filePaths: string[];
};

type AuthPreviewAction = "default" | "login" | "import" | "export" | "delete";
type AuthPreviewIcon = "key" | "import" | "export" | "delete";
type AuthMotionDirection = "up" | "down" | "none";
type ToolbarMotionAction = "refresh" | "switch";
type RunningAuthAction = Exclude<AuthPreviewAction, "default">;

function isDashboardState(value: unknown): value is DashboardState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DashboardState>;
  return typeof candidate.revision === "number"
    && Array.isArray(candidate.accounts)
    && Array.isArray(candidate.history)
    && typeof candidate.activeAccountId !== "undefined"
    && typeof candidate.settings?.opencodeAuthPath === "string"
    && typeof candidate.settings?.pollIntervalMs === "number";
}

function normalizeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  switch (raw) {
    case "Managed account not found.":
      return "未找到所选账号，请重新选择后重试。";
    case "No managed accounts were selected for export.":
      return "没有可导出的账号。";
    case "No Codex/OpenAI OAuth entry was found in the configured OpenCode auth file.":
      return "当前 Auth 文件中没有找到 Codex/OpenAI OAuth 账号。";
    case "No Codex/OpenAI OAuth entry was found in the configured OpenCode auth file after login.":
      return "登录完成后未在 Auth 文件中找到 Codex/OpenAI OAuth 账号。";
    default:
      return raw;
  }
}

function emptyDashboardState(): DashboardState {
  return {
    revision: 0,
    settings: {
      opencodeAuthPath: "",
      pollIntervalMs: 600000
    },
    activeAccountId: null,
    accounts: [],
    history: []
  };
}

type FocusState =
  | { kind: "overview" }
  | { kind: "aggregate"; quotaKey: QuotaWindowKey }
  | { kind: "account"; accountId: string; quotaKey: QuotaWindowKey };

type AggregateBar = {
  quotaKey: QuotaWindowKey;
  title: string;
  filledPercent: number;
  hasLeadingMarker: boolean;
  hasTrailingMarker: boolean;
  segments: Array<{
    accountId: string;
    label: string;
    color: string;
    remainingPercent: number;
    widthPercent: number;
    startPercent: number;
  }>;
  stateMarkers: Array<{
    accountId: string;
    label: string;
    leftPercent: number;
    color: string;
    anchor: "start" | "center" | "end";
    status: "empty" | "unknown";
  }>;
};

type SeriesPoint = {
  label: string;
  value: number;
  timeMs: number;
};

const QUOTA_KEYS: QuotaWindowKey[] = ["fiveHour", "weekly", "codeReview"];

const VISUAL_COLOR_STOPS = ["#2f8f63", "#4c8f8f", "#6f83b8", "#9a71b9", "#bd6f8d", "#c7834e", "#c89d49"];

function hexToRgb(value: string) {
  const numeric = Number.parseInt(value.slice(1), 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255
  };
}

function rgbToHex(value: { r: number; g: number; b: number }) {
  return `#${[value.r, value.g, value.b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

function interpolateColor(left: string, right: string, amount: number) {
  const from = hexToRgb(left);
  const to = hexToRgb(right);
  return rgbToHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount
  });
}

function getAccountColor(account: ManagedAccount, accounts: ManagedAccount[]): string {
  const index = Math.max(0, accounts.findIndex((item) => item.id === account.id));
  if (accounts.length <= 1 || index === 0) {
    return VISUAL_COLOR_STOPS[0];
  }

  const progress = index / Math.max(accounts.length - 1, 1);
  const scaled = progress * (VISUAL_COLOR_STOPS.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(VISUAL_COLOR_STOPS.length - 1, leftIndex + 1);
  return interpolateColor(VISUAL_COLOR_STOPS[leftIndex], VISUAL_COLOR_STOPS[rightIndex], scaled - leftIndex);
}

const COPY = {
  "en-US": {
    appName: "Codex Auth",
    bridgeTitle: "Desktop bridge failed",
    bridgeBody: "The Electron bridge is unavailable. Restart the app.",
    loading: "Loading accounts...",
    getAuth: "Auth",
    loginImport: "Login",
    importFile: "Import",
    refresh: "Refresh",
    export: "Export",
    settings: "Settings",
    theme: "Theme",
    polling: "Polling",
    minutes: "min",
    dark: "Dark",
    light: "Light",
    authPath: "Auth path",
    browse: "Browse",
    allAccounts: "All accounts",
    active: "Active",
    hideAccounts: "Hide accounts",
    showAccounts: "Show accounts",
    reset: "reset",
    usageFocus: "Usage focus",
    collapseCharts: "Close focus",
    empty: "Empty",
    unknown: "Unknown",
    creditsLabel: "credits",
    trend: "Trend",
    save: "Save",
    useForOpenCode: "Switch",
    replaceFromLive: "Replace from Live",
    delete: "Delete",
    accountUsageHistory: "{name} history",
    aggregateHistory: "{name} aggregate history",
    language: "中文",
    healthy: "Healthy",
    watch: "Watch",
    low: "Low"
  },
  "zh-CN": {
    appName: "Codex Auth",
    bridgeTitle: "桌面桥接失败",
    bridgeBody: "无法与桌面后端通信。请重启应用。",
    loading: "加载中...",
    getAuth: "授权",
    loginImport: "登录",
    importFile: "导入",
    refresh: "刷新",
    export: "导出",
    settings: "设置",
    theme: "主题",
    polling: "查询频率",
    minutes: "min",
    dark: "深色",
    light: "浅色",
    authPath: "Auth 路径",
    browse: "浏览",
    allAccounts: "全部账号",
    active: "当前使用",
    hideAccounts: "隐藏账号",
    showAccounts: "显示账号",
    reset: "重置",
    usageFocus: "用量聚焦",
    collapseCharts: "关闭聚焦",
    empty: "耗尽",
    unknown: "未知",
    creditsLabel: "额度",
    trend: "趋势",
    save: "保存",
    useForOpenCode: "切换",
    replaceFromLive: "用当前覆盖",
    delete: "删除",
    accountUsageHistory: "{name} 用量历史",
    aggregateHistory: "{name} 总体历史",
    language: "English",
    healthy: "正常",
    watch: "关注",
    low: "偏低"
  }
} as const;

function quotaMeta(locale: Locale): Record<QuotaWindowKey, { title: string; subtitle: string }> {
  return locale === "zh-CN"
    ? {
        fiveHour: { title: "5 小时额度", subtitle: "按账号聚合后的当前剩余额度结构" },
        weekly: { title: "周额度", subtitle: "按账号汇总的周额度余量" },
        codeReview: { title: "代码审查", subtitle: "当前可用于代码审查的额度余量" }
      }
    : {
        fiveHour: { title: "5-hour quota", subtitle: "Normalized remaining capacity" },
        weekly: { title: "Weekly quota", subtitle: "Rolling weekly headroom" },
        codeReview: { title: "Code review", subtitle: "Review quota left for connected accounts" }
      };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function statusLabel(status: QuotaWindowSnapshot["status"], locale: Locale) {
  const text = COPY[locale];
  switch (status) {
    case "ok": return text.healthy;
    case "warning": return text.watch;
    case "critical": return text.low;
    case "empty": return text.empty;
    default: return text.unknown;
  }
}

function formatResetAt(resetAt: string | null, locale: Locale, label: string) {
  if (!resetAt) return "";
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return "";

  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return `${label} ${time}`;
  }

  const day = date.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  return `${label} ${day} ${time}`;
}

function getWindow(account: ManagedAccount, key: QuotaWindowKey) {
  return account.lastQuota?.windows[key] ?? null;
}

function getDisplayedRemainingPercent(account: ManagedAccount, key: QuotaWindowKey) {
  const rawRemaining = getWindow(account, key)?.remainingPercent;
  if (rawRemaining === null || rawRemaining === undefined) {
    return null;
  }

  if (key !== "fiveHour") {
    return rawRemaining;
  }

  const weeklyRemaining = getWindow(account, "weekly")?.remainingPercent;
  if (weeklyRemaining === null || weeklyRemaining === undefined) {
    return rawRemaining;
  }

  return clamp(Math.min(rawRemaining, weeklyRemaining * 3), 0, 100);
}

function getDisplayedHistoryRemainingPercent(entry: HistoryEntry, key: QuotaWindowKey) {
  const rawRemaining = entry.windows[key].remainingPercent;
  if (rawRemaining === null || rawRemaining === undefined) {
    return null;
  }

  if (key !== "fiveHour") {
    return rawRemaining;
  }

  const weeklyRemaining = entry.windows.weekly.remainingPercent;
  if (weeklyRemaining === null || weeklyRemaining === undefined) {
    return rawRemaining;
  }

  return clamp(Math.min(rawRemaining, weeklyRemaining * 3), 0, 100);
}

function getCurrentSeriesPoint(accounts: ManagedAccount[], focus: FocusState, quotaKey: QuotaWindowKey): SeriesPoint | null {
  const scopedAccounts = focus.kind === "account"
    ? accounts.filter((account) => account.id === focus.accountId)
    : accounts;

  const values = scopedAccounts
    .map((account) => getDisplayedRemainingPercent(account, quotaKey))
    .filter((value): value is number => value !== null && value !== undefined);

  if (values.length === 0) {
    return null;
  }

  const fetchedAtValues = scopedAccounts
    .map((account) => account.lastQuota?.fetchedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
  const latestFetchedAt = fetchedAtValues.length > 0 ? fetchedAtValues[fetchedAtValues.length - 1] : null;

  const timeMs = latestFetchedAt ? new Date(latestFetchedAt).getTime() : Date.now();

  return {
    label: new Date(timeMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: clamp(values.reduce((sum, current) => sum + current, 0) / values.length, 0, 100),
    timeMs
  };
}

function mergeCurrentSeriesPoint(points: SeriesPoint[], currentPoint: SeriesPoint | null): SeriesPoint[] {
  if (!currentPoint) {
    return points;
  }

  if (points.length === 0) {
    return [currentPoint];
  }

  const next = [...points];
  const lastIndex = next.length - 1;
  if (next[lastIndex].timeMs >= currentPoint.timeMs) {
    next[lastIndex] = currentPoint;
    return next;
  }

  return [...next, currentPoint];
}

function getDisplayedStatus(account: ManagedAccount, key: QuotaWindowKey): QuotaWindowSnapshot["status"] {
  const window = getWindow(account, key);
  if (!window) {
    return "unknown";
  }

  const remainingPercent = getDisplayedRemainingPercent(account, key);
  if (remainingPercent === null) {
    return "unknown";
  }
  if (remainingPercent <= 0) {
    return "empty";
  }
  if (remainingPercent < 20) {
    return "critical";
  }
  if (remainingPercent < 45) {
    return "warning";
  }
  return "ok";
}

function parseIsoTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timeMs = new Date(value).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
}

function getAccountNormalRefreshIntervalMs(account: ManagedAccount) {
  const usableValues = QUOTA_KEYS
    .map((key) => getDisplayedRemainingPercent(account, key))
    .filter((value): value is number => value !== null && value !== undefined && value > 0);

  if (usableValues.length === 0) {
    return null;
  }

  const lowestPercent = Math.min(...usableValues);
  const minutes = Math.max(1, Math.min(10, Math.ceil(lowestPercent / 10)));
  return minutes * 60 * 1000;
}

function getExhaustedWindowResetCandidates(account: ManagedAccount) {
  const candidates: number[] = [];
  const fiveHourWindow = getWindow(account, "fiveHour");
  const weeklyWindow = getWindow(account, "weekly");
  const codeReviewWindow = getWindow(account, "codeReview");

  const rawFiveHourRemaining = fiveHourWindow?.remainingPercent;
  const weeklyRemaining = weeklyWindow?.remainingPercent;
  const reviewRemaining = codeReviewWindow?.remainingPercent;
  const displayedFiveHourRemaining = getDisplayedRemainingPercent(account, "fiveHour");

  if (displayedFiveHourRemaining !== null && displayedFiveHourRemaining <= 0) {
    if (typeof rawFiveHourRemaining === "number" && rawFiveHourRemaining <= 0) {
      const timeMs = parseIsoTime(fiveHourWindow?.resetAt ?? null);
      if (timeMs !== null) {
        candidates.push(timeMs);
      }
    }

    if (typeof weeklyRemaining === "number" && weeklyRemaining <= 0) {
      const timeMs = parseIsoTime(weeklyWindow?.resetAt ?? null);
      if (timeMs !== null) {
        candidates.push(timeMs);
      }
    }
  }

  if (typeof reviewRemaining === "number" && reviewRemaining <= 0) {
    const timeMs = parseIsoTime(codeReviewWindow?.resetAt ?? null);
    if (timeMs !== null) {
      candidates.push(timeMs);
    }
  }

  return [...new Set(candidates)].sort((left, right) => left - right);
}

function getAccountNextRefreshAt(account: ManagedAccount, isActiveAccount: boolean, nowMs: number) {
  const lastKnownAt = parseIsoTime(account.lastQuota?.fetchedAt ?? account.updatedAt ?? account.createdAt) ?? nowMs;
  const dynamicIntervalMs = getAccountNormalRefreshIntervalMs(account);
  const exhaustedResetCandidates = getExhaustedWindowResetCandidates(account).filter((timeMs) => timeMs > nowMs);
  const candidates: number[] = [];

  if (dynamicIntervalMs !== null) {
    candidates.push(lastKnownAt + dynamicIntervalMs);
  }

  if (exhaustedResetCandidates.length > 0) {
    candidates.push(exhaustedResetCandidates[0]);
  } else if (dynamicIntervalMs === null) {
    candidates.push(nowMs + (isActiveAccount ? 5 : 30) * 60 * 1000);
  }

  return Math.min(...candidates);
}

function getCreditsLabel(account: ManagedAccount, locale: Locale, unitLabel: string) {
  const credits = account.lastQuota?.credits;
  if (!credits?.hasCredits) {
    return null;
  }

  if (credits.unlimited) {
    return locale === "zh-CN" ? "无限额度" : "Unlimited";
  }

  if (credits.balance) {
    return `${credits.balance} ${unitLabel}`;
  }

  return unitLabel;
}

function getQuotaBarColor(account: ManagedAccount, accounts: ManagedAccount[], quotaKey: QuotaWindowKey, focus: FocusState) {
  if (focus.kind === "account" && focus.accountId === account.id) {
    return SERIES_META[quotaKey].color;
  }

  return getAccountColor(account, accounts);
}

function computeAggregateBars(accounts: ManagedAccount[], locale: Locale, focus: FocusState): AggregateBar[] {
  const meta = quotaMeta(locale);
  const scopedAccounts = accounts;
  return QUOTA_KEYS.map((quotaKey) => {
    const windows = scopedAccounts
      .map((account) => ({ account, remainingPercent: getDisplayedRemainingPercent(account, quotaKey) }))
      .filter(({ remainingPercent }) => remainingPercent !== null && remainingPercent !== undefined);

    const knownWindows = windows as Array<{ account: ManagedAccount; remainingPercent: number }>;
    const positive = knownWindows.filter(({ remainingPercent }) => remainingPercent > 0);
    const aggregateFilled = knownWindows.length
      ? knownWindows.reduce((sum, { remainingPercent }) => sum + remainingPercent, 0) / knownWindows.length
      : 0;

    const totalPositive = positive.reduce((sum, { remainingPercent }) => sum + remainingPercent, 0);
    const rawStateMarkers: AggregateBar["stateMarkers"] = scopedAccounts.flatMap((account, index) => {
      const remainingPercent = getDisplayedRemainingPercent(account, quotaKey);
      const beforeTotal = scopedAccounts
        .slice(0, index)
        .reduce((sum, item) => sum + Math.max(getDisplayedRemainingPercent(item, quotaKey) ?? 0, 0), 0);
      const fallbackSpread = scopedAccounts.length <= 1 ? 0 : (index / (scopedAccounts.length - 1)) * 100;
      const lineWithinTrack = totalPositive > 0 ? (beforeTotal / totalPositive) * aggregateFilled : fallbackSpread;
      const leftPercent = clamp(lineWithinTrack, 0, 100);
      const isLeadingBoundary = beforeTotal <= 0;
      const isTrailingBoundary = totalPositive > 0 && beforeTotal >= totalPositive;
      const anchor = isLeadingBoundary ? "start" : isTrailingBoundary ? "end" : leftPercent >= 100 ? "end" : "center";

      if (remainingPercent === null) {
        return [{ accountId: account.id, label: account.label, leftPercent, color: getQuotaBarColor(account, scopedAccounts, quotaKey, focus), anchor, status: "unknown" as const }];
      }

      if (remainingPercent <= 0) {
        return [{ accountId: account.id, label: account.label, leftPercent, color: getQuotaBarColor(account, scopedAccounts, quotaKey, focus), anchor, status: "empty" as const }];
      }

      return [] as AggregateBar["stateMarkers"];
    });
    const stateMarkers = rawStateMarkers.filter((marker, index, markers) => {
      if (marker.anchor !== "end") {
        return true;
      }

      const sameEndMarkers = markers.filter((item) => item.anchor === "end" && Math.abs(item.leftPercent - marker.leftPercent) < 0.001);
      if (sameEndMarkers.length <= 1) {
        return true;
      }

      const preferred = [...sameEndMarkers].reverse().find((item) => item.status === "empty") ?? sameEndMarkers[sameEndMarkers.length - 1];
      return preferred === marker && markers.indexOf(marker) === index;
    });

    let runningStart = 0;
    const firstPositiveIndex = scopedAccounts.findIndex((account) => (getDisplayedRemainingPercent(account, quotaKey) ?? 0) > 0);
    const lastPositiveIndex = (() => {
      for (let index = scopedAccounts.length - 1; index >= 0; index -= 1) {
        if ((getDisplayedRemainingPercent(scopedAccounts[index], quotaKey) ?? 0) > 0) {
          return index;
        }
      }
      return -1;
    })();
    const hasLeadingMarker = firstPositiveIndex > 0;
    const hasTrailingMarker = lastPositiveIndex >= 0 && lastPositiveIndex < scopedAccounts.length - 1;

    return {
      quotaKey,
      title: meta[quotaKey].title,
      filledPercent: clamp(aggregateFilled, 0, 100),
      hasLeadingMarker,
      hasTrailingMarker,
      segments: positive.map(({ account, remainingPercent }) => {
        const widthPercent = totalPositive > 0 ? (remainingPercent / totalPositive) * 100 : 0;
        const segment = {
          accountId: account.id,
          label: account.label,
          color: getQuotaBarColor(account, scopedAccounts, quotaKey, focus),
          remainingPercent,
          widthPercent,
          startPercent: runningStart
        };
        runningStart += widthPercent;
        return segment;
      }),
      stateMarkers
    };
  });
}

function buildSeries(history: HistoryEntry[], accounts: ManagedAccount[], focus: FocusState) {
  const sortedEntries = [...history].sort((left, right) => left.batchAt.localeCompare(right.batchAt));
  const selectedQuotaKey = focus.kind === "overview" ? "fiveHour" : focus.quotaKey;
  const timeSpanMs =
    selectedQuotaKey === "fiveHour"
      ? 5 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
  const latestTimeMs = sortedEntries.length ? new Date(sortedEntries[sortedEntries.length - 1].batchAt).getTime() : Date.now();
  const rangeStart = latestTimeMs - timeSpanMs;
  const entries = sortedEntries.filter((entry) => new Date(entry.batchAt).getTime() >= rangeStart);

  const byKey = (quotaKey: QuotaWindowKey): SeriesPoint[] => {
    if (focus.kind === "account") {
      const points = entries
        .filter((entry) => entry.accountId === focus.accountId)
        .map((entry) => {
          const displayedRemaining = getDisplayedHistoryRemainingPercent(entry, quotaKey);
          return {
            label: new Date(entry.batchAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            value: clamp(displayedRemaining ?? 0, 0, 100),
            timeMs: new Date(entry.batchAt).getTime()
          };
        });
      return mergeCurrentSeriesPoint(points, getCurrentSeriesPoint(accounts, focus, quotaKey));
    }

    const grouped = new Map<string, Array<{ accountId: string; value: number }>>();
    for (const entry of sortedEntries) {
      const value = getDisplayedHistoryRemainingPercent(entry, quotaKey);
      if (value === null) continue;
      const bucket = grouped.get(entry.batchAt) ?? [];
      bucket.push({ accountId: entry.accountId, value });
      grouped.set(entry.batchAt, bucket);
    }

    const latestByAccount = new Map<string, number>();
    const points: SeriesPoint[] = [];
    for (const [batchAt, batchValues] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const timeMs = new Date(batchAt).getTime();
      for (const batchValue of batchValues) {
        latestByAccount.set(batchValue.accountId, batchValue.value);
      }
      if (timeMs < rangeStart) {
        continue;
      }

      const values = accounts
        .map((account) => latestByAccount.get(account.id))
        .filter((value): value is number => value !== undefined);
      if (values.length === 0) {
        continue;
      }

      points.push({
        label: new Date(batchAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        value: clamp(values.reduce((sum, current) => sum + current, 0) / Math.max(values.length, 1), 0, 100),
        timeMs
      });
    }

    return mergeCurrentSeriesPoint(points, getCurrentSeriesPoint(accounts, focus, quotaKey));
  };

  return {
    fiveHour: byKey("fiveHour"),
    weekly: byKey("weekly"),
    codeReview: byKey("codeReview")
  };
}

function miniPath(points: SeriesPoint[]) {
  if (points.length === 0) return "";
  const width = 300;
  const height = 80;
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - (point.value / 100) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(points: SeriesPoint[]) {
  if (points.length === 0) return "";
  const width = 300;
  const height = 80;
  const line = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - (point.value / 100) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `${line.join(" ")} L ${width},${height} L 0,${height} Z`;
}

function useDashboardState() {
  const [state, setState] = useState<DashboardState>(emptyDashboardState());
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const applyState = useCallback((next: DashboardState) => {
    setState((current) => next.revision < current.revision ? current : next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    void window.opencodeCodexAuth?.getState().then((next) => {
      if (mountedRef.current) {
        applyState(next as DashboardState);
      }
    }).catch(() => {
      // keep the immediate empty dashboard state
    });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>, onSuccess?: (result: T) => void, options?: { trackBusy?: boolean; clearMessage?: boolean }) => {
    const trackBusy = options?.trackBusy ?? true;
    const clearMessage = options?.clearMessage ?? true;
    try {
      if (trackBusy) {
        setPendingCount((count) => count + 1);
      }
      if (clearMessage) {
        setMessage(null);
      }
      const result = await action();
      if (mountedRef.current) {
        onSuccess?.(result);
      }
      return result;
    } catch (error) {
      if (mountedRef.current) {
        setMessage(normalizeErrorMessage(error));
      }
      return null;
    } finally {
      if (mountedRef.current && trackBusy) {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    }
  }, []);

  return { state, applyState, busy: pendingCount > 0, message, setMessage, run };
}

const IconRefresh = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const IconDownload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline className="icon-arrow-motion" points="7 10 12 15 17 10"/><line className="icon-arrow-motion" x1="12" y1="15" x2="12" y2="3"/></svg>;
const IconSettings = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconChevronDown = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;
const IconLink = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07l-1.7 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
const IconUpload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline className="icon-arrow-motion" points="17 8 12 3 7 8"/><line className="icon-arrow-motion" x1="12" y1="3" x2="12" y2="15"/></svg>;
const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const IconKey = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8.5" cy="15.5" r="4.5"/><path d="M13 15.5h8"/><path d="M18 15.5v-3"/><path d="M21 15.5v-2"/></svg>;

function getAuthPreviewIcon(action: AuthPreviewAction): AuthPreviewIcon {
  switch (action) {
    case "default":
    case "login":
      return "key";
    case "import":
      return "import";
    case "export":
      return "export";
    case "delete":
      return "delete";
  }
}

function authPreviewIconOrder(icon: AuthPreviewIcon) {
  switch (icon) {
    case "key": return 0;
    case "import": return 1;
    case "export": return 2;
    case "delete": return 3;
  }
}

function AuthButtonIcon(props: { icon: AuthPreviewIcon }) {
  switch (props.icon) {
    case "key":
      return <IconKey />;
    case "import":
      return <IconDownload />;
    case "export":
      return <IconUpload />;
    case "delete":
      return <IconTrash />;
  }
}

const SERIES_META: Record<QuotaWindowKey, { color: string; label: { "en-US": string; "zh-CN": string } }> = {
  fiveHour: { color: "#2f7df6", label: { "en-US": "5-hour", "zh-CN": "5 小时" } },
  weekly: { color: "#b7791f", label: { "en-US": "Weekly", "zh-CN": "周额度" } },
  codeReview: { color: "#1f9d7a", label: { "en-US": "Code review", "zh-CN": "代码审查" } }
};

function formatChartTickLabel(timeMs: number, quotaKey: QuotaWindowKey, locale: Locale, compact: boolean) {
  if (quotaKey === "fiveHour") {
    return new Date(timeMs).toLocaleTimeString(locale, compact ? { hour: "numeric" } : { hour: "numeric", minute: "2-digit" });
  }

  return new Date(timeMs).toLocaleDateString(locale, compact ? { month: "numeric", day: "numeric" } : { month: "short", day: "numeric" });
}

function getChartTickStepMs(quotaKey: QuotaWindowKey, narrow: boolean) {
  if (quotaKey === "fiveHour") {
    return (narrow ? 60 : 30) * 60 * 1000;
  }

  return 24 * 60 * 60 * 1000;
}

function alignChartTickFloor(timeMs: number, quotaKey: QuotaWindowKey, stepMs: number) {
  if (quotaKey === "fiveHour") {
    return Math.floor(timeMs / stepMs) * stepMs;
  }

  const date = new Date(timeMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function buildChartTicks(minTime: number, maxTime: number, quotaKey: QuotaWindowKey, locale: Locale, compact: boolean) {
  const stepMs = getChartTickStepMs(quotaKey, compact);
  const ticks: Array<{ label: string; timeMs: number }> = [
    {
      label: formatChartTickLabel(minTime, quotaKey, locale, compact),
      timeMs: minTime
    }
  ];

  let tickTime = alignChartTickFloor(minTime, quotaKey, stepMs);
  if (tickTime < minTime) {
    tickTime += stepMs;
  }

  while (tickTime <= maxTime) {
    if (Math.abs(ticks[ticks.length - 1].timeMs - tickTime) > 60 * 1000) {
      ticks.push({
        label: formatChartTickLabel(tickTime, quotaKey, locale, compact),
        timeMs: tickTime
      });
    }
    tickTime += stepMs;
  }

  const sameCalendarLabel = quotaKey !== "fiveHour"
    && formatChartTickLabel(ticks[ticks.length - 1].timeMs, quotaKey, locale, compact) === formatChartTickLabel(maxTime, quotaKey, locale, compact);

  if (!sameCalendarLabel && Math.abs(ticks[ticks.length - 1].timeMs - maxTime) > 60 * 1000) {
    ticks.push({
      label: formatChartTickLabel(maxTime, quotaKey, locale, compact),
      timeMs: maxTime
    });
  }

  return ticks;
}

function CombinedChart(props: { series: Record<QuotaWindowKey, SeriesPoint[]>; locale: Locale; animationKey: string; quotaKey: QuotaWindowKey }) {
  const { series, locale, animationKey, quotaKey } = props;
  const chartDrawDurationMs = 1180;
  const text = COPY[locale];
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState(1080);
  const [hoveredPoint, setHoveredPoint] = useState<null | {
    key: QuotaWindowKey;
    x: number;
    y: number;
    point: SeriesPoint;
  }>(null);
  const [tooltipPoint, setTooltipPoint] = useState<typeof hoveredPoint>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const width = 1080;
  const height = 360;
  const axisLeft = 58;
  const axisRight = 12;
  const axisTop = 18;
  const axisBottom = 44;
  const innerWidth = width - axisLeft - axisRight;
  const innerHeight = height - axisTop - axisBottom;
  const isNarrowChart = plotWidth < 760;
  const isVeryNarrowChart = plotWidth < 620;
  const axisFontSize = isVeryNarrowChart ? 14 : isNarrowChart ? 13 : 12;
  const axisStrokeWidth = isVeryNarrowChart ? 1.6 : isNarrowChart ? 1.3 : 1;
  const gridStrokeWidth = isVeryNarrowChart ? 1.2 : isNarrowChart ? 1.05 : 1;
  const lineStrokeWidth = isVeryNarrowChart ? 3.6 : isNarrowChart ? 3.25 : 3;
  const pointRadius = isVeryNarrowChart ? 4.5 : isNarrowChart ? 4 : 3.25;
  const allPoints = QUOTA_KEYS.flatMap((key) => series[key]);
  const latestPointTime = allPoints.length ? Math.max(...allPoints.map((point) => point.timeMs)) : Date.now();
  const rangeDurationMs = quotaKey === "fiveHour" ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const maxTime = latestPointTime;
  const minTime = maxTime - rangeDurationMs;
  const minValue = 0;
  const maxValue = 100;
  const safeMaxValue = 100;
  const yTicks = [0, 20, 40, 60, 80, 100];

  function xForTime(timeMs: number) {
    if (maxTime === minTime) {
      return axisLeft + innerWidth / 2;
    }
    return axisLeft + ((timeMs - minTime) / (maxTime - minTime)) * innerWidth;
  }

  function yForValue(value: number) {
    return axisTop + innerHeight - ((value - minValue) / (safeMaxValue - minValue)) * innerHeight;
  }

  function linePath(points: SeriesPoint[]) {
    if (points.length === 0) return "";
    return points
      .map((point, index) => {
        const x = xForTime(point.timeMs);
        const y = yForValue(point.value);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }

  const xTicks = buildChartTicks(minTime, maxTime, quotaKey, locale, isNarrowChart);

  function shouldShowPoint(index: number, total: number) {
    const visibleTarget = isVeryNarrowChart ? 5 : isNarrowChart ? 8 : 14;
    if (total <= visibleTarget) return true;
    const step = Math.max(2, Math.ceil(total / visibleTarget));
    return index === 0 || index === total - 1 || index % step === 0;
  }

  useEffect(() => {
    if (!plotRef.current) return;

    const updateWidth = () => {
      if (plotRef.current) {
        setPlotWidth(plotRef.current.clientWidth || 1080);
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(plotRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hoveredPoint) {
      setTooltipPoint(hoveredPoint);
      setTooltipVisible(true);
      return;
    }

    if (!tooltipPoint) {
      return;
    }

    setTooltipVisible(false);
    const timer = window.setTimeout(() => setTooltipPoint(null), 180);
    return () => window.clearTimeout(timer);
  }, [hoveredPoint, tooltipPoint]);

  return (
    <section className="combined-chart-card">
      <div className="combined-chart-head">
        <div>
          <p className="mini-chart-title">{text.trend}</p>
        </div>
        <div className="series-legend">
          {QUOTA_KEYS.map((key) => (
            <div key={key} className="series-legend-item">
              <span className="series-dot" style={{ background: SERIES_META[key].color }} />
              <span>{SERIES_META[key].label[locale]}</span>
              <strong>{(series[key][series[key].length - 1]?.value ?? 0).toFixed(1)}%</strong>
            </div>
          ))}
        </div>
      </div>
      <div ref={plotRef} className="combined-chart-plot" onMouseLeave={() => setHoveredPoint(null)}>
      <svg key={animationKey} viewBox={`0 0 ${width} ${height}`} className="combined-chart-svg" role="img" aria-label={text.trend}>
        <line x1={axisLeft} x2={axisLeft} y1={axisTop} y2={axisTop + innerHeight} className="chart-axis-line" style={{ strokeWidth: axisStrokeWidth }} />
        <line x1={axisLeft} x2={axisLeft + innerWidth} y1={axisTop + innerHeight} y2={axisTop + innerHeight} className="chart-axis-line" style={{ strokeWidth: axisStrokeWidth }} />
        {yTicks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={tick}>
              <line x1={axisLeft} x2={axisLeft + innerWidth} y1={y} y2={y} className="chart-grid-line" style={{ strokeWidth: gridStrokeWidth }} />
              <text x={axisLeft - 10} y={y + 4} className="chart-axis-text chart-axis-text-y" style={{ fontSize: axisFontSize }}>
                {tick.toFixed(0)}%
              </text>
            </g>
          );
        })}
        {QUOTA_KEYS.map((key) => (
          <g key={key}>
            <path d={linePath(series[key])} pathLength={1} className="chart-series-line" style={{ animationDuration: `${chartDrawDurationMs}ms` }} stroke={SERIES_META[key].color} strokeWidth={lineStrokeWidth} fill="none" strokeLinecap="round" />
            {series[key].map((point, index) => {
              const x = xForTime(point.timeMs);
              const y = yForValue(point.value);
              const shouldRenderPoint = shouldShowPoint(index, series[key].length);
              const isHovered = hoveredPoint?.key === key && hoveredPoint.point.timeMs === point.timeMs;
              const progress = maxTime === minTime ? 0 : (point.timeMs - minTime) / Math.max(maxTime - minTime, 1);
              const pointDelay = `${progress * chartDrawDurationMs}ms`;
              return (
                <g key={`${key}-${point.timeMs}-${index}`}>
                  {shouldRenderPoint || isHovered ? (
                    <g className={`chart-point${isHovered ? " is-hovered" : ""}`} style={!isHovered ? { animationDelay: pointDelay, animationDuration: "240ms" } : undefined}>
                      <circle className="chart-point-halo" cx={x} cy={y} r={pointRadius * 2.1} fill={SERIES_META[key].color} />
                      <circle cx={x} cy={y} r={pointRadius * 1.14} fill="var(--surface-strong)" stroke={SERIES_META[key].color} strokeWidth={isHovered ? 3 : 2.2} />
                      <circle cx={x} cy={y} r={isHovered ? pointRadius * 0.34 : 0} fill={SERIES_META[key].color} />
                    </g>
                  ) : null}
                  {shouldRenderPoint ? (
                    <circle
                      cx={x}
                      cy={y}
                      r="11"
                      fill="transparent"
                      onMouseEnter={() => setHoveredPoint({ key, x, y, point })}
                      onMouseLeave={() => setHoveredPoint((current) => current?.key === key && current.point.timeMs === point.timeMs ? null : current)}
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        ))}
        {xTicks.map((point, index) => {
          const label = point?.label;
          const x = point ? xForTime(point.timeMs) : axisLeft;
          return label ? (
            <g key={`${label}-${index}-${point.timeMs}`}>
              <line x1={x} x2={x} y1={axisTop + innerHeight} y2={axisTop + innerHeight + 6} className="chart-axis-line" style={{ strokeWidth: axisStrokeWidth }} />
              <text x={x} y={height - 8} className="chart-axis-text chart-axis-text-x" style={{ fontSize: axisFontSize }}>
                {label}
              </text>
            </g>
          ) : null;
        })}
      </svg>
      {tooltipPoint ? (
        <div
          className={`chart-tooltip${tooltipVisible ? " is-visible" : " is-hiding"}`}
          style={{
            left: `${(tooltipPoint.x / width) * 100}%`,
            top: `${(tooltipPoint.y / height) * 100}%`
          }}
        >
          <div className="chart-tooltip-title">
            <span className="series-dot" style={{ background: SERIES_META[tooltipPoint.key].color }} />
            <span>{SERIES_META[tooltipPoint.key].label[locale]}</span>
          </div>
          <strong>{tooltipPoint.point.value.toFixed(1)}%</strong>
          <span>{new Date(tooltipPoint.point.timeMs).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ) : null}
      </div>
    </section>
  );
}

export default function App() {
  const initialLocale: Locale = localStorage.getItem("ocam-locale") === "zh-CN" ? "zh-CN" : "en-US";
  const initialTheme: ThemeMode = localStorage.getItem("ocam-theme") === "dark" ? "dark" : "light";

  if (!window.opencodeCodexAuth) {
    const bridgeText = COPY[initialLocale];
    return (
      <div className="app-shell loading-state">
        <div className="surface-card bridge-error-card">
          <h1>{bridgeText.bridgeTitle}</h1>
          <p>{bridgeText.bridgeBody}</p>
        </div>
      </div>
    );
  }

  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const { state, applyState, busy, message, setMessage, run } = useDashboardState();
  const [hoveredAccountId, setHoveredAccountId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusState>({ kind: "overview" });
  const [accountsCollapsed, setAccountsCollapsed] = useState(true);
  const [authPreviewAction, setAuthPreviewAction] = useState<AuthPreviewAction>("default");
  const [authPreviewIcon, setAuthPreviewIcon] = useState<AuthPreviewIcon>("key");
  const [authMotionDirection, setAuthMotionDirection] = useState<AuthMotionDirection>("none");
  const [authIconMotionTick, setAuthIconMotionTick] = useState(0);
  const [runningAuthAction, setRunningAuthAction] = useState<RunningAuthAction | null>(null);
  const [runningToolbarAction, setRunningToolbarAction] = useState<null | ToolbarMotionAction>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [getAuthOpen, setGetAuthOpen] = useState(false);
  const [authClosing, setAuthClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const getAuthRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const fileImportInputRef = useRef<HTMLInputElement | null>(null);
  const chipRailRef = useRef<HTMLElement | null>(null);
  const getAuthCloseTimerRef = useRef<number | null>(null);
  const settingsCloseTimerRef = useRef<number | null>(null);
  const accountRefreshTimeoutsRef = useRef<Record<string, number>>({});
  const accountRefreshInFlightRef = useRef<Record<string, boolean>>({});
  const [chipRailHeight, setChipRailHeight] = useState(0);

  useEffect(() => {
    if (state) {
      setPathDraft(state.settings.opencodeAuthPath);
    }
  }, [state?.settings.opencodeAuthPath]);

  useEffect(() => {
    const rail = chipRailRef.current;
    if (!rail) {
      return;
    }

    const measure = () => setChipRailHeight(rail.scrollHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [state.accounts]);

  useEffect(() => {
    localStorage.setItem("ocam-locale", locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem("ocam-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!message) {
      setToastVisible(false);
      return;
    }

    setToastVisible(true);
    const hideTimer = window.setTimeout(() => setToastVisible(false), 3000);
    const clearTimer = window.setTimeout(() => setMessage(null), 3240);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [message, setMessage]);

  useEffect(() => {
    if (!getAuthOpen) {
      applyAuthPreviewAction("default");
    }
  }, [getAuthOpen]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!runningAuthAction && getAuthRef.current && !getAuthRef.current.contains(target)) {
        setGetAuthOpen(false);
        setAuthClosing(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!getAuthOpen || runningAuthAction) {
      return;
    }

    function onPointerMove(event: MouseEvent) {
      const target = event.target as Node;
      if (getAuthRef.current?.contains(target)) {
        openGetAuthMenu();
      } else {
        closeGetAuthMenuSoon();
      }
    }

    document.addEventListener("mousemove", onPointerMove);
    return () => document.removeEventListener("mousemove", onPointerMove);
  }, [getAuthOpen, runningAuthAction]);

  useEffect(() => {
    return () => {
      if (getAuthCloseTimerRef.current !== null) {
        window.clearTimeout(getAuthCloseTimerRef.current);
      }
      if (settingsCloseTimerRef.current !== null) {
        window.clearTimeout(settingsCloseTimerRef.current);
      }
      Object.values(accountRefreshTimeoutsRef.current).forEach((handle) => window.clearTimeout(handle));
    };
  }, []);

  const text = COPY[locale];
  const meta = quotaMeta(locale);
  const aggregateBars = useMemo(() => computeAggregateBars(state.accounts, locale, focus), [state.accounts, locale, focus]);

  const focusAccount =
    state.accounts.find((account) =>
      focus.kind === "account" ? account.id === focus.accountId : hoveredAccountId ? account.id === hoveredAccountId : false
    ) ?? null;
  const selectedAccount = focus.kind === "account" ? state.accounts.find((account) => account.id === focus.accountId) ?? null : null;
  const activeVisualAccountId = focus.kind === "account" ? focus.accountId : hoveredAccountId;
  const activeMarkerAccountId = focus.kind === "account" ? focus.accountId : hoveredAccountId;

  useEffect(() => {
    if (!window.opencodeCodexAuth || !state.settings.opencodeAuthPath) {
      return;
    }

    Object.values(accountRefreshTimeoutsRef.current).forEach((handle) => window.clearTimeout(handle));
    accountRefreshTimeoutsRef.current = {};

    for (const account of state.accounts) {
      const nextRefreshAt = getAccountNextRefreshAt(account, state.activeAccountId === account.id, Date.now());
      const delayMs = Math.max(0, nextRefreshAt - Date.now());

      accountRefreshTimeoutsRef.current[account.id] = window.setTimeout(() => {
        if (accountRefreshInFlightRef.current[account.id]) {
          return;
        }

        accountRefreshInFlightRef.current[account.id] = true;
        void run(() => window.opencodeCodexAuth.refreshAccount(account.id), (next) => {
          if (next && isDashboardState(next)) {
            applyState(next);
          }
        }, { trackBusy: false, clearMessage: false }).finally(() => {
          delete accountRefreshInFlightRef.current[account.id];
        });
      }, delayMs);
    }

    return () => {
      Object.values(accountRefreshTimeoutsRef.current).forEach((handle) => window.clearTimeout(handle));
      accountRefreshTimeoutsRef.current = {};
    };
  }, [applyState, run, state.accounts, state.activeAccountId, state.settings.opencodeAuthPath]);

  const chartSeries = useMemo(() => {
    if (!state || focus.kind === "overview") {
      return null;
    }
    return buildSeries(state.history, state.accounts, focus.kind === "account" ? focus : { kind: "aggregate", quotaKey: focus.quotaKey });
  }, [focus, state]);

  function handleShellClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (focus.kind !== "account") return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea,select,label,a,[role='button'],[data-preserve-focus='true']")) {
      return;
    }
    setFocus({ kind: "overview" });
    setHoveredAccountId(null);
  }

  function dismissMessage() {
    setToastVisible(false);
    window.setTimeout(() => setMessage(null), 180);
  }

  function applyAuthPreviewAction(action: AuthPreviewAction) {
    setAuthPreviewAction(action);
    const nextIcon = getAuthPreviewIcon(action);
    setAuthPreviewIcon((current) => {
      if (current === nextIcon) {
        return current;
      }
      setAuthMotionDirection(authPreviewIconOrder(nextIcon) > authPreviewIconOrder(current) ? "down" : "up");
      setAuthIconMotionTick((tick) => tick + 1);
      return nextIcon;
    });
  }

  async function runAuthAction<T>(action: RunningAuthAction, task: () => Promise<T>, onSuccess?: (result: T) => void) {
    setRunningAuthAction(action);
    setGetAuthOpen(true);
    try {
      return await run(task, onSuccess);
    } finally {
      setRunningAuthAction((current) => current === action ? null : current);
    }
  }

  async function runToolbarAction<T>(action: ToolbarMotionAction, task: () => Promise<T>, onSuccess?: (result: T) => void) {
    setRunningToolbarAction(action);
    try {
      return await run(task, onSuccess);
    } finally {
      setRunningToolbarAction((current) => current === action ? null : current);
    }
  }

  function openGetAuthMenu() {
    if (getAuthCloseTimerRef.current !== null) {
      window.clearTimeout(getAuthCloseTimerRef.current);
      getAuthCloseTimerRef.current = null;
    }
    setAuthClosing(false);
    setGetAuthOpen(true);
  }

  function closeGetAuthMenuSoon() {
    if (runningAuthAction) {
      return;
    }
    if (getAuthCloseTimerRef.current !== null) {
      window.clearTimeout(getAuthCloseTimerRef.current);
    }
    setAuthClosing(true);
    getAuthCloseTimerRef.current = window.setTimeout(() => {
      setGetAuthOpen(false);
      setAuthClosing(false);
      getAuthCloseTimerRef.current = null;
    }, 180);
  }

  function handleGetAuthBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (runningAuthAction) {
      return;
    }

    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && getAuthRef.current?.contains(nextTarget)) {
      return;
    }

    closeGetAuthMenuSoon();
  }

  function openSettingsMenu() {
    if (settingsCloseTimerRef.current !== null) {
      window.clearTimeout(settingsCloseTimerRef.current);
      settingsCloseTimerRef.current = null;
    }
    setSettingsOpen(true);
  }

  function closeSettingsMenuSoon() {
    if (settingsCloseTimerRef.current !== null) {
      window.clearTimeout(settingsCloseTimerRef.current);
    }
    settingsCloseTimerRef.current = window.setTimeout(() => {
      setSettingsOpen(false);
      settingsCloseTimerRef.current = null;
    }, 180);
  }

  function handleImportResult(result: ImportResult | null) {
    if (!result || !isDashboardState(result.state)) {
      return;
    }

    applyState(result.state);
    if (result.importedAccountId) {
      setHoveredAccountId(null);
      setFocus({ kind: "account", accountId: result.importedAccountId, quotaKey: "fiveHour" });
    }
    const notices = Array.isArray(result.notices) ? result.notices : [];
    const importedCount = Array.isArray(result.importedAccountIds) ? result.importedAccountIds.length : 0;
    if (importedCount > 1) {
      notices.unshift(locale === "zh-CN" ? `已导入 ${importedCount} 个账号` : `Imported ${importedCount} accounts`);
    } else if (importedCount === 1) {
      notices.unshift(locale === "zh-CN" ? "导入成功" : "Import succeeded");
    }
    if (notices.length > 0) {
      setMessage(notices.join("\n"));
    }
  }

  function handleExportResult(result: ExportResult | null) {
    if (!result) {
      return;
    }

    const count = Array.isArray(result.exportedAccountIds) ? result.exportedAccountIds.length : 0;
    const pathCount = Array.isArray(result.filePaths) ? result.filePaths.length : 0;
    if (count > 0 || pathCount > 0) {
      setMessage(locale === "zh-CN" ? `已导出 ${count || pathCount} 个账号` : `Exported ${count || pathCount} accounts`);
    }
  }

  function handleStateResult(result: unknown, successMessage: string, afterApply?: () => void) {
    if (!isDashboardState(result)) {
      return;
    }

    applyState(result);
    afterApply?.();
    setMessage(successMessage);
  }

  async function handleFileImportSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      setRunningAuthAction(null);
      return;
    }

    if (typeof window.opencodeCodexAuth.importFilePayloads !== "function") {
      setMessage(locale === "zh-CN" ? "当前窗口版本过旧，请重启应用后再使用多文件导入。" : "This window is outdated. Restart the app before using multi-file import.");
      return;
    }

    const payloads = await Promise.all(files.map(async (file) => ({
      name: file.name,
      raw: await file.text()
    })));

    await runAuthAction(
      "import",
      () => window.opencodeCodexAuth.importFilePayloads(payloads),
      (result) => handleImportResult(result as ImportResult | null)
    );
  }

  return (
    <div className="app-shell" onClick={handleShellClick}>
      <input
        ref={fileImportInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        style={{ display: "none" }}
        onChange={(event) => { void handleFileImportSelection(event); }}
      />
      <header className="main-header">
        <h1 className="app-title">{text.appName}</h1>
        <div className="header-actions">
          <div 
            ref={getAuthRef}
            className="dropdown-container"
            onMouseEnter={openGetAuthMenu}
            onMouseLeave={closeGetAuthMenuSoon}
            onPointerLeave={closeGetAuthMenuSoon}
            onBlur={handleGetAuthBlur}
          >
            <button className={`expandable-button auth-toolbar-button${getAuthOpen ? " is-open" : ""}${authClosing ? " is-closing" : ""}${runningAuthAction ? ` is-running-auth is-auth-${runningAuthAction}` : ""}`} title={text.getAuth} aria-label={text.getAuth} onClick={() => { setAuthClosing(false); setGetAuthOpen((open) => !open); }}>
              <span key={`auth-${authPreviewIcon}-${authIconMotionTick}`} className={`toolbar-leading-icon toolbar-leading-icon-auth${authMotionDirection === "down" ? " is-roll-down" : authMotionDirection === "up" ? " is-roll-up" : ""}`}>
                <AuthButtonIcon icon={authPreviewIcon} />
              </span>
              <span className="button-text">{text.getAuth}</span>
              <span className="toolbar-utility"><IconChevronDown /></span>
            </button>
            {getAuthOpen && (
              <div className="dropdown-menu" onMouseEnter={openGetAuthMenu} onMouseLeave={closeGetAuthMenuSoon} onPointerLeave={closeGetAuthMenuSoon}>
                  <button onMouseEnter={() => applyAuthPreviewAction("login")} onFocus={() => applyAuthPreviewAction("login")} onClick={() => { void runAuthAction("login", () => window.opencodeCodexAuth.loginImportAccount(), (r) => handleImportResult(r as ImportResult | null)); }}>
                    {text.loginImport}
                </button>
                  <button onMouseEnter={() => applyAuthPreviewAction("import")} onFocus={() => applyAuthPreviewAction("import")} onClick={() => { setRunningAuthAction("import"); setGetAuthOpen(true); fileImportInputRef.current?.click(); }}>
                    {text.importFile}
                </button>
                <div className="dropdown-divider" />
                <button disabled={state.accounts.length === 0} onMouseEnter={() => applyAuthPreviewAction("export")} onFocus={() => applyAuthPreviewAction("export")} onClick={() => { void runAuthAction("export", () => window.opencodeCodexAuth.exportAccount(selectedAccount ? [selectedAccount.id] : state.accounts.map((account) => account.id)), (r) => handleExportResult(r as ExportResult | null)); }}>
                    {text.export}
                </button>
                <button className="is-danger" disabled={busy || !selectedAccount} onMouseEnter={() => applyAuthPreviewAction("delete")} onFocus={() => applyAuthPreviewAction("delete")} onClick={() => { if (!selectedAccount) return; void runAuthAction("delete", () => window.opencodeCodexAuth.deleteAccount(selectedAccount.id), (r) => handleStateResult(r, locale === "zh-CN" ? `已删除账号：${selectedAccount.label}` : `Deleted account: ${selectedAccount.label}`, () => { setFocus({ kind: "overview" }); setHoveredAccountId(null); })); }}>
                    {text.delete}
                </button>
              </div>
            )}
          </div>
          <button className={`expandable-button toolbar-button${runningToolbarAction === "refresh" ? " is-running-refresh" : ""}`} title={text.refresh} aria-label={text.refresh} onClick={() => { void runToolbarAction("refresh", () => selectedAccount ? window.opencodeCodexAuth.refreshAccount(selectedAccount.id) : window.opencodeCodexAuth.refreshAll(), (r) => handleStateResult(r, locale === "zh-CN" ? (selectedAccount ? `已刷新账号：${selectedAccount.label}` : "已刷新全部账号") : (selectedAccount ? `Refreshed account: ${selectedAccount.label}` : "Refreshed all accounts"))); }}>
            <span className="toolbar-leading-icon toolbar-leading-icon-refresh"><IconRefresh /></span>
            <span className="button-text">{text.refresh}</span>
          </button>
          <button className={`expandable-button toolbar-button${runningToolbarAction === "switch" ? " is-running-switch" : ""}`} title={text.useForOpenCode} aria-label={text.useForOpenCode} disabled={busy || !selectedAccount} onClick={() => { if (!selectedAccount) return; void runToolbarAction("switch", () => window.opencodeCodexAuth.activateAccount(selectedAccount.id), (r) => handleStateResult(r, locale === "zh-CN" ? `已切换当前使用：${selectedAccount.label}` : `Switched active account: ${selectedAccount.label}`)); }}>
            <span className="toolbar-leading-icon toolbar-leading-icon-switch"><IconLink /></span>
            <span className="button-text">{text.useForOpenCode}</span>
          </button>
          <div ref={settingsRef} className="settings-container toolbar-utility" onMouseEnter={openSettingsMenu} onMouseLeave={closeSettingsMenuSoon}>
            <button className={`icon-button ${settingsOpen ? 'is-active' : ''}`} onClick={() => setSettingsOpen((open) => !open)}>
              <IconSettings />
            </button>
            {settingsOpen && (
              <div className="settings-popover surface-card" onMouseEnter={openSettingsMenu} onMouseLeave={closeSettingsMenuSoon}>
                <div className="settings-row">
                  <span className="settings-label">{text.language}</span>
                  <button className="ghost-button compact-button settings-inline-button" onClick={() => setLocale(c => c === "en-US" ? "zh-CN" : "en-US")}> 
                    {locale === "en-US" ? "zh-CN" : "en-US"}
                  </button>
                </div>
                <div className="settings-row">
                  <span className="settings-label">{text.theme}</span>
                  <button className="ghost-button compact-button settings-inline-button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}> 
                    {theme === "light" ? text.dark : text.light}
                  </button>
                </div>
                <div className="settings-row">
                  <span className="settings-label">{text.authPath}</span>
                  <div className="auth-path-inputs">
                    <input className="compact-input" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} />
                    <button className="ghost-button compact-button" onClick={() => run(() => window.opencodeCodexAuth.pickAuthPath(), (n) => n && handleStateResult(n, locale === "zh-CN" ? "已更新 Auth 路径" : "Auth path updated"))}>{text.browse}</button>
                    <button className="ghost-button compact-button" onClick={() => run(() => window.opencodeCodexAuth.updateSettings({ opencodeAuthPath: pathDraft }), (r) => handleStateResult(r, locale === "zh-CN" ? "已保存 Auth 路径" : "Auth path saved"))}>{text.save}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={`main-stage${accountsCollapsed ? " is-accounts-collapsed" : ""}${focus.kind !== "overview" ? " is-focus-open" : ""}`}>
        <section className="unified-quota-card surface-card">
          {aggregateBars.map((bar) => (
            <div className="quota-row" key={bar.quotaKey}>
              {(() => {
                const visibleStateMarkers = bar.stateMarkers;
                const visibleSegments = bar.segments;
                const hasVisibleLeadingMarker = visibleStateMarkers.some((marker) => marker.anchor === "start");
                const hasVisibleTrailingMarker = visibleStateMarkers.some((marker) => marker.anchor === "end");
                const activeMarkerIdForBar = activeMarkerAccountId && (() => {
                  const activeAccount = state.accounts.find((account) => account.id === activeMarkerAccountId);
                  return activeAccount ? activeMarkerAccountId : null;
                })();
                const visibleFilledPercent = bar.filledPercent;

                return (
              <>
              <div className="quota-row-meta">
                <span className="quota-row-title">{bar.title}</span>
                <span className="quota-row-subtitle">{visibleFilledPercent.toFixed(1)}%</span>
              </div>
              <div className="quota-track-container" onMouseLeave={() => setHoveredAccountId(null)}>
                <div className="quota-track" data-preserve-focus="true" onClick={() => setFocus({ kind: "aggregate", quotaKey: bar.quotaKey })}>
                  <div className="quota-track-base" />
                  <div className={`quota-track-fill${hasVisibleLeadingMarker ? " has-leading-marker" : ""}${hasVisibleTrailingMarker ? " has-trailing-marker" : ""}`} style={{ width: `${visibleFilledPercent}%` }}>
                    {visibleSegments.map((seg) => {
                      const dimmed = activeVisualAccountId && activeVisualAccountId !== seg.accountId;
                      const focused = focus.kind === "account" && focus.accountId === seg.accountId;
                      const active = state.activeAccountId === seg.accountId;
                      const segmentIndex = visibleSegments.findIndex((segment) => segment.accountId === seg.accountId);
                      const isFirstVisible = segmentIndex === 0;
                      const isLastVisible = segmentIndex === visibleSegments.length - 1;
                      return (
                        <div
                          key={seg.accountId}
                          className={`quota-segment${dimmed ? " is-dimmed" : ""}${focused ? " is-focused" : ""}${active ? " is-active-account" : ""}${isFirstVisible && !hasVisibleLeadingMarker ? " is-round-start" : ""}${isLastVisible && !hasVisibleTrailingMarker ? " is-round-end" : ""}`}
                          style={{ width: `${seg.widthPercent}%`, backgroundColor: seg.color }}
                          onMouseEnter={() => setHoveredAccountId(seg.accountId)}
                          onClick={(e) => { e.stopPropagation(); setHoveredAccountId(null); setFocus({ kind: "account", accountId: seg.accountId, quotaKey: bar.quotaKey }); }}
                        >
                        </div>
                      );
                    })}
                  </div>
                  {activeMarkerIdForBar && (() => {
                    const hoveredSegment = visibleSegments.find((segment) => segment.accountId === activeMarkerIdForBar);
                    const hoveredMarker = visibleStateMarkers.find((marker) => marker.accountId === activeMarkerIdForBar);
                    const hoveredAccount = state.accounts.find((account) => account.id === activeMarkerIdForBar);
                    const hoveredWindow = hoveredAccount ? getWindow(hoveredAccount, bar.quotaKey) : null;
                    const hoveredDisplayedStatus = hoveredAccount ? getDisplayedStatus(hoveredAccount, bar.quotaKey) : "unknown";

                    if (hoveredSegment) {
                      const leftPercent = (hoveredSegment.startPercent / 100) * visibleFilledPercent;
                      const resetText = formatResetAt(hoveredWindow?.resetAt ?? null, locale, text.reset);
                      return (
                        <div
                          className="track-inline-label is-segment"
                          style={{ left: `calc(${leftPercent}% + 6px)`, right: "8px", maxWidth: `calc(${Math.max(0, 100 - leftPercent)}% - 14px)` }}
                        >
                          <span className="track-inline-label-text">
                            {hoveredSegment.label} {hoveredSegment.remainingPercent.toFixed(0)}%{resetText ? ` · ${resetText}` : ""}
                          </span>
                        </div>
                      );
                    }

                    if (hoveredAccount && hoveredWindow && hoveredMarker) {
                      const markerOffset = hoveredMarker.anchor === "start" ? 6 : hoveredMarker.anchor === "end" ? -6 : 0;
                      const resetText = formatResetAt(hoveredWindow.resetAt, locale, text.reset);
                      const creditsText = getCreditsLabel(hoveredAccount, locale, text.creditsLabel);
                      return (
                        <div
                          className={`track-inline-label is-marker is-${hoveredDisplayedStatus}`}
                          style={{ left: `calc(${hoveredMarker.leftPercent}% + ${markerOffset}px)`, transform: hoveredMarker.anchor === "end" ? "translate(-100%, -50%)" : "translate(0, -50%)" }}
                        >
                          {hoveredAccount.label} {creditsText ?? statusLabel(hoveredDisplayedStatus, locale)}{resetText ? ` · ${resetText}` : ""}
                        </div>
                      );
                    }

                    return null;
                  })()}
                  <div className="quota-track-states">
                    {visibleStateMarkers.map((marker) => (
                        <div
                          key={`${marker.accountId}-${marker.status}`}
                          className={`state-region is-${marker.status} is-${marker.anchor}${activeMarkerIdForBar === marker.accountId ? " is-active" : ""}${activeVisualAccountId && activeVisualAccountId !== marker.accountId ? " is-dimmed" : ""}`}
                          style={{ left: `${marker.leftPercent}%`, color: marker.color, transform: marker.anchor === "start" ? "translateX(0)" : marker.anchor === "end" ? "translateX(-100%)" : "translateX(-50%)" }}
                          title={`${marker.label} - ${marker.status === "empty" ? text.empty : text.unknown}`}
                        onMouseEnter={() => setHoveredAccountId(marker.accountId)}
                        onClick={(e) => { e.stopPropagation(); setHoveredAccountId(null); setFocus({ kind: "account", accountId: marker.accountId, quotaKey: bar.quotaKey }); }}
                      />
                    ))}
                  </div>
                  </div>
                </div>
              </>
                );
              })()}
            </div>
          ))}
        </section>

        <div className="chip-rail-anchor">
          <div className="chip-rail-toolbar">
            <button
              className={`chip-rail-toggle${accountsCollapsed ? " is-collapsed" : ""}`}
              title={accountsCollapsed ? text.showAccounts : text.hideAccounts}
              aria-label={accountsCollapsed ? text.showAccounts : text.hideAccounts}
              data-preserve-focus="true"
              onClick={(event) => {
                setAccountsCollapsed((current) => !current);
                window.setTimeout(() => {
                  (event.currentTarget as HTMLButtonElement).blur();
                }, 0);
              }}
            >
              <IconChevronDown />
            </button>
          </div>
        </div>

        <div className={`chip-rail-shell${accountsCollapsed ? " is-collapsed" : ""}`} style={{ maxHeight: accountsCollapsed ? "0px" : `${chipRailHeight}px` } as CSSProperties}>
          <section ref={chipRailRef} className="chip-rail">
          {state.accounts.map((account) => {
            const active = state.activeAccountId === account.id;
            const highlighted = hoveredAccountId === account.id || (focus.kind === "account" && focus.accountId === account.id);
            const creditsLabel = getCreditsLabel(account, locale, text.creditsLabel);
            return (
              <button
                key={account.id}
                data-preserve-focus="true"
                className={`chip${highlighted ? " is-selected" : ""}`}
                onMouseEnter={() => setHoveredAccountId(account.id)}
                onMouseLeave={() => setHoveredAccountId(null)}
                onClick={() => { setHoveredAccountId(null); setFocus({ kind: "account", accountId: account.id, quotaKey: focus.kind === "account" ? focus.quotaKey : "fiveHour" }); }}
              >
                <span className="chip-dot" style={{ background: getAccountColor(account, state.accounts) }} />
                <span className="chip-label">{account.label}</span>
                {creditsLabel && <span className="chip-badge">{creditsLabel}</span>}
                {active && <span className="chip-badge is-active">{text.active}</span>}
              </button>
            );
          })}
        </section>
        </div>

        {focus.kind !== "overview" && (
          <section className="focus-panel surface-card">
            <div className="focus-header">
              <div className="focus-header-titles">
                <span className="section-label">{text.usageFocus}</span>
                <h2>
                  {focus.kind === "account"
                    ? text.accountUsageHistory.replace("{name}", focusAccount?.label ?? text.allAccounts)
                    : text.aggregateHistory.replace("{name}", meta[focus.quotaKey].title)}
                </h2>
              </div>
            </div>

            {chartSeries ? <CombinedChart animationKey={JSON.stringify(focus)} series={chartSeries} locale={locale} quotaKey={focus.quotaKey} /> : null}
          </section>
        )}
      </main>
      {message && <div className={`toast-banner${toastVisible ? " is-visible" : " is-hiding"}`} onClick={dismissMessage}>{message}</div>}
    </div>
  );
}

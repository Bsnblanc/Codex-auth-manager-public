# ELECTRON DOMAIN

## OVERVIEW

Main-process domain: BrowserWindow boot, preload IPC surface, auth import/export, live auth sync, quota fetch, persistence, and auto-switch rules.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| IPC entry points | `electron/main.cts` | `registerIpcHandlers()` wires every renderer action |
| Import/login-import behavior | `electron/main.cts` | `importManagedAccountWithQuota()`, `importAuthFiles()`, `importAuthPayloads()` |
| Store shape and disk persistence | `electron/types.ts`, `electron/store.ts` | `revision`, `accounts`, `history`, atomic save |
| Live auth merge/restore | `electron/opencode.ts`, `electron/live-auth-sync.ts` | Replace only the active Codex/OpenAI node |
| JWT parsing and identity evidence | `electron/jwt.ts` | `accountId`, `accountUserId`, `chatgptUserId`, `subject` |
| Quota polling | `electron/quotas.ts` | timeout, usage URL, `ChatGPT-Account-Id` header |
| Same-team notices | `electron/import-notices.ts` | user-facing warnings based on `accountId` |

## CONVENTIONS

- All store writes go through `runStoreMutation()` in `electron/main.cts`; do not introduce ad hoc load-mutate-save paths.
- Every persisted mutation bumps `revision`; renderer relies on that to reject stale snapshots.
- Import paths keep the imported account even if quota fetch fails; use `lastError` instead of silently dropping it.
- `sameSubscription()` in `electron/opencode.ts` is intentionally token-only. Treat broader dedupe as unsafe unless requirements and evidence change.
- `fetchQuotaSnapshot()` must keep timeout protection and pass the JWT-derived `accountId` header when available.
- When touching OpenCode live auth, preserve unrelated providers exactly as-is.

## ANTI-PATTERNS

- Do not save the store directly from a new IPC handler without `runStoreMutation()`.
- Do not treat `providerKey`, `email`, `planType`, or JWT user IDs as authoritative dedupe keys.
- Do not overwrite the full auth file blob when only one provider entry should change.
- Do not drop imported records just because live quota is temporarily unavailable.
- Do not describe `accountId` as an official subscription or billing identifier.

## NOTES

- `electron/main.cts` is the central hotspot; review nearby flows before editing imports, refreshes, or activation.
- The domain is split by concern already; prefer adding to the correct helper file over growing `main.cts` further.

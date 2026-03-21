# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-21T02:09:58-04:00
**Commit:** 54a946a
**Branch:** main

## OVERVIEW

Windows Electron + React desktop app for managing the Codex/OpenAI OAuth account OpenCode uses. The project is shallow, but behavior is concentrated in one renderer file and one main-process file, so small edits can have wide UI or state effects.

## STRUCTURE

```text
./
|- docs/        # product rules, field inventory, identity limits, issue/task records
|- electron/    # main-process IPC, auth import/export, quota fetch, store, JWT parsing
|- src/         # single renderer app, charts, hover/focus UI, styling
|- package.json # dev/build/lint entry points
|- vite.config.ts
`- patch_app.js # local helper script; not runtime app logic
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Import, refresh, account persistence | `electron/main.cts`, `electron/store.ts` | Import/login-import flows, revision bumps, serialized mutations |
| OpenCode auth merge/write rules | `electron/opencode.ts`, `electron/live-auth-sync.ts` | Preserve unrelated providers; only patch Codex/OpenAI node |
| JWT fields and team/account evidence | `electron/jwt.ts`, `electron/quotas.ts`, `docs/subscription-identity.md` | `ChatGPT-Account-Id` comes from JWT `accountId` |
| UI hover/focus behavior | `src/App.tsx`, `src/styles.css`, `docs/quota-hover-marker-task-record.md` | Hover dims; focus expands; do not mix them |
| Field meanings and storage | `docs/obtainable-fields.md`, `electron/types.ts` | Use docs before inventing new identity claims |
| Renderer boot and bridge | `src/main.tsx`, `electron/preload.cts` | StrictMode renderer + preload IPC surface |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `runStoreMutation` | function | `electron/main.cts:27` | 12 | Serializes all state-changing IPC handlers |
| `importManagedAccountWithQuota` | function | `electron/main.cts:72` | - | Import path with quota hydration and same-team notices |
| `refreshAllState` | function | `electron/main.cts:252` | - | Refreshes all managed accounts and records history |
| `refreshAccountState` | function | `electron/main.cts:344` | - | Single-account refresh used by manual actions |
| `sameSubscription` | function | `electron/opencode.ts:106` | 2 | Current dedupe rule; token-only by design |
| `fetchQuotaSnapshot` | function | `electron/quotas.ts:95` | - | Calls `/wham/usage`, sets timeout, includes account header |
| `getJwtMetadata` | function | `electron/jwt.ts:54` | - | Parses stored JWT evidence fields |
| `useDashboardState` | function | `src/App.tsx:720` | - | Renderer state loader with revision gate |
| `computeAggregateBars` | function | `src/App.tsx:537` | - | Computes quota segments, empty markers, aggregate fills |
| `CombinedChart` | function | `src/App.tsx:890` | - | Focus-only chart rendering |
| `App` | function | `src/App.tsx:1092` | - | Main single-page UI shell |

## CONVENTIONS

- Bump `store.revision` on every persisted mutation; renderer keeps the newest snapshot only.
- Keep all identity and team claims evidence-based. If code and docs cannot prove it, say so explicitly.
- Preserve unrelated provider auth entries when syncing OpenCode live auth.
- Keep docs updated when a bug changes behavior or clarifies a hard boundary.
- Treat hover and focus as separate interaction modes: hover highlights/dims; focus opens charts and locks context.

## ANTI-PATTERNS (THIS PROJECT)

- Do not overwrite the entire OpenCode auth file when switching accounts.
- Do not widen `sameSubscription()` beyond token equality without hard evidence.
- Do not present `accountId`, `email`, or `planType` as an official billing subscription ID.
- Do not implement hover fixes by hiding or reflowing aggregate quota rows unless the user explicitly asks for that behavior.
- Do not claim verification without running `npm run lint` and `npm run build`; no test suite or CI exists yet.

## UNIQUE STYLES

- Documentation is part of the product surface: product rules, field inventory, identity boundaries, and issue records all live in `docs/`.
- The renderer is intentionally concentrated in `src/App.tsx` + `src/styles.css`; prefer surgical edits over broad reorganizations.
- Main-process responsibilities are split by concern: auth file I/O, JWT parsing, quota fetch, store, import notices, and auto-switch each live in separate `electron/` files.

## COMMANDS

```bash
npm run dev
npm run lint
npm run build
npm run preview
```

## NOTES

- No project `AGENTS.md` or `CLAUDE.md` existed before this run.
- Repo depth is only one directory level, so only top-level domain AGENTS are warranted.
- No `.github/workflows` or test files were found.
- Largest reasoning hotspots: `src/App.tsx`, `src/styles.css`, `electron/main.cts`.

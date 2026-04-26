# Sub2API Batch Import Task Record

## User request

- Request date: 2026-04-26.
- User asked: “导入要能支持批量导入 要能识别这个格式！”
- The concrete target is Sub2API export files named like `sub2api-account-*.json` with a top-level `accounts[]` array.
- The local sample contains four OpenAI OAuth accounts. Token values are intentionally not recorded here.

## Accepted schema

- The file or renderer payload must be a JSON object with top-level `accounts` as an array.
- Each imported account entry must have:
  - `platform === "openai"`
  - `type === "oauth"`
  - `credentials.access_token` as a string
  - `credentials.refresh_token` as a string
  - `credentials.id_token` as a string
- Optional accepted credential metadata:
  - `credentials.chatgpt_account_id` maps to managed `authBase.accountId` when it is a string.
  - `credentials.expires_at` maps to managed `authBase.expires` when it is a number or parseable string. Seconds are converted to milliseconds.
  - Top-level `exported_at` maps to `codexExtras.lastRefresh` when it is a string; otherwise import time is used.

## Scope boundary

### In scope

- Import all valid Sub2API OpenAI OAuth entries from a single selected JSON file.
- Import all valid Sub2API OpenAI OAuth entries from a single renderer file payload.
- Support Sub2API batch import in both OpenCode and Codex modes.
- Preserve existing OpenCode single-entry auth imports.
- Preserve existing direct Codex single-entry auth imports.
- Return all imported managed account ids in `ImportResult.importedAccountIds`.
- Keep every persisted store write inside the existing import handlers that already run through `runStoreMutation()`.
- Preserve revision bumps, quota hydration, and quota failure retention through the existing `importManagedAccountWithQuota()` path.

### Out of scope

- No dedupe semantic changes.
- No live auth preservation changes.
- No quota request behavior changes.
- No new dependencies.
- No export-format changes.
- No token values in docs, notices, logs, or task records.

## Chosen plan

1. Add Sub2API-specific parsing in `electron/opencode.ts` next to existing auth-file pickers.
2. Add `pickAuthEntriesForMode()` that returns all Sub2API entries when the batch schema is present, otherwise returns the existing single direct-Codex or OpenCode OAuth pick as a one-element array.
3. Keep `pickAuthEntryForMode()` as a first-entry compatibility wrapper for live/login import call sites.
4. Change `importAuthFiles()` and `importAuthPayloads()` in `electron/main.cts` to loop over every picked entry for each parsed file/payload.
5. Reload the store after every imported entry so sequential imports keep current persisted state, revision, and quota/history updates.

## Resulting changes

- `electron/opencode.ts`
  - Recognizes top-level Sub2API `accounts[]` exports.
  - Maps Sub2API OAuth credentials into existing managed auth shapes.
  - Adds `pickAuthEntriesForMode()` for batch-aware file/payload imports.
  - Keeps `pickAuthEntryForMode()` available for existing single-entry flows.
- `electron/main.cts`
  - Imports the batch-aware picker.
  - Updates selected-file and renderer-payload import loops to import every picked entry sequentially.
  - Dedupes repeated notice strings within an import result without changing account dedupe behavior.

## Verification evidence

- TypeScript/LSP diagnostics: passed with no diagnostics for `electron/opencode.ts` and `electron/main.cts`.
- `npm run lint`: passed (`tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.electron.json`).
- `npm run build`: passed (`vite build` and `tsc -p tsconfig.electron.json`).

## Follow-up

- No unresolved product follow-up is known for this scoped Sub2API import support.

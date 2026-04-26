# Managed Store Corruption Recovery Task Record

## User report

- Request date: 2026-04-26.
- User asked for a minimal bugfix so a corrupted or unreadable existing `manager-store.json` no longer silently becomes an empty managed store that can later overwrite the unreadable primary.
- Import-capable flows should recover by quarantining the unreadable primary and importing into a fresh store with a user-visible `ImportResult.notices` message.
- Non-import mutations should fail instead of overwriting an unreadable existing store.
- Follow-up: `accounts:import-file` must not quarantine or move a corrupt primary store when the user cancels the file picker before selecting files.
- User correction: strict handling made the Electron app show blank/no content when `manager-store.json` was corrupt with NUL bytes, and `settings:update` mode switching was blocked by `StoreReadError`. Startup/dashboard rendering and settings changes must recover instead of failing closed.

## Scope boundary

### In scope

- Preserve valid store loading behavior.
- Preserve missing-store first-run behavior by returning the default store only when the primary file is absent.
- Treat read, parse, or normalization failures for an existing primary store as explicit store read failures.
- Treat non-object JSON values in the primary store as corrupt instead of normalizing them as object-like stores.
- Allow these import flows to recover by quarantining the unreadable primary before saving new imported data:
  - `accounts:import-live`
  - `accounts:login-import`
  - `accounts:import-file`
  - `accounts:import-file-payloads`
- For `accounts:import-file`, defer quarantine until after files are selected; canceling the dialog should return `null` with no disk mutation.
- Allow `dashboard:get-state`, `settings:update`, and `settings:pick-auth-path` to recover from a corrupt primary store by quarantining it once and using a fresh default store.
- Keep all managed store writes on existing `saveStore()` calls from handlers already inside `runStoreMutation()`.
- Keep imported accounts when quota fetch fails by preserving existing `lastError` behavior.
- Keep existing revision bump and atomic save behavior.

### Out of scope

- No new backup system.
- No deletion of corrupted store files.
- No dedupe semantic changes.
- No live auth provider preservation changes.
- No changes to auth export payload semantics.
- No manual changes to built `dist` or `dist-electron` output.

## Root cause

`electron/store.ts` previously wrapped store file read, JSON parse, and normalization in one broad `catch` inside `loadStore()`. Any error, including malformed JSON or an unreadable existing file, returned `defaultStore()`. Later mutating handlers could then save that default-derived state through `saveStore()`, replacing the unreadable primary and losing the user's previous managed-store evidence.

The first strict recovery pass over-corrected by leaving startup and settings paths on strict `loadStore()`. When the primary store contained NUL bytes, `dashboard:get-state` failed before returning any `DashboardState`, leaving the renderer blank, and `settings:update` failed before the user could switch mode and continue recovery/import work.

## Chosen plan

1. Change `loadStore()` so missing file (`ENOENT`) remains the only default-store path.
2. Add an exported strict read error for existing unreadable/corrupt stores.
3. Add an import-only recovery helper that renames the unreadable primary to a timestamped sibling and returns a fresh default store plus a notice.
4. Use the recovery helper only in import-capable IPC flows.
5. Prepend the quarantine notice to `ImportResult.notices` and expose `quarantinedStorePath` only when recovery happened.
6. Leave non-import handlers on strict `loadStore()` so they fail before saving.
7. Follow-up tightening: make `accounts:import-file` show the file picker before recovery when the primary store is corrupt, so cancel does not quarantine the store.
8. User-correction recovery: add a general recovery loader for startup/settings so the UI can render and mode switching can proceed after quarantining a corrupt primary store.

## Resulting changes

- `electron/store.ts`
  - Added `StoreReadError` for unreadable/corrupt existing primary store failures.
  - Split store parsing from file reading.
  - Rejects non-object JSON store contents as corrupt.
  - Kept default-store fallback for missing `manager-store.json` only.
  - Added `loadStoreWithRecovery()` to quarantine a corrupt primary store and return a fresh default store for non-import recovery paths.
  - Added `loadStoreForImportRecovery()` to quarantine the unreadable primary with a timestamped sibling path and return a fresh store plus a notice.
- `electron/main.cts`
  - Imported `loadStoreForImportRecovery()`.
  - Added a small `appendImportRecovery()` helper for `ImportResult` notices.
  - Routed only `accounts:import-live`, `accounts:login-import`, `accounts:import-file`, and `accounts:import-file-payloads` through import recovery.
  - Tightened `accounts:import-file` so a corrupt store opens a generic import dialog first; cancel returns `null` before `loadStoreForImportRecovery()` can quarantine the primary.
  - Uses `loadStoreWithRecovery()` for `dashboard:get-state`, `settings:update`, and `settings:pick-auth-path`; startup saves a fresh default store after quarantine so later reads see a valid primary store.
- `electron/types.ts`
  - Added optional `ImportResult.quarantinedStorePath` for import recovery metadata.

## Verification evidence

- TypeScript/LSP diagnostics: passed with no diagnostics for `electron/store.ts`, `electron/main.cts`, and `electron/types.ts`.
- `npm run lint`: passed (`tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.electron.json`).
- `npm run build`: passed (`vite build` and `tsc -p tsconfig.electron.json`).
- Follow-up tightening verification: passed LSP diagnostics for `electron/store.ts` and `electron/main.cts`; passed `npm run lint`; passed `npm run build`.
- Startup/settings regression verification: passed LSP diagnostics for `electron/store.ts` and `electron/main.cts`; passed `npm run lint`; passed `npm run build`.

## Follow-up

- No unresolved product follow-up is known for this minimal bugfix.

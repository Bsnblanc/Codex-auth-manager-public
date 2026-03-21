# PROJECT KNOWLEDGE BASE

## OVERVIEW

Windows Electron + React desktop app for managing the Codex/OpenAI OAuth account OpenCode uses.
The repo is shallow, but behavior is concentrated in a few hotspots, so small edits can have wide UI or state effects.

## STRUCTURE

```text
./
|- docs/        # product rules, field inventory, identity limits, bug/task records
|- electron/    # main-process IPC, auth import/export, quota fetch, store, JWT parsing
|- src/         # single renderer app, charts, hover/focus UI, styling, preload bridge types
|- package.json # dev/build/lint entry points
|- tsconfig.*   # strict TS split between renderer and electron builds
`- vite.config.ts
```

## DOMAIN GUIDES

- Read `AGENTS.md` first, then `src/AGENTS.md` before renderer work.
- Read `AGENTS.md` first, then `electron/AGENTS.md` before main-process work.
- Treat `docs/` as product contract, not optional commentary.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| App bootstrap | `src/main.tsx` | StrictMode mount and CSS import only |
| Renderer behavior | `src/App.tsx` | Single-page shell, state loading, hover/focus logic, charts |
| Renderer styling | `src/styles.css` | Tokens, dimming, markers, layout, transitions |
| Preload bridge | `electron/preload.cts`, `src/global.d.ts` | Thin IPC wrappers; renderer sees `Promise<unknown>` |
| Main-process workflows | `electron/main.cts` | IPC registration, import/refresh/activate/export flows |
| Store persistence | `electron/store.ts`, `electron/types.ts` | JSON-backed state, revision, history, domain types |
| Auth merge logic | `electron/opencode.ts`, `electron/live-auth-sync.ts` | Preserve unrelated providers, token-only matching |
| Quota fetching | `electron/quotas.ts`, `electron/jwt.ts` | Timeout handling, JWT evidence, account header |
| Identity limits | `docs/obtainable-fields.md`, `docs/subscription-identity.md` | Use docs before inventing claims |
| Hover bug history | `docs/quota-hover-marker-task-record.md` | Read before touching aggregate quota marker behavior |

## COMMANDS AND VERIFICATION

- `npm run dev` - full app dev loop; builds electron first, then runs Vite and Electron together.
- `npm run dev:renderer` - renderer-only Vite dev server.
- `npm run dev:electron` - Electron dev process; expects renderer server and built electron output.
- `npm run build` - production build for renderer then electron.
- `npm run build:renderer` - renderer bundle only.
- `npm run build:electron` - electron TypeScript build only.
- `npm run lint` - repo lint gate; actually `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.electron.json`.
- `npm run preview` - Vite preview.
- No test runner is configured in `package.json`.
- No `*.test.*` or `*.spec.*` files exist today.
- There is currently no supported single-test command.
- Before claiming app behavior changes are done, run `npm run lint` and `npm run build`.
- For UI or interaction work, also run `npm run dev` and perform a real manual check.

## CODE STYLE

### Imports and Modules

- Use ESM imports in renderer files and most `electron/*.ts` helper files.
- Keep React/third-party imports first, then local imports.
- Keep CSS side-effect imports near the entry/component that owns them, as in `src/main.tsx`.
- Use `import type` for type-only imports where the file already does so.
- Preserve the mixed-module pattern in `electron/main.cts`: one `import type` plus CommonJS `require(...)` calls.

### Formatting

- Match existing formatting instead of applying a new formatter policy.
- Use 2-space indentation, semicolons, and double quotes.
- Keep multiline objects, arrays, and JSX props expanded when lines get dense.
- Keep JSON output pretty-printed with 2 spaces when writing files.
- No Prettier config or ESLint config is present; local consistency matters more than global reflow.

### Types

- Prefer `type` aliases over `interface` for domain shapes.
- Prefer explicit literal unions, `Record<...>`, and explicit `null` fields.
- Narrow `unknown` values with guards before use.
- Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`.
- The renderer bridge is intentionally weakly typed in `src/global.d.ts`; validate IPC payloads before applying them.
- Do not assume shared types are centralized: `src/App.tsx` duplicates some domain types locally.

### Naming

- Use `PascalCase` for components and type aliases.
- Use `camelCase` for functions, helpers, and variables.
- Use `SCREAMING_SNAKE_CASE` for stable constants.
- Reuse existing domain keys exactly: `fiveHour`, `weekly`, `codeReview`, `accountId`, `pollIntervalMs`.
- Keep IPC channels namespaced and lowercase, e.g. `dashboard:get-state`, `accounts:import-file-payloads`.
- In CSS, use kebab-case classes with `is-*` state modifiers.

### State and Data Flow

- In renderer state updates, prefer functional setters when current state matters.
- Respect the revision gate: renderer should accept newer-or-equal snapshots only.
- In persisted mutations, create new objects via spreads/maps instead of mutating store structures in place.
- Every persisted mutation must bump `revision`.
- All state-changing IPC handlers should flow through `runStoreMutation()`.
- Keep history updates going through `recordHistory()` instead of ad hoc slicing logic.

### Error Handling

- Throw readable `Error` messages at process boundaries.
- Preserve imported records when quota fetch fails; store the failure in `lastError` instead of dropping the account.
- Normalize or translate selected user-facing errors in the renderer instead of leaking raw backend details everywhere.
- Silent fallback catches are acceptable only where the repo already uses them for non-fatal defaults, missing files, or best-effort restore paths.
- Do not add noisy `console.*` logging patterns; none are used currently.

### IPC and Electron

- Keep the preload bridge thin: verb-style wrappers over `ipcRenderer.invoke(...)` only.
- Keep IPC payloads plain: strings, arrays, and simple objects.
- Register handlers centrally in `electron/main.cts`.
- Preserve atomic file-write behavior in store/auth helpers.
- When touching OpenCode auth sync, replace only the Codex/OpenAI node and preserve unrelated providers exactly.

### UI and CSS

- Keep UI changes surgical. `src/App.tsx` and `src/styles.css` are large on purpose.
- Treat hover and focus as separate interaction modes.
- Hover highlights/dims existing structure; focus opens charts and locks context.
- Do not fix hover issues by filtering rows, hiding markers, reflowing aggregate bars, or deleting zero states unless explicitly requested.
- CSS is token-driven from `:root`; prefer existing variables and class patterns over one-off colors.
- Preserve selector order and specificity around `.state-region` and `.quota-segment`; dimming bugs can come from later selectors overriding earlier ones.

## PRODUCT RULES

- Manage only the Codex/OpenAI auth fragment used by OpenCode.
- Preserve unrelated provider auth entries in the live auth file.
- Keep identity and subscription claims evidence-based.
- Do not present `accountId`, `email`, `planType`, or JWT user ids as official billing subscription identifiers.
- Do not widen `sameSubscription()` beyond token equality without explicit new evidence and requirements.
- Keep `fetchQuotaSnapshot()` timeout protection and `ChatGPT-Account-Id` header behavior intact when available.

## DOCUMENTATION AND REPO RULES

- Update `docs/` when a bug fix changes behavior, clarifies a hard boundary, or records a non-obvious debugging lesson.
- Read the matching doc before editing identity, hover/focus, quota, or auth-sync behavior.
- Keep agent docs specific to this repo; do not replace them with generic Electron/React advice.
- No `.cursor/rules/` entries were found.
- No `.cursorrules` file was found.
- No `.github/copilot-instructions.md` file was found.

## ANTI-PATTERNS

- Do not overwrite the entire OpenCode auth file when switching accounts.
- Do not bypass `runStoreMutation()` for a new mutating IPC handler.
- Do not drop imported records because a live fetch failed.
- Do not broaden dedupe keys to `providerKey`, `email`, `planType`, or JWT ids.
- Do not conflate hover bugs with focus behavior.
- Do not add type suppressions to force progress.
- Do not claim verification without the commands you actually ran.

## NOTES

- Renderer boot is minimal; most renderer reasoning lives in `src/App.tsx`.
- Main-process responsibilities are already split by concern; add to the right helper file instead of growing `electron/main.cts` blindly.
- The codebase is strict TypeScript but not formatter-heavy; preserve local patterns.

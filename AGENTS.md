# PROJECT KNOWLEDGE BASE

## OVERVIEW

Windows Electron + React desktop app for managing Codex/OpenCode OAuth accounts, local auth files, quota snapshots, and account switching.
The repo is small, but most behavior is concentrated in a few hotspots, so seemingly local changes can affect UI state, persistence, or live auth sync.

## STRUCTURE

```text
./
|- docs/              product boundaries, bug/task records, identity evidence
|- electron/          main-process IPC, auth file logic, quota fetch, persistence
|- src/               single renderer app, charts, hover/focus UI, styling
|- dist/              renderer build output
|- dist-electron/     Electron build output
|- package.json       authoritative dev/build/lint commands
|- tsconfig*.json     strict TS configs split by renderer/electron
`- vite.config.ts     renderer dev server config
```

## READ FIRST

- Read this file before touching code.
- For renderer work, read `src/AGENTS.md` before editing `src/App.tsx` or `src/styles.css`.
- For main-process work, read `electron/AGENTS.md` before editing `electron/main.cts` or auth/store helpers.
- Treat `docs/` as product contract, not optional commentary.
- Ignore `.research/` unless you are intentionally studying reference material; it is not the app's runtime surface.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Renderer bootstrap | `src/main.tsx` | StrictMode mount and CSS import only |
| Main renderer behavior | `src/App.tsx` | Single-page shell, state loading, hover/focus logic, charts |
| Renderer styling | `src/styles.css` | tokens, dimming, markers, layout, transitions |
| Window bridge types | `src/global.d.ts` | renderer sees weak `Promise<unknown>` IPC surface |
| Preload bridge | `electron/preload.cts` | thin `ipcRenderer.invoke(...)` wrappers only |
| IPC entry point | `electron/main.cts` | every renderer action is wired here |
| Persistence and store rules | `electron/store.ts`, `electron/types.ts` | `revision`, disk format, history, dedupe |
| Auth merge/export logic | `electron/opencode.ts`, `electron/live-auth-sync.ts` | preserve unrelated providers; token-based matching |
| Quota fetching | `electron/quotas.ts`, `electron/jwt.ts` | timeout behavior, JWT evidence, account header |
| Identity/subscription boundaries | `docs/subscription-identity.md` | evidence-based claims only |
| Hover/focus bug history | `docs/quota-hover-marker-task-record.md` | read before changing aggregate quota behavior |

## COMMANDS AND VERIFICATION

- Package manager: `npm`.
- Dev loop: `npm run dev`.
- Renderer-only dev: `npm run dev:renderer`.
- Electron-only dev: `npm run dev:electron`.
- Full production build: `npm run build`.
- Renderer build only: `npm run build:renderer`.
- Electron build only: `npm run build:electron`.
- Lint gate: `npm run lint`.
- Preview renderer build: `npm run preview`.
- `npm run lint` is typecheck-only: `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.electron.json`.
- There is no root `test` script in `package.json`.
- There is no configured root test runner (`vitest`, `jest`, `playwright`, etc.).
- There are no app `*.test.*` or `*.spec.*` files under `src/`, `electron/`, or `docs/`.
- There is no supported single-test command for the root app today.
- Tests exist only inside `.research/openai-codex/...`; those are nested research packages and are not authoritative for this app.
- No repo CI/workflow config was found under `.github/workflows`.
- Before claiming code changes are done, run `npm run lint` and `npm run build`.
- For UI or interaction changes, also run `npm run dev` and perform a real manual check in Electron.

## CODE STYLE

### Imports and Modules

- Use ESM imports in renderer files and most Electron helper files.
- Keep React/third-party imports before local imports.
- Use `import type` for type-only imports where the file already follows that pattern.
- Keep CSS side-effect imports close to the owning entry/component, as in `src/main.tsx`.
- Preserve the mixed-module pattern in `electron/main.cts`: one `import type` plus CommonJS `require(...)` runtime imports.

### Formatting

- Match the existing local style instead of inventing a formatter policy.
- Use 2-space indentation, semicolons, and double quotes.
- Expand dense objects, arrays, and JSX props across lines when readability drops.
- Keep persisted JSON pretty-printed with 2 spaces when writing files.
- No Prettier or ESLint config is present; consistency with nearby code matters more than blanket reflow.

### Types and Data Shapes

- TypeScript is strict; keep code compatible with `tsconfig.base.json` strict mode.
- Prefer `type` aliases for domain shapes; the codebase uses many exported and local `type` blocks.
- Prefer explicit unions, `Record<...>`, and explicit `null` fields over loose optional shape guessing.
- Narrow `unknown` values before use; see `isDashboardState()` and store/auth parsing helpers.
- Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- The preload bridge is intentionally weakly typed in `src/global.d.ts`; validate IPC payloads before applying them.
- Shared concepts may exist in both renderer-local and Electron-shared forms; do not assume every type is centralized.

### Naming

- Use `PascalCase` for React components and type aliases.
- Use `camelCase` for functions, hooks, helpers, and variables.
- Use `SCREAMING_SNAKE_CASE` for stable constants.
- Reuse existing domain keys exactly: `fiveHour`, `weekly`, `codeReview`, `accountId`.
- Keep IPC channel names lowercase and namespaced, e.g. `dashboard:get-state`, `accounts:import-file-payloads`.
- In CSS, use kebab-case classes with `is-*` state modifiers.

### Error Handling

- Throw readable `Error` messages at process boundaries.
- Preserve imported records when quota fetch fails; store the failure in `lastError` instead of dropping the account.
- Translate selected backend errors into renderer copy rather than leaking raw strings everywhere.
- Silent fallback catches are acceptable only for existing best-effort restore/default paths.
- Do not add noisy `console.*` logging; it is not a current project pattern.

### Renderer and CSS

- Keep UI changes surgical. `src/App.tsx` and `src/styles.css` are intentionally large hotspots.
- Hover and focus are separate interaction modes: hover highlights/dims, focus locks context and opens charts.
- Aggregate quota rows should stay structurally stable unless the user explicitly asks for filtering or reflow.
- CSS is token-driven from `:root`; prefer existing variables and class patterns over one-off colors.
- Be careful with selector order around `.state-region` and `.quota-segment`; later selectors can accidentally override dim states.
- Preserve the revision gate: renderer should accept snapshots only when `next.revision >= current.revision`.

### Electron and IPC

- Keep the preload bridge thin: verb-style wrappers over `ipcRenderer.invoke(...)` only.
- Keep IPC payloads plain: strings, arrays, booleans, numbers, and simple objects.
- Register handlers centrally in `electron/main.cts`.
- All state-changing IPC handlers must flow through `runStoreMutation()`.
- Every persisted mutation must bump `revision`.
- Keep history writes going through `recordHistory()` instead of ad hoc slicing or replacement logic.
- Preserve atomic file-write behavior in store/auth helpers.
- When touching live auth sync, replace only the managed Codex/OpenAI fragment and preserve unrelated providers exactly.

## PRODUCT AND DATA RULES

- Manage only the Codex/OpenAI auth fragment used by this app.
- Preserve unrelated provider auth entries in live auth files.
- Keep identity and subscription claims evidence-based.
- Do not present `accountId`, `email`, `planType`, `chatgptUserId`, or JWT user ids as official billing subscription identifiers.
- `sameSubscription()` is intentionally token-based; do not broaden matching without explicit new requirements and evidence.
- Keep `fetchQuotaSnapshot()` timeout protection and `ChatGPT-Account-Id` header behavior intact when available.

## DOCS AND REPO RULES

- Update `docs/` when a bug fix changes behavior, clarifies a hard boundary, or records a non-obvious debugging lesson.
- Every non-trivial user request must leave a trace in the right doc in the same work pass; do not treat conversation context as the only record.
- Record both user asks and user corrections/replies when they change scope, acceptance, architecture, or terminology.
- Put the trace in the doc that matches the change: product doc for requirement changes, task/troubleshoot record for debugging and delivery history, architecture doc for system-shape explanations, AGENTS/workflow docs for lasting development rules.
- Each multi-step task must have an explicit recorder owner. Default: the main line owns the record, or it assigns a dedicated docs/record lane before implementation starts.
- Minimum trace content for non-trivial work: user request, clarified interpretation, in-scope / out-of-scope boundary, chosen plan, resulting changes, verification evidence, and unresolved follow-up.
- If a user says an explanation is hard to understand, update the relevant doc with a simpler wording in the same pass instead of leaving the clarification only in chat.
- Do not start the next major task while the current task's required record is still missing.
- Read the matching doc before editing identity, quota, hover/focus, or auth-sync behavior.
- Keep agent docs specific to this repo; do not replace them with generic Electron/React advice.
- No `.cursor/rules/` entries were found.
- No `.cursorrules` file was found.
- No `.github/copilot-instructions.md` file was found.

## ANTI-PATTERNS

- Do not overwrite the entire auth file when switching or importing a single account.
- Do not bypass `runStoreMutation()` for a mutating IPC handler.
- Do not drop imported records because live quota fetch failed.
- Do not broaden dedupe keys to `providerKey`, `email`, `planType`, or JWT user ids.
- Do not conflate hover bugs with focus behavior.
- Do not hide rows, remove markers, or reflow aggregate bars unless the request explicitly asks for that behavior.
- Do not add type suppressions to force progress.
- Do not claim verification without the commands you actually ran.

## NOTES

- Renderer reasoning is concentrated in `src/App.tsx`; main-process orchestration is concentrated in `electron/main.cts`.
- The codebase is disciplined enough to follow existing patterns closely, but not formatter-heavy.
- If unsure where a change belongs, prefer the existing helper split over growing the main hotspots blindly.

# OpenCode Codex Auth Manager

## Product Goal

Build a Windows desktop app that manages OpenCode auth and direct file-backed Codex auth through one unified interface, while transforming between the two formats only when needed.

The app must let the user:

- view all managed Codex accounts and their live quota state
- switch which Codex account OpenCode currently uses
- add, import, export, and delete accounts
- inspect aggregate and per-account usage statistics

## Scope

### In Scope

- Windows desktop app
- single-page interaction model
- support OpenCode-mode and Codex-mode auth workflows
- manage Codex/OpenAI auth used by OpenCode and compatible direct Codex auth files
- preserve other provider auth inside the live OpenCode auth file
- active-account dynamic quota polling plus reset-based background refresh
- local historical storage for usage snapshots
- polished UI with concise, design-forward visuals

### Out of Scope

- managing non-Codex providers
- multi-page navigation as the primary UI model
- browser extension or web-only version
- modifying unrelated auth provider entries

## Product Rules

1. The app keeps its own managed account store rather than relying on one live auth file snapshot.
2. When the target file is an OpenCode auth file, unrelated provider entries must remain unchanged.
3. When the target file is a direct Codex auth file, writeback is allowed only if the managed account preserves the direct-specific fields required by that file format.
4. The current mode determines which login/import/export/switch actions are available and which target auth path is shown.
5. The app exposes only two user-facing auth formats: OpenCode auth and Codex auth.
6. The app may keep a richer internal auth superset, but that internal shape is not a user-facing import/export format.
7. The UI is single-page. Hover and focus states determine what details are visible.
8. Usage statistics only expand when the user focuses an account or the aggregate view.

## Desktop Architecture

### Chosen Stack

- Electron
- React
- TypeScript
- Vite
- JSON-backed local persistence for MVP history storage

Rationale:

- Node toolchain is available in the workspace
- Rust and .NET SDK are not available
- Electron can ship a polished Windows desktop app without extra system prerequisites

## Managed Data Model

### Managed Account

- `id`
- `label`
- `color`
- `createdAt`
- `updatedAt`
- `lastUsedAt`
- `authFragment`
- `profilePath`
- `status`
- `planType`
- `workspaceName`
- `email`
- `isActive`

### Live Quota Snapshot

- `accountId`
- `fetchedAt`
- `fiveHour`
- `weekly`
- `codeReview`
- `credits`
- `rawPayload`

### Usage Window

- `limitId`
- `used`
- `remaining`
- `percentRemaining`
- `resetAt`
- `status`

### App Preferences

- `pollIntervalMs`
- `theme`
- `opencodeAuthPath`
- `compactMode`

## Auth Management Model

### Source of Truth

The app stores managed Codex account fragments in its own profile store.

### Auth Target Rule

The configured auth path may point to:

1. an OpenCode auth file with multiple provider nodes, or
2. a direct file-backed Codex auth file.

The visible auth path belongs to the current mode only.

### Mode Rule

The app has two modes:

1. `OpenCode` mode
2. `Codex` mode

The current mode controls:

- which login command is used
- which JSON import format is accepted
- which auth path is edited and written
- which accounts are visible and switchable
- which export format is produced

### Acquisition Rule

- `OpenCode` mode accepts OpenCode login/import flows
- `Codex` mode accepts Codex login/import flows
- if an imported OpenCode account lacks direct Codex fields, it remains usable only in OpenCode mode

### OpenCode Sync Rule

When the user switches accounts, the app:

1. reads the current OpenCode live auth file
2. identifies the Codex/OpenAI auth node
3. replaces only that node with the selected managed account fragment
4. writes the merged result back atomically
5. preserves every unrelated provider entry exactly as-is

### Import and Export

- import only Codex/OpenAI auth fragments into the managed store
- export only the current mode's real auth format
- do not import or export unrelated provider credentials
- do not expose any separate richer manager format to the user

## Quota and Statistics Model

### Live Quota

The app keeps the active account on dynamic refresh and wakes background accounts primarily from their known reset times.

### Historical Statistics

The app stores snapshots locally and derives:

- aggregate usage
- per-account usage
- recent trends
- exhaustion and reset events
- switch history

## Interaction Model

## Default State

- show three aggregate quota bars only
- do not show usage charts yet
- show account color composition inside each current remaining bar
- show a side panel with aggregate app summary

## Hover State

When hovering an account segment in any quota bar:

- highlight the same account across all three quota bars
- dim other accounts
- update the side panel to the hovered account identity and status
- do not expand usage charts yet

## Focus State

When clicking an account segment:

- lock focus on that account
- show that account's usage charts for all three quota types
- keep the side panel on that account
- morph the top three quota bars into that account's three current quota fills until focus exits

When clicking an aggregate quota bar:

- lock focus on the aggregate view
- show aggregate usage charts

## Visual Model

### Main Quota Bars

Each bar represents one quota type:

- 5-hour quota
- weekly quota
- code review quota

Each bar uses:

- full track = baseline total capacity
- filled length = current aggregate remaining percent
- colored segments inside the filled portion = each account's share of the current remaining total

### Low or Zero Accounts

- very small accounts retain true proportion in the bar
- tiny hit areas are compensated with larger hover targets and legend chips
- zero-remaining accounts do not occupy remaining bar area
- zero or unknown accounts remain visible in the account chip rail and side panel state

## Single-Page Layout

- top: app title, refresh, add/import/export actions
- center: three quota bars stacked vertically
- right: side panel for aggregate or focused account identity and actions
- bottom: focus-only charts area, hidden until aggregate or account focus is selected
- footer rail: account chips for direct focus, state, and legend mapping

## Core Features for MVP

1. local managed account store
2. mode-specific login/import/export/switch behavior
3. on-demand OpenCode Codex auth merge-patch switching
4. compatible direct Codex file-backed auth import and safe writeback
5. active dynamic + background reset-based quota refresh
6. single-page dashboard with hover/focus interactions
7. aggregate and per-account charts
8. add/import/export/delete actions
9. local persistence of quota history

## Validation Criteria

- user can add at least two managed Codex accounts
- current mode determines login/import/export/switch behavior
- user can switch OpenCode's active Codex auth without overwriting unrelated providers
- direct file-backed Codex auth can be imported when it contains the required direct fields
- all managed accounts display quota state in one screen
- hover links one account across all three quota bars
- click switches the chart area between aggregate and per-account views and the top bars morph to the focused account values
- build completes successfully

# OpenCode Codex Auth Manager

## Product Goal

Build a Windows desktop app that manages the Codex auth used by OpenCode.

The app must let the user:

- view all managed Codex accounts and their live quota state
- switch which Codex account OpenCode currently uses
- add, import, export, and delete accounts
- inspect aggregate and per-account usage statistics

## Scope

### In Scope

- Windows desktop app
- single-page interaction model
- manage only Codex/OpenAI auth used by OpenCode
- preserve other provider auth inside the live OpenCode auth file
- live quota polling for all managed accounts
- local historical storage for usage snapshots
- polished UI with concise, design-forward visuals

### Out of Scope

- managing non-Codex providers
- multi-page navigation as the primary UI model
- browser extension or web-only version
- modifying unrelated auth provider entries

## Product Rules

1. The app manages only the Codex/OpenAI auth fragment that OpenCode uses.
2. Other provider auth entries in OpenCode's live auth file must remain unchanged.
3. The app keeps its own managed account store rather than relying on one live auth file snapshot.
4. The UI is single-page. Hover and focus states determine what details are visible.
5. Usage statistics only expand when the user focuses an account or the aggregate view.

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

### OpenCode Sync Rule

When the user switches accounts, the app:

1. reads the current OpenCode live auth file
2. identifies the Codex/OpenAI auth node
3. replaces only that node with the selected managed account fragment
4. writes the merged result back atomically
5. preserves every unrelated provider entry exactly as-is

### Import and Export

- import only Codex/OpenAI auth fragments into the managed store
- export only the managed Codex/OpenAI fragment and metadata
- do not import or export unrelated provider credentials

## Quota and Statistics Model

### Live Quota

The app polls quota for every managed account independently.

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
2. live OpenCode Codex auth merge-patch switching
3. quota polling for all accounts
4. single-page dashboard with hover/focus interactions
5. aggregate and per-account charts
6. add/import/export/delete actions
7. local persistence of quota history

## Validation Criteria

- user can add at least two managed Codex accounts
- user can switch OpenCode's active Codex auth without overwriting unrelated providers
- all managed accounts display live quota state in one screen
- hover links one account across all three quota bars
- click switches the chart area between aggregate and per-account views
- build completes successfully

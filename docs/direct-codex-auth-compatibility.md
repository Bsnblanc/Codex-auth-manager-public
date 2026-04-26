# Direct Codex Auth Compatibility Record

## Purpose

Record the actual structural differences between the current local OpenCode auth file and the current local Codex direct auth file, then decide whether direct Codex support can reuse existing stored auth without reacquiring credentials.

## Files Compared

- `C:\Users\blank\.local\share\opencode\auth.json`
- `C:\Users\blank\.codex\auth.json`

## Actual Current Shapes

### OpenCode live auth file

Current Codex/OpenAI node shape:

- top-level provider key: `openai`
- `type`
- `refresh`
- `access`
- `expires`
- `accountId`

Not present in the current file entry:

- `auth_mode`
- `tokens`
- `tokens.id_token`
- `last_refresh`

### Codex direct auth file

Current root shape:

- `auth_mode`
- `OPENAI_API_KEY`
- `tokens.id_token`
- `tokens.access_token`
- `tokens.refresh_token`
- `tokens.account_id`
- `last_refresh`

## Direct Comparison Result

The two files are **not the same schema**.

They overlap only on the OAuth credential core:

- OpenCode `access` ~= Codex `tokens.access_token`
- OpenCode `refresh` ~= Codex `tokens.refresh_token`
- OpenCode `accountId` ~= Codex `tokens.account_id`

But the direct Codex file also requires fields that are not present in the current OpenCode entry:

- `tokens.id_token`
- root `auth_mode`
- root `last_refresh`

## Current Local Verification

The current local OpenCode live auth and the current local Codex direct auth are **not duplicates**.

Verified facts from the actual files:

- same access token: `false`
- same refresh token: `false`
- same account id: `false`
- OpenCode current entry has `id_token`: `false`
- Codex current entry has `tokens.id_token`: `true`

So for the **current two local files**, direct Codex cannot reuse the current OpenCode auth as-is.

## Decision

### Hard conclusion for the current local files

For the currently compared files, **reacquisition is required if the goal is to turn the current OpenCode live auth directly into the current Codex direct auth**.

Reason:

- they are different accounts
- the OpenCode entry is missing `id_token`
- the direct Codex file has extra direct-only wrapper fields

### General rule for implementation

Do **not** assume every OpenCode-managed account can be written into a direct Codex auth file without reacquiring.

Safe rule:

1. If a managed account already came from a direct Codex file and still preserves the direct-specific fields, reuse it without reacquiring.
2. If a managed account only has the OpenCode-style fragment (`access`/`refresh`/`expires`/`accountId`) and lacks `id_token`, do not claim direct Codex writeback is safe.
3. In that case, require one direct Codex import/login for that account before managing it as a direct Codex target.

## Verified Directionality

- `Codex -> OpenCode`: supported when the direct Codex file contains the expected OAuth tokens; the shared OAuth base can be written back as an OpenCode `openai` auth node.
- `OpenCode -> Codex`: not generally safe unless the managed account also preserves the direct Codex-only fields, especially `id_token`.

## Implementation Boundary

This means the app can safely support:

- importing direct Codex auth files into the existing managed account store
- detecting whether a managed account has enough direct-specific fields for direct Codex writeback
- refusing direct Codex activation/writeback when the required direct fields are missing

## Final Managed Auth Model

The app now stores one account record per real account:

1. `authBase` — shared OAuth fields used by OpenCode auth export, live quota fetch, and OpenCode auth switching
2. `codexExtras` — optional direct Codex-only fields required for Codex export/writeback

This internal model is not a third user-facing import/export format.

## Merge Rule

- same access token updates the existing record
- same `accountId` imported through a different supported auth form merges into that existing record
- same-account cross-format imports must not hard-abort and must not create a duplicate managed record

## Public Format Decision

The app should expose only two user-facing auth formats:

1. OpenCode auth
2. direct Codex auth

The app may keep a richer internal auth superset to transform between them when possible, but that richer shape should not be exposed as a third public import/export format.

This avoids pretending the two formats are interchangeable when the current local evidence shows they are not.

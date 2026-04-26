# Release Blocker Fixes - 2026-03-22

## Purpose

Record the high-priority release fixes applied in this pass so future edits do not reopen the same failures.

## Fixed Issues

### 1. Codex auto-switch could silently fail

- Problem: when the active account was exhausted in `codex` mode, auto-switch candidate selection considered all managed accounts.
- Failure mode: the picker could choose an OpenCode-only account, direct Codex writeback would throw, and the empty catch in `electron/main.cts` would leave the active account unchanged.
- Fix: `electron/main.cts` now filters auto-switch refresh/pick candidates with `canUseAccountInMode(account, currentMode)` before refresh and selection.

## 2. Auth import/sync boundary was too loose

- Problem: `electron/opencode.ts` would fall back to any OAuth-shaped provider entry when no recognized Codex/OpenAI key was present.
- Risk: unrelated OAuth providers could be imported or targeted during sync-related detection.
- Fix:
  - direct Codex detection now requires `tokens.id_token` in addition to access/refresh tokens
  - preferred OpenCode parsing now accepts only the supported top-level keys: `opencode`, `codex`, `openai`, `chatgpt`
  - `pickAuthEntryForMode()` is now mode-specific instead of mode-agnostic

## 3. Zero-quota leading marker could overflow the left edge

- Problem: a leading `start` marker at `0%` rendered inside `.quota-track-states`, but the marker layer was not clipped, so the marker cap and shadow painted outside the track.
- Fix: `src/styles.css` now clips `.quota-track-states` with `overflow: hidden` and `border-radius: inherit`.

## 4. Overview quota card could be obscured on short window heights

- Problem: the overview-only layout centered the quota card vertically while the main stage also clipped overflow, so shrinking the window could hide the top of the quota panel under the header region.
- Final fix: `src/styles.css` keeps the page non-scrolling, preserves overview centering, and uses compact low-height spacing plus the correct chip-toggle anchor so the quota card stays visible without moving the toggle to the page bottom.

## Verification

- `npm run lint`
- `npm run build`

Both passed after the fixes.

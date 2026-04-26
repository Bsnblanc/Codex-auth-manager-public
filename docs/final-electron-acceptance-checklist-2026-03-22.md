# Final Electron Acceptance Checklist - 2026-03-22

## Purpose

This is the final manual acceptance pass for the current shipped scope.

Use this checklist to decide whether the app is ready to be called product-layer accepted.

## Acceptance Rule

The build is acceptable only if all required checks below pass in a real Electron session.

## Test Setup

- Start the app with `npm run dev`
- Use real local auth files for both modes
- Prepare at least:
  - one usable OpenCode-compatible account
  - one usable direct Codex-compatible account
  - one second account in the same mode to verify switching and exhausted-account handoff

## Required Pass Criteria

### 1. App Boot

- App opens without bridge failure
- Dashboard state loads
- No obviously broken layout on first render

### 2. OpenCode Mode

- Switch to `OpenCode` mode
- Confirm the visible auth path is the OpenCode path
- Import or login-import an account successfully
- Imported account appears in the managed list
- Refresh succeeds and quota data appears
- Export succeeds in OpenCode format

Pass if:
- the account is visible
- quota is shown
- export completes without corrupting unrelated providers

### 3. Codex Mode

- Switch to `Codex` mode
- Confirm the visible auth path is the Codex path
- Import or login-import a direct Codex-compatible account successfully
- Imported account appears in the managed list
- Refresh succeeds and quota data appears
- Export succeeds in Codex format

Pass if:
- the account is visible in Codex mode
- quota is shown
- export completes with direct Codex-compatible payload

### 4. Manual Account Switching

- In OpenCode mode, activate a different visible account
- Confirm the active account badge changes
- Confirm the target auth file updates correctly
- Repeat in Codex mode with a Codex-compatible account

Pass if:
- active account highlight updates
- writeback succeeds
- unrelated provider entries remain intact for OpenCode auth files

### 5. Automatic Refresh

- Leave the app running long enough for an active account refresh window
- Confirm quota updates still arrive without manual polling UI
- Confirm background accounts in the current mode still refresh after reset-based wakeups or fallback timing

Pass if:
- active account refresh occurs automatically
- app remains stable while automatic refresh runs

### 6. Exhausted Account Auto-Switch

- Make the current active account reach zero remaining quota, or use a prepared zero-quota account snapshot
- Keep another compatible account available in the same mode
- Wait for the automatic refresh / handoff path to run

Pass if:
- the app switches to another compatible account automatically
- the active badge moves
- target auth writeback follows the new active account

### 7. Aggregate Quota Visuals

- In overview mode, inspect all three aggregate bars
- Verify very small segments remain visible
- Verify zero-quota accounts at the far left do not overflow the track
- Verify the left-edge zero marker does not show duplicate bars or artificial gaps

Pass if:
- bars stay visually stable
- the left-edge zero marker is a single correct marker inside the track

### 8. Hover and Focus

- Hover one account segment
- Confirm the same account highlights across bars and other accounts dim
- Click into account focus
- Confirm charts open and top bars morph to focused values
- Exit focus

Pass if:
- hover and focus remain separate behaviors
- no row disappears or reflows unexpectedly

### 9. Chip Rail

- In overview mode, confirm the fold button is at the quota rail lower-left edge
- Confirm the toggle is hidden by default and appears only on interaction
- Expand and collapse the chip rail
- Focus an account from the chip rail

Pass if:
- button placement is correct
- collapse behavior matches the current product rule

### 10. Small Height Layout

- Reduce the window height significantly
- In overview-only state, confirm the quota area remains centered and not obscured by the header
- Confirm the chip toggle stays attached below the quota bar, not at the page bottom

Pass if:
- the quota panel remains usable
- header overlap does not occur

## Recording Result

Record the result as:

- `PASS` if every required section passes
- `FAIL` if any required section fails

For each failure, record:

- mode
- action path
- current result
- expected result
- screenshot or file note if available

## Final Gate

You can honestly say the project reached final product acceptance only when:

- `npm run lint` passes
- `npm run build` passes
- this checklist passes in a real Electron session

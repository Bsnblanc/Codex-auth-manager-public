# Requirement Drift Guardrails - 2026-03-22

## This mistake

This session introduced an avoidable regression while fixing layout bugs:

- the chip-rail toggle was changed from `left-bottom + hidden by default`
- to `bottom-center + always visible`

That was wrong because it changed an existing interaction contract without a new explicit requirement.

## Why it happened

There were three separate failures:

1. A bug symptom was treated as permission to redesign behavior.
   - "The cards disappeared" should have been solved by restoring the existing entry point.
   - Instead, the fix changed the entry point behavior itself.

2. Existing behavior was not frozen before editing.
   - The old contract for the chip toggle was not restated before patching.
   - That made it too easy to optimize for immediate visibility instead of preserving the intended interaction.

3. Old requirements and inferred requirements were mixed together.
   - Some review notes came from source docs.
   - Some came from inference.
   - Some were stale.
   - Without labeling them, a local bug fix drifted into a contract change.

## Hard rules from now on

1. Existing interaction behavior is immutable during a bug fix unless the user explicitly changes it.
   - If the current contract is `hidden by default`, do not make it visible by default just to surface a control.

2. Before touching an existing interaction, restate the preserved contract in the task record.
   - Format:
     - `Preserve: position`
     - `Preserve: default visibility`
     - `Preserve: trigger conditions`

3. Every requirement claim in an audit or fix note must be labeled as one of:
   - `source-doc`
   - `explicit user instruction`
   - `implementation observation`
   - `inference`
   - `stale assumption`

4. If a fix needs to change interaction behavior, stop and treat it as a requirement change, not a bug fix.

5. For renderer layout fixes, never change both:
   - layout geometry
   - interaction visibility rules
   in the same patch unless the user explicitly requested both.

## Required workflow for future UI bug fixes

When fixing an existing UI behavior:

1. Read the current render path and CSS path.
2. Write down the exact preserved behavior before editing.
3. Patch geometry first.
4. Re-check whether visibility/interaction behavior changed.
5. Only then verify with `npm run lint` and `npm run build`.

## Repo-specific follow-up

- Future audit docs should label findings by source type.
- Requirement changes should be recorded as superseding decisions, not silently folded into bug-fix work.
- Acceptance docs must not promote inferred UI preferences into hard failures unless they are backed by source docs or explicit user direction.

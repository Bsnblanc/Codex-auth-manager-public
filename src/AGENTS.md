# RENDERER DOMAIN

## OVERVIEW

Renderer domain: a single React page that owns dashboard state display, menus, quota bars, hover/focus interactions, and charts.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| App bootstrap | `src/main.tsx` | StrictMode mount only |
| Renderer state loading and action wrapper | `src/App.tsx` | `useDashboardState()` and `applyState()` gate stale results by `revision` |
| Quota aggregation and hover/focus behavior | `src/App.tsx` | `computeAggregateBars()`, quota-row render, chip rail |
| Charts and time-series math | `src/App.tsx` | `buildSeries()`, `CombinedChart`, tick helpers |
| Visual behavior and dimming | `src/styles.css` | segment/marker opacity, menus, chips, chart styling |
| Hover bug history | `docs/quota-hover-marker-task-record.md` | read before changing aggregate bar behavior |

## CONVENTIONS

- Keep UI changes surgical. `src/App.tsx` is large on purpose; do not refactor it casually while fixing a small bug.
- Hover means highlight current account and dim others. Focus means lock the account or aggregate view and show charts.
- Aggregate quota rows stay structurally stable unless the user explicitly asks for filtering or reflow.
- Accept renderer state only when `next.revision >= current.revision`; stale async results must not win.
- When a UI bug has non-obvious behavior, record the fix path in `docs/` after the code lands.

## ANTI-PATTERNS

- Do not conflate hover behavior with focus behavior.
- Do not fix visual dimming bugs by deleting rows or changing aggregate geometry unless that is the requested behavior.
- Do not add type suppressions to get `App.tsx` through lint.
- Do not claim a UI fix is done without `npm run lint`, `npm run build`, and a real manual interaction check.

## NOTES

- Largest renderer hotspots are `src/App.tsx` and `src/styles.css`.
- Marker dimming has a known CSS-cascade trap: start/end marker selectors can override generic dim opacity if specificity is too low.

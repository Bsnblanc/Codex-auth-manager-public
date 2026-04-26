# Requirement Decisions - 2026-03-22

## Superseding decisions confirmed in this session

These decisions override older assumptions that were still present in audits or stale spec text.

### UI layout

- Right-side side panel is no longer required.
- Footer chip rail remains collapsible by design.
- The chip toggle stays at the quota rail's lower-left edge and is hidden by default.

### Refresh model

- Manual polling settings are no longer a product requirement.
- Refresh is automatic while the app is running.
- Active account refresh is dynamic.
- Background accounts in the current mode refresh primarily from known reset times, with a low-frequency fallback when reset time is unknown.

### Auth acquisition wording

- `live import` is part of the current import/login acquisition flow.
- `replace-from-live` is not a separate user-facing requirement.

## Why this file exists

Older assumptions were staying alive in audits because requirement changes were not recorded as explicit superseding decisions.

From now on, any change like this should be written here and reflected in `docs/product-spec.md` in the same work pass.

# BoQ — Backend Reference (on-demand)

> **Relocated from root `CLAUDE.md`** in the 2026-06-25 context-hygiene split (it was bloating the
> always-loaded instruction file with per-commit as-built detail). **Load this before working on BoQ
> backend code.** Source of truth for live status = `frontend/.claude/plans/boq/`.
> Frontend conventions = the `boq-frontend-*.md` surfaces. The DOCS-UPDATE rule was
> revised in the same split: per-slice / per-commit detail goes HERE + the plan, **never** back into the
> always-loaded `CLAUDE.md`.

---


## Where the detail lives

This file is a ROUTER. The per-surface backend reference it used to
carry lives beside it and is read ON DEMAND.

| Read this | When |
|---|---|
| [`boq-backend-wizard-endpoints.md`](./boq-backend-wizard-endpoints.md) | Calling or changing any wizard endpoint -- the full request/response reference |
| [`boq-backend-revised-boq.md`](./boq-backend-revised-boq.md) | Working on Revised BoQ or any ADR-0014 amendment -- entry, sheet mapping, column-diff carry, row match, commit overlay, cross-BoQ rate carry, Amendments B/C/D/E |
| [`boq-backend-doctypes-and-rules.md`](./boq-backend-doctypes-and-rules.md) | Touching a BoQ doctype or the pricing-editor backend rules -- the per-doctype inventory plus the feature status |
| [`boq-backend-operations.md`](./boq-backend-operations.md) | Upload worker prefill, template priced export, the single-editor lock, or template deselect behaviour |
| [`boq-backend-slice-changelog.md`](./boq-backend-slice-changelog.md) | HISTORICAL -- do not load, do not extend. Per-slice detail belongs in frontend/.claude/plans/boq/slices/ |

Nothing was dropped in the carve. If a rule is not here, it is in one of the files above.

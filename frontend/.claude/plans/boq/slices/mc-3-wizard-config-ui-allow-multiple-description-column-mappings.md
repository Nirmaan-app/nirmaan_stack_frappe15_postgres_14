## MC-3 -- wizard config UI: allow multiple Description column mappings COMPLETE

Relaxes the FRONTEND config wizard to let a sheet map the `description` role on multiple columns (the
backend already accepts them since MC-1). Frontend-only; two commits (feat + this docs). No backend, no
schema, no render-surface change.

**Verify-first (single-file enforcement, A1 held):** the config-wizard single-description enforcement lives
ENTIRELY in `frontend/src/pages/boq-wizard/SheetConfigPanel.tsx` -- the `SINGLETON_ROLES` set (drives
`usedSingletons` + the `isDisabled` role-picker gate), the Config-Done gate `roles.includes("description")`,
and the hint string. No other wizard file enforces it.

**The change:** removed `"description"` from `SINGLETON_ROLES` (mirrors the backend `config.py`
`_SINGLETON_ROLES` edit) -- `usedSingletons` + `isDisabled` both key off the set, so the role stays
selectable in every column's picker after being mapped once. **Config-Done gate UNCHANGED** --
`roles.includes("description")` is already "at least one" (presence). Hint text -> "at least one Description
(multiple allowed -- they combine in column order), one Quantity, one Rate, and one Amount column."
Config-blob shape UNCHANGED (more `column_role_map` entries; `set_sheet_config` does no role validation).
Purely permissive -- existing single-description configs behave identically.

**MC-4/5 ENTRY POINTS (render surfaces, deliberately NOT touched this slice):** both assume a single
description column via a `.find(d => d.role === "description")?.col` anchor lookup --
`ReviewTree.tsx:768` (`descriptionLetter`, the fixed Description anchor column on the review screen) and
`PricingGrid.tsx:2578` (`descriptionLetter`, the fixed Description anchor on the pricing editor). MC-4/5
make these render the multi-column faithful `description_parts_raw` (with the ` 2`/` 3` duplicate-header
display suffixes) instead of the single joined string.

**Verification (frontend-only; no unit tests exist for SheetConfigPanel role logic, none created):** tsc
wizard-scoped gate 0 errors; `yarn build` green (`built in 4m 10s`, known-benign large-chunk warnings only).


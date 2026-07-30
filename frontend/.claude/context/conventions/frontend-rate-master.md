<!-- Carved from frontend/CLAUDE.md on 2026-07-30 (structural carve).
     frontend/CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching the Rate Master frontend (RM-2) -- pipelines, structure editing, registry -->

### Rate Master (RM-2) -- Frontend Conventions

The pricing helper's read surface, SEPARATE from the pricing workbook pages. Lives in
`src/pages/pricing/rate-master/`. Reads the RM-1 endpoints (`nirmaan_stack.api.boq.rate_master.
get_rate_master_items` / `get_rate_category_config`) as-is -- NO backend coupling. Full as-built lives
in the plan doc.

- **The page home is owner option (a):** a `Rate Master` route (`/rate-master`) beside the pricing
  workbooks, `PricingRoute`-guarded (UI gate only; the endpoints' login requirement is the enforcement),
  lazy + `export { RateMasterPage as Component }`. `rateMasterRegistry.ts` is registry-shaped like
  `pricingWorkbooks.ts` (Electrical today); the sidebar registration is the SAME four registry-driven
  touches the pricing workbooks use (role-gated item, `allKeys`, `groupMappings`, flat-label Set).
- **`ratePipelineInterpreter.ts` is THE single compute source (owner-locked) -- a PURE TS module with NO
  React imports.** It executes the stored pipeline step vocabulary (`match_master_row`,
  `apply_effective_multiplier` with conditions, `scale`, `component`, `component_band`, `sum_components`,
  `install_as_ratio`, `roundup`) and produces per-step traces + finals. **Formulas are read FROM the
  config and evaluated by a tiny safe arithmetic evaluator (no `eval()`, CSP-safe) -- never hardcode the
  arithmetic.** EXACT matching on canonical values (no case-insensitive matching anywhere). **RM-3's
  pricer-facing helper consumes this module UNCHANGED -- there must never be a second implementation of
  this arithmetic.** The four RM-1 goldens are its standing test fixtures.
- **Dynamic columns come FROM the config's `attribute_definitions`** (kind, brand, one column per
  definition, the rate fields present, unit, source) -- never a hardcoded column list.
- **Unknown step type = an explicit "unsupported" state, never a silent skip** (forward-compat honesty for
  future step types). A combination with no master row renders an honest no-match with zero computed values.
- **BCS pipelines ARE shown here** (internal transparency surface); only the pricer-facing helper defers BCS.
- **The viewer search is CASE-SENSITIVE across all displayed cell values** -- the data is canonical
  UPPERCASE, so a mixed-case query intentionally finds nothing (mirrors the RM ethos: no case-insensitive
  matching anywhere).
- **RM-4a editing is ADMIN-ONLY (owner option (a); full detail in the plan doc's "Build slice RM-4a").**
  Estimates sees everything READ-ONLY -- every edit affordance is `{isAdmin && ...}` (HIDDEN, never
  disabled), gated by the pure `isRateMasterAdmin(role, userId)` in `rateMasterEdit.ts` (mirrors
  `canAdminOverride` / the server `_is_nirmaan_admin`; false while `role` is "Loading"/"Error"). The server
  (four `api/boq/rate_master.py` write endpoints) is authoritative. **PARAM VALUES ONLY** -- pipeline
  STRUCTURE / condition / attribute-definition editing is RM-4b. **Derivation tab:** each NUMERIC param in a
  step's `detail` cell is an inline edit (`InlineParamEdit`: pencil -> input, Enter saves / Escape cancels);
  the condition `when` + string params (e.g. `kind`) stay read-only. The matched-condition path is
  re-derived by `matchedConditionIndex` (config + matched item, EXACTLY as the interpreter matches) so the
  interpreter is NEVER touched. **Data tab:** an admin ACTIONS column (inline row rate/attr edit; deactivate
  via AlertDialog confirm -- freeze-and-supersede, dropped from active view, NEVER deleted) + an `AddItemDialog`
  built from the attribute definitions + rate keys; manual rows carry "Manual entry" provenance. Each write
  refetches its collection so the derivation/viewer recompute live -- and the persistence split carries the
  edit into the next pricing-panel compute with NO AI re-run. The interpreter goldens stay the invariant any
  edit must still reproduce after an edit-and-revert.
- **Data Viewer per-column-header faceted filters (`RateMasterDataViewer.tsx`):** EVERY column header
  (kind / brand / every category attribute / every rate key / unit / source sheet / row) carries a filter
  funnel opening a `ColumnFilter` Popover -- a type-to-search box over that column's DISTINCT values + a
  checkbox multi-select. A unified `columns` model (`{key, get}`) is the SINGLE source for both the
  distinct-values dropdowns (`distinctByColumn`) and the row predicate (`getForColumn`), so headers and
  filtering never drift. Composition: **AND across columns, OR within a column**; a global `Clear filters (N)`
  control shows the active-column count and resets. Purely CLIENT-SIDE over the already-loaded active items
  -- no new query, no backend change, read-only (composes cleanly with the RM-4a admin editing above).
- **RM-4b structure editor -- the THIRD tab "Pipelines" (`RateMasterPipelines.tsx` + `rateMasterStructure.ts`).**
  LIFTS the RM-4a param-values-only line: add/remove params, steps, conditions, and attribute definitions.
  READ-ONLY structural view for everyone (attribute-definitions table + each pipeline as its ordered step
  list + the stored goldens); ADMIN EDIT MODE (owner option (a): hide-not-disable) with step
  add(vocabulary picker)/remove/reorder, per-step param add/remove/rename, condition-branch + component-band
  add/remove/edit, attribute-definition add/edit/remove (a referenced def's remove button DISABLES via the
  client mirror `referencedAttrIds`; the server guard's verbatim error still surfaces on save), and the
  brand `selector` flag as an editable checkbox. **THE PREVIEW GATE (`rateMasterStructure.ts`, pure +
  vitested):** before save the page computes ALL config goldens against the DRAFT (the SAME pure
  `ratePipelineInterpreter` + live items) and shows a pass/delta table; unchanged -> green "Save", any delta
  -> "Save with N changed goldens" opening an AlertDialog that lists the deltas and requires an explicit
  confirm (**confirm-NOT-block** -- deltas impossible to miss, never forbidden). `evaluateGoldens` WRAPS the
  interpreter in try/catch so a transiently invalid draft reports `got=null` instead of crashing the preview
  (it does NOT change the interpreter). Save calls `update_rate_config` (the server re-validates -- the
  authority); the refetch flows the new structure into the Derivation + Data tabs and the pricing helper
  with no code + no AI re-run (persistence split). **Goldens are CONFIG DATA** seeded via the endpoint; the
  vitest golden files stay independent pins. Full as-built + cert: plan doc "Build slice RM-4b".

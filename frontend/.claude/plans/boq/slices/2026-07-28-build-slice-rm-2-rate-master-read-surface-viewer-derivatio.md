<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-2 (rate-master read surface -- viewer + derivation) COMPLETE

Frontend-only, session 2 of 4 of the rate-master box. Branch `feature/boq-pricing-helper`.
feat `566e2e04` + docs (this entry). Reads the RM-1 endpoints as-is; NO backend change.

### The page (owner option a)
A new **Rate Master** page under the Pricing area (`/rate-master`), beside hvac-/electrical-/
elv-pricing, `PricingRoute`-guarded (UI gate; the endpoints' login requirement is the real
enforcement), lazy + Suspense per the admin-tool convention, `export { RateMasterPage as Component }`.
Registry-shaped (`rateMasterRegistry.ts`, Electrical today) so more disciplines drop in as data.
Discipline + category selectors; the category label is enriched from the config's `category_display`.
Two tabs (Data Viewer, Derivation). Sidebar registration is the four registry-driven touches used by
the pricing workbooks (role-gated item, `allKeys`, `groupMappings`, flat-label Set) + one route object.

### The interpreter is THE SINGLE COMPUTE SOURCE (`ratePipelineInterpreter.ts`, pure TS, no React)
- Executes the stored step vocabulary against (config pipelines, master items, selected attributes):
  `match_master_row`, `apply_effective_multiplier` (with `conditions`), `scale`, `component`,
  `component_band`, `sum_components`, `install_as_ratio`, `roundup(digits)`. Produces per-step traces
  (name, explain, matched condition, band chosen, params, running value) + finals.
- **Formulas are read FROM the config and evaluated by a tiny safe arithmetic evaluator** (`evalFormula`,
  a hand-written tokenizer + recursive-descent parser for `+ - * /`, parens, unary minus, identifiers) --
  NO `eval()`, CSP-safe; the arithmetic is not hardcoded per step. `apply_effective_multiplier` multiplies
  the target by the formula's value (a pure multiplier); `scale`/`component`/`component_band` eval the
  formula directly (the operand token is bound in the env). `roundUp(x, digits)` is Excel ROUNDUP
  (away-from-zero) with a 1e-9 epsilon, matching the RM-1 Python interpreter byte-for-byte.
- **EXACT matching on canonical values** (no case-insensitive matching anywhere).
- **Honest no-match:** a combination with no master row => status `no_match`, ZERO finals.
- **Unknown step type => explicit `unsupported` state** (a trace with `unsupported:true` + pipeline status
  `unsupported`), NEVER a silent skip (forward-compat for future step types).
- **RM-3's pricer-facing helper consumes this module UNCHANGED -- there is never a second implementation
  of this arithmetic.** BCS pipelines are shown in this internal transparency surface; only the helper
  defers BCS.

### Tab 1 -- Data Viewer (`RateMasterDataViewer.tsx`)
Dynamic columns: kind, brand, then one column per attribute definition (EXCEPT brand, already a named
column -- no duplicate), then the rate fields present in the data (union, first-seen order), unit, source
sheet, source row. Kind filter (all / cable / termination). **Case-sensitive text search across ALL
displayed cell values** (so a rate value like 106.04 is findable and, because the data is canonical
UPPERCASE, "Aluminium" matches nothing while "ALUMINIUM" matches). Header line shows the active batch id +
item count. No virtualization by design (admin table, 588 rows).

### Tab 2 -- Derivation (`RateMasterDerivation.tsx`)
Configurator selectors built from `attribute_definitions`: choice attrs -> selects of the stored values;
number attrs -> selects of the values present in the data; brand shown but not selectable
(`selector:false`). Default selection seeds from the first item's attributes so at least one pipeline
matches on load. Below, EVERY pipeline in the stored config renders as an ordered step list (step name +
explain text + params in force + the matched condition rendered readably, e.g. "insulation = ARMOURED ->
discount 0.75, markup 0.35" + the running value after each step), with finals as summary cards per output.
No-match and unsupported states render explicitly with zero computed values.

### Gates (in-container, bench-verified)
vitest 976 -> 987 (+11 interpreter tests: evalFormula/roundUp primitives, the four goldens, readable
condition + toggle, honest no-match, unknown-step). tsc --noEmit 3240 -> 3240 (ZERO new). vite build exit 0.

### CERT (CC-driven, browser + server) -- ALL PASS (owner ruled on the one discrepancy)
Environment self-served: containers restarted, `bench start` (:8000 pong) + `yarn dev` (:8080) started
detached, de-staled (SW/cache purge, fresh tab, bare root then route); owner logged in (the one touchpoint).
- **V1** route loads under the guard, both tabs render; header "Electrical / Wiring, Cabling & Termination
  * batch rmbulk-c57cfe18194e * 588 items * showing 588".
- **V2** total 588; kind filter 292 cable / 296 termination; dynamic attribute columns match the stored
  definitions in order; "ALUMINIUM" -> 239 canonical rows, "Aluminium" -> 0 (canonical + case-sensitive).
  **"106.04" -> 10 rows, NOT 3:** DB ground truth confirms 10 termination rows carry `lug_list=106.04`
  (source rows 97,107,117,127,137,197,207,217,228,238), the three CLEANED rows (117/217/228) a SUBSET --
  106.04 is a shared band value, the search is correct, and RM-1 only ever asserted the 3 cleaned rows
  STORE 106.04 (never that only 3 do). **Owner ruled Accept: search correct, commit.**
- **V3** COPPER/UNARMOURED/1C/6.0 -> cable 120/20, termination 80/20, BCS 87; each step shows explain +
  params + running value.
- **V4** COPPER/ARMOURED/3C/2.5 -> 200/28; the multiplier step DISPLAYS "insulation = ARMOURED ->
  discount 0.75, markup 0.35"; toggling to UNARMOURED changes it to "discount 0.57, markup 0.4".
- **V5** COPPER/ARMOURED/3C/50.0 -> termination 940/240 with the gland step showing
  "thickness_sqmm 50 >= 35 -> gland_band2_list".
- **V6** COPPER/ARMOURED/3C/0.5 (no master row) -> every pipeline states no-match, zero computed values.
- **V7** rate-master DB IDENTICAL before/after the whole cert: 588 active, batch rmbulk-c57cfe18194e,
  config 1 (read-only proven).
- **V8** the electrical-pricing workbook page still loads fully (Luckysheet editor intact); the ONE
  console error is the pre-existing dev-server artifact `frappe.boot = {{ boot }}` in index.html
  (a Jinja placeholder only templated on :8000; identical `:32:19` on EVERY route incl. rate-master) --
  NOT introduced by RM-2.
- **V9** git clean apart from the pre-declared standing noise + the in-scope RM-2 files.

### Files
NEW `frontend/src/pages/pricing/rate-master/` (rateMasterTypes.ts, ratePipelineInterpreter.ts +
`.test.ts`, rateMasterRegistry.ts, RateMasterDataViewer.tsx, RateMasterDerivation.tsx, RateMasterPage.tsx).
Edited `routesConfig.tsx` (one route) + `NewSidebar.tsx` (the four registry-driven touches). Docs: this
entry + `frontend/CLAUDE.md`. Out of scope (untouched): all backend .py, the pricing editor + U1 chassis,
existing pricing workbook pages, patches.txt, .claude/settings.local.json.

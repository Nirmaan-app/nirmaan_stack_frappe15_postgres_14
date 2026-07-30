<!-- Carved from frontend/CLAUDE.md on 2026-07-30 (structural carve).
     frontend/CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Working on the HVAC / Electrical / ELV pricing module -- workbooks, rate resolution, checkout, baselines -->

### Pricing Module (HVAC / Electrical / ELV Pricing) -- Frontend Conventions

Standalone estimation-pricing pages (SEPARATE from the BoQ wizard/pricing editor). Lives in
`src/pages/pricing/` (`PricingWorkbookPage.tsx` + `pricingWorkbooks.ts` + local `pricingLibs.ts`). Live
status / decisions: `frontend/.claude/plans/pricing-module-plan.md`.

- **`pricingWorkbooks.ts` is THE single source of truth (PW-1).** One `PRICING_WORKBOOKS` registry entry per
  workbook page (`{ path, title, label }`) feeds all three consumers: the generic page (identity), the route
  entries in `routesConfig.tsx` (paths), and the sidebar spread in `NewSidebar.tsx` (keys + labels). Adding a
  workbook page = one registry entry + one route object + nothing else in the sidebar (its four touches are
  registry-driven: the role-gated item spread, `allKeys`, `groupMappings`, and the flat-label discriminator Set).
  Two rules are load-bearing: (1) **`title` must match the Pricing Workbook doctype's unique `title` exactly** —
  it is both the selection key and the import title; (2) **`path` must stay a SINGLE top-level segment**, because
  the sidebar's active-item matching is single-segment (`pathname.slice(1).split("/")[0]`, then
  `` `/${selectedKeys}` === subitem.key ``) — a nested `/pricing/hvac` would never highlight.
- **ONE generic page, one route object PER workbook (PW-1) — do NOT collapse them into `/pricing/:key`.**
  `PricingWorkbookPage` resolves its own entry from `useLocation().pathname` via `workbookForPath`; an
  unregistered path renders a visible "Unknown pricing workbook" state, never a blank page. Separate route
  objects are deliberate: they guarantee a real UNMOUNT on workbook switch, which is what destroys the
  Luckysheet **global singleton** and fires the `releaseBeacon` that frees the server-side checkout lock. A
  single param route reuses the element (no remount) and would strand the lock for 30 min — live-verified in
  PW-1: switching away mid-edit left `checked_out_by` NULL with zero stale sheet content.
- **Selection is BY TITLE, never by list position (PW-1).** `list_workbooks` is unfiltered and ordered
  `modified desc`, so the old `rows[0]` pick silently changed which workbook opened as people saved. Select with
  `rows.find(r => r.title === entry.title)`. Likewise the empty state is **per-title** (`!match`), NOT
  "zero workbooks in the system" (`!rows.length`) — the latter made Import unreachable for every page once any
  one workbook existed, so workbooks #2/#3 could not be created through the product at all. Import creates with
  `entry.title`, giving each page an independent empty → import → ready lifecycle.
- **Import + save pipeline (FR-1 -> FR-6), in order.** Import: `decodeSheetNames` (LuckyExcel escapes sheet
  NAMES but not formula text) -> `normalizeFormulas`. Save: `reenterNormalizedFormulas` (push corrected
  formulas back through the engine so it recomputes a real value — **pass the plain STRING**; the object form
  `setCellValue(r,c,{f:"..."})` silently leaves the cell empty) -> `serializeSheets` (compaction + a final
  normalize guard that drops stale `v`/`m` on any cell it still has to fix). Transport for BOTH
  `create_workbook` and `save_workbook` is **gzip + `multipart/form-data`** (file field `workbook_json_gz`);
  the nested-JSON body is GONE, there is no fallback. Rationale: nesting the workbook as a JSON string escaped
  every quote (1.23x -> 25.91 MB) and 413'd against the 25 MiB `max_file_size`; gzip is ~0.7 MB.
- **Dropdowns are re-attached at import (DV-2), because LuckyExcel DROPS every `<dataValidation>`.**
  `pricingValidations.ts` re-reads the same .xlsx with the **vendored `window.JSZip` global** (never an npm
  import — that would bundle it), parses `<dataValidation>` **and the `x14:` extLst variant**, and attaches
  `sheet.dataVerification`. Schema: a flat map **`"<row>_<col>" -> record`, 0-indexed, PER CELL** — a
  multi-cell `sqref` expands to one record each. `value1` is polymorphic: a range reference (cross-sheet
  works, including quoted names with spaces and `&`) or a literal comma list. Range sources are **clamped to
  the source sheet's data extent +5** — the engine re-walks the whole range on every dropdown open, so an
  unclamped 50k-row source is 50k iterations per click. Runs AFTER `decodeSheetNames` (matching uses decoded
  names) and never blocks an import. `serializeSheets` keeps the key, so dropdowns survive round-trips.
  **`prohibitInput` is false everywhere (advisory red-flag, owner-vetoable) — and NOTE: validation only
  guards TYPING; programmatic writes bypass it entirely, so a dropdown is a convenience, not a constraint.**
- **ENGINE CAUTIONS (owner-locked, both proven by minimal repro).** (1) **Never emit `INDEX` in composition** —
  `=INDEX(r,2)` is fine but `=INDEX(r,2)*2` returns **0**; use `VLOOKUP` against a key-first helper pair.
  (2) **Never leave `<operator><space>(`** — even `=2 * (1+2)` yields `#NAME?` for the whole cell; a space
  BEFORE the operator is harmless. `normalizeFormulaText` strips it quote-aware (string literals untouched).
  (3) The engine **never evaluates formulas at load** — it renders the cached value, which is why save-time
  re-entry (not just text fixing) is required.
- **Browser-measurement guard:** assert `document.visibilityState === "visible"` before any timing or render
  measurement. Hidden tabs suspend `requestAnimationFrame` (Luckysheet never paints) and throttle timers to
  ~1/min — this manufactured a convincing but entirely false "render hang" that cost two slices.
- **Vendored engine, script-injected — NOT bundled.** Luckysheet / LuckyExcel / JSZip are vendored under
  `nirmaan_stack/public/pricing_libs/` and served at `/assets/nirmaan_stack/pricing_libs/`. `pricingLibs.ts`
  injects the CSS `<link>`s + `<script>`s at runtime in dependency order (plugin.js before luckysheet.umd.js;
  jszip before luckyexcel) and reads `window.luckysheet` / `window.LuckyExcel`. **Never `import` these packages**
  (that would bundle ~3 MB into the app chunk); keep them out of the import graph.
- **Lazy `Component` export (M1.59)** — the page module ends with `export { PricingWorkbookPage as Component }`.
  All three route entries lazy-import the SAME module, so they share one ~10 KB chunk.
- **Sheet init is POST-MOUNT, never synchronous (PM-3):** `luckysheet.create` must run only after the container
  div is mounted. Every create path (load / import / edit / release) calls `requestSheet(sheets, allowEdit)` (a
  nonce-bumped state request); a `useEffect` keyed on `status === "ready" && renderReq` performs the actual
  `initSheet`. NEVER call `luckysheet.create` synchronously inside an async callback — the container is rendered
  only in the non-empty branch, so a pre-`"ready"` create hits a null container (`getElementById → null →
  addEventListener` crash). Re-init (not a live toggle) is how `allowEdit` changes — `destroy()` then `create`.
- **Toolbar always on (PM-3):** `showtoolbar: true` unconditionally; `showinfobar: false`; other bars default.
  Edit-only actions stay gated by `allowEdit`, NOT by hiding the toolbar.
- **Checkout-lock flow + honest banner (PM-3):** page loads READ-ONLY; "Edit" → `checkout` → re-init with
  `allowEdit:true` + Save/Release. On a checkout FAILURE, re-fetch the true lock state: show "Locked by <holder>
  — read only (since <t> IST)" ONLY when `checked_out_by` is non-null AND ≠ current session user AND not expired;
  otherwise surface the REAL error and keep Edit available (retryable). NEVER show an "another user" fallback on a
  null holder (that phantom-lock bug is DIAG-3). unmount + `beforeunload` best-effort `release` (fetch `keepalive`
  with the CSRF header).
- **Save posts the COMPACT form via `serializeSheets(getAllSheets())` (PM-5) — the single source for the save
  shape.** `serializeSheets` (in `pricingLibs.ts`) strips the rebuilt/runtime keys (`data`, `visibledatarow`,
  `visibledatacolumn`, `jfgird_select_save`, `luckysheet_selection_range`) and keeps `celldata` + `config` +
  `calcChain` + display settings. The raw `getAllSheets()` is ~26 MB (Luckysheet rebuilds `data` for every sheet
  at load); compacting → ~14 MB so it POSTs. LOSSLESS — the engine rebuilds `data` from `celldata` on load; this
  is the same celldata-only canonical shape already stored. Any new save-shaped path MUST go through
  `serializeSheets`.
- **Save uses a raw `fetch`, NOT the SDK (PM-6, large-body precedent).** `handleSave` POSTs the compacted body via
  same-origin `fetch` to `/api/method/…save_workbook` (session cookie + `X-Frappe-CSRF-Token` from
  `window.frappe`/`window.csrf_token`), mirroring the `releaseBeacon` + wizard multipart-upload precedent — the
  SDK/axios path stalled intermittently through the Vite dev proxy on the ~18 MB body, while `fetch` completes in
  ~1.6 s (live-verified: 3 button saves + revert, all 200, no hang). Failure parses `_server_messages` for the
  real message and keeps lock + Edit state. **Everything else (checkout/release/get/list) stays on the SDK** —
  small bodies, no reason to change. Watermark opacity is **0.22** (PM-6, darker; still `#D03B45`).
- **Watermark** = pointer-events-none data-URI-SVG overlay in the **Nirmaan brand red `#D03B45`** (full name +
  email, tiled ~30°, font 21/weight 600, opacity 0.22 per PM-6) in BOTH read-only and edit modes; must never
  block sheet interaction. Keyed on the USER, not the workbook — it needs no per-workbook parametrization. It
  is a **React SIBLING** of the engine mount (both `absolute inset-0` inside one `relative flex-1`) — NEVER
  reparent `#pricing-workbook-luckysheet` or the watermark strands.
- **Dropdown height cap (`pricing.css`, imported once by `PricingWorkbookPage`):** a bare-ID rule
  `#luckysheet-dataVerification-dropdown-List { max-height: 300px; overflow-y: auto; }` makes long
  range-sourced data-validation dropdowns scroll INTERNALLY instead of rendering at full content height
  (unscrollable + JS-placed off-screen). Capping the height also fixes placement (the engine measures the
  capped element). Short lists are unaffected (natural height, no scrollbar). Bare-ID specificity wins over the
  vendored script-injected styles — no `!important` needed. Accepted residual: a list opened low in the
  viewport can overhang the bottom edge but stays scrollable.
- **Dropdown type-to-search (PW-DS) is an APP-LEVEL DOM augmentation (`pricingDropdownSearch.ts`), never a
  vendored change.** `installDropdownSearch()` (one `useEffect([])` in `PricingWorkbookPage`) runs a
  `document.body` `MutationObserver` that, on each dropdown open, prepends a filter `<input>` into
  `#luckysheet-dataVerification-dropdown-List`. **The input MUST carry `luckysheet-mousedown-cancel`** — without
  it the engine's global mousedown handler dismisses the popup and steals focus (recon-proven). Selection stays
  the engine's own document-delegated `.dropdown-List-item` click (filtering only toggles `display`); the module
  owns arrow/Enter/Escape nav since the engine has none. Pure `filterOptions` / `nextVisibleIndex` are
  unit-tested. NEVER move this into the vendored `pricing_libs`.
- **Full-screen (PW-FS) = root-className FLIP, NOT the native Fullscreen API, NOT a portal.** An `expanded`
  `useState` swaps the page root between `flex flex-col h-[calc(100vh-100px)]` and
  `fixed inset-0 z-50 flex flex-col bg-background` (pure `pricingRootClass`) — ONE JSX tree, nothing remounts
  (engine / lock / sandbox / watermark survive). Native API is BANNED (the Radix save/import dialogs portal to
  `document.body` at `z-50` and would be hidden behind a fullscreened node; against a `z-50` overlay DOM-order
  puts them on top). **`window.luckysheet.resize()` MUST fire on BOTH enter and exit** (a `useEffect([expanded])`
  rAF, guarded on the sheet-inited ref) — the engine's own window-resize listener does not fire on a
  container-only change. Esc-exit uses the pure co-located `shouldExitPricingFullscreenOnEsc` (bare Esc; false
  on `defaultPrevented`; false on INPUT/TEXTAREA) — do NOT import the wizard's twin (the module stays
  standalone). NOTE: Luckysheet `stopPropagation`s Escape at its grid, so Esc exits only when focus is OUTSIDE
  the grid; the toggle button is the universal exit.
- **Access strings (PM-1 DB-verified, profile side):** `PricingRoute` guard + the sidebar spread both gate on
  Administrator OR role_profile `Nirmaan Admin Profile` / `Nirmaan Estimates Executive Profile`. The backend
  (`api/pricing/workbook.py`) also accepts the `Nirmaan Estimates Executive` Role and is the real enforcement
  layer — keep the guard/sidebar strings in sync with each other, not necessarily with the backend Role set.
- **Action-bar role gating (PW-2a).** ONE derived flag drives the whole bar:
  `isPricingAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile"`, with `role` destructured
  off the EXISTING `useUserData()` call (no new fetch — `PricingRoute` already warmed that SWR key). Admins get
  Edit / Save / Release / Import / **Replace from Excel**; estimation users get **Sandbox only** and never see
  a write affordance (the empty-state Import is admin-gated too). **Gate the bar on
  `roleResolved = role !== "Loading"`** — `useUserData` returns the literal `"Loading"` while the
  `Nirmaan Users` doc is in flight, and without the gate an admin flashes the estimation bar. Client gating is
  **UX only**; the backend write gate (`_require_pricing_write_access`) is the boundary, and `PricingRoute`
  stays wide so estimation users still reach the module.
- **Sandbox pattern (PW-2a): editability WITHOUT a lock.** `requestSheet(sheets, true)` with **no** `checkout`
  call; persistent amber banner + Exit Sandbox, which RE-FETCHES from the server (the engine may mutate the
  array it was created with, so a cached array is not a trustworthy pristine snapshot). Three things keep it
  from ever writing, and all three must be preserved: (1) `releaseBeacon` hard-guards on `lockMineRef.current`,
  which only `handleEdit` sets — **do NOT replace that guard with a `sandbox` condition**, the ref is the single
  truth for "do I hold the lock"; (2) Save/Release render only under `lock === "mine"`; (3) **NEVER pass
  `allowUpdate: true` to `luckysheet.create`** (engine default is false) — with it on, the engine POSTs its own
  deltas to `updateUrl` autonomously, outside the lock, outside `save_workbook`, and outside the Sandbox
  guarantee. The engine binds no Ctrl+S and has no toolbar save item; the Save button is the ONLY save surface.
- **Replace-from-Excel is a SAVE, not a create.** Admin + lock held. Reuses the full `runImportPipeline`
  (shared with the empty-state import), confirms first, re-`checkout`s to refresh the 30-min lock before the
  POST (idempotent for the holder; a long .xlsx conversion can otherwise blow the window), then posts
  `save_workbook` with `{name}`. **Never `create_workbook`** — `Pricing Workbook.title` is `unique: 1`, and
  save preserves the prior content as a version snapshot for free. Payload shape is identical between the two
  endpoints; only the text field differs.
- **Import pipeline stage order is AUTHORITATIVE (PW-2b-i) — every position is load-bearing:**
  `decodeSheetNames -> clampRowBloat -> normalizeFormulas -> runFormulaStage (freeze -> transform ->
  materializeHelpers) -> attachDataValidations`. decode FIRST (LuckyExcel escapes sheet NAMES, not
  formula text). **clamp SECOND is a PERFORMANCE PRECONDITION**, not tidiness — raw ELV converts to
  1,819,874 cells of which 98.8% are style-only filler and every later stage walks celldata.
  normalize before the parser. **DV LAST and after the clamp** — `clampRangeSource` clamps a dropdown
  source to the sheet extent +5, so running it on the bloated grid clamps to ~50,503 instead of ~30
  and reinstates the per-dropdown cost DV-2 removed. `runImportPipeline` returns `{sheets, report}`.
- **Formula transforms are AST-based (`pricingFormulaAst.ts` + `pricingTransforms.ts`), never regex.**
  Transforms COMPOSE inside one cell (an IFS whose branches are each a multi-condition array
  INDEX/MATCH; a LET wrapping another), so one bottom-up `mapNode` pass is what makes composition
  safe — and it is why LET inlining does not duplicate an expensive lookup. **Abstain is a
  first-class outcome**: anything not understood is left UNTOUCHED and reported; the parser never
  throws into the pipeline. ⚠️ **Array formulas carry NO marker after conversion** (no `t:"array"`,
  no braces) — detect BY SHAPE (`MATCH(1,(a=x)*(b=y),0)`).
- **ENGINE CAUTIONS #3-#5 (PW-2b-i, all found only by live Tier-3, all invisible to a green suite):**
  **(3)** a boolean literal poisons the cell — `,FALSE)` returns `#NAME?`, so every generated VLOOKUP
  emits `,0)`. **(4)** **LuckyExcel emits numeric cell values as UNTYPED STRINGS** (`{v:"1.0"}` with
  no `ct.t === "n"`) which the engine normalizes to `1` on load — **never trust `ct.t` on converted
  (pre-load) celldata**; canonicalize by SHAPE (`NUMERIC_LIKE`), which is what keeps helper keys
  matching the engine's runtime key. **(5)** **the engine evaluates ALL IF branches and propagates any
  branch's error** — it does not short-circuit — so generated lookups inside IF/IFS branches are
  wrapped in `IFERROR`; standalone lookups stay bare and honest. ⚠️ **The fallback token must not be
  error-spelled**: the engine coerces the literal `"#N/A"` back into the #N/A error
  (`ISTEXT("#N/A")` is `false`), re-poisoning the very IF the wrap protects. The token is `"n/a"`
  (`ISTEXT` true, survives concatenation, still reads as a miss).
- **Helper columns follow the FIXED workbooks' own convention:** `_mk` marker in the header row, key
  `=A2&"|"&B2`, value mirroring the result column, pair allocated at `maxCol + 2`, hidden via
  `config.colhidden`. **Each helper cell carries `f` AND a pipeline-computed `v`** — the engine never
  evaluates at load (FR-6), so a bare formula reads blank and every lookup returns `#N/A`. A source
  cell that is itself an unevaluated formula yields an EMPTY key for that row, never a partial key
  that could match the wrong record. `_mk` is also the IDEMPOTENCY marker (snapshot which sheets have
  it BEFORE writing, or the first pair you write hides every later pair on that sheet).
- **Criterion-range harmonization (owner-directed):** when the criterion + result ranges share a start
  row and a strict MAJORITY span, an outlier whose END differs by <= `MAX_HARMONIZE_ROWS` (2) is
  pulled onto the consensus and reported as class `harmonized`. A tie, a differing start row, or a
  larger gap still abstains — those bounds are what keep it a typo-fixer rather than a guesser.
- ⚠️ **Testing lesson (PW-2b-i):** the Tier-1 tests assert the emitted formula TEXT, which is correct,
  and they structurally **cannot** see that the engine mis-reads that text at runtime. Cautions 3, 4
  and 5 were all invisible to a fully green suite. **Anything about engine SEMANTICS must be proven
  in a live Tier-3 run.**
- **Consent-based live fix (`pricingLiveFix.ts`, PW-2b-ii + PW-2d).** `[Fix]` eligibility is DERIVED, not a
  hand-kept class list: `assessFix` runs the hit through `transformFormula`; a **helper-FREE** rewrite
  (`helpers.length === 0`, or a dead-Google `freeze`) is fixed in the LIVE engine; a **helper-CLASS** rewrite
  (multi-cond INDEX/MATCH) is fixed OFFLINE at save (below). Live writes mirror FR-6 (`setCellValue` with the
  plain STRING) and go through **`withSheetActive`** — activate the hit's sheet, write, restore the prior active
  sheet. ⚠️ **ENGINE CAUTION #6 (owner-locked):** `setCellValue` on a NON-active sheet CORRUPTS it — a bulk write
  rebuilds that sheet's cell store from an incomplete grid and DROPS every unrendered row (proven: a live
  Termination table went 154 rows → 0 and the save persisted the gutted sheet). NEVER write a non-active sheet;
  `withSheetActive` is the guard (`setSheetActive` is synchronous — no render-await). The import report is a
  receipt (`ImportReportDialog.tsx`), `lastReport` session-only. ⚠️ **Backend `_prune_versions` deletes via raw
  `frappe.db.delete`, NOT `delete_doc`** — a list-shaped version doc otherwise trips the list-valued-JSON load
  wall on the 21st save; every save-shaped path on an array-`workbook_json` doc avoids `doc.save()`/`delete_doc`.
- **Save-time helper-class fix + single-action dialog (`pricingLiveFix.ts` / `pricingHitEval.ts`, PW-2d — Option 3).**
  The advisory dialog is Cancel + ONE primary action: **"Fix all & save"** when any hit is fixable (helper-free AND
  helper-class ride the same click), **"Save anyway"** when hits exist but none fixable, **"Save"** at zero hits;
  each row shows **"will be fixed"** / **"no automatic fix — saved as-is"** (`isAutoFixable` = helper-free OR
  `REASON_NEEDS_HELPER`). Helper-class hits are fixed **OFFLINE on the serialized payload** — `materializeHelpers({force:true})`
  writes the pairs into `celldata` with computed values + `config.colhidden`, each hit gets its rewritten VLOOKUP,
  then ONE save, then `requestSheet(fixedSheets,true)` re-inits so `create()` renders the stored values. **NEVER via
  live `setCellValue` on the (usually non-active) table sheet (CAUTION #6), and NEVER `refreshFormula()` — ⚠️ ENGINE
  CAUTION #7:** a global recompute force-evaluates every formula and cascades `#NAME?` (the engine renders Excel's
  cached values on load, FR-6), and a `setCellValue` re-entry of the rewritten hit THROWS (it rejects a VLOOKUP whose
  key is a `&`-concatenation). **FIXED-CELL DISPLAY (owner call):** `pricingHitEval.computeHitValueExact` stores the
  hit's value **only where it resolves EXACTLY** against the just-built helpers (VLOOKUP dict lookup, resolvable refs,
  `& + - * /`, `ROUND*` with integer digits) — anything else (IF/IFS/IFERROR/branch, unknown fn, missing ref, VLOOKUP
  miss) leaves the cell BLANK (recomputes on the next edit). **Stored `f` always correct; `v` exact-or-absent — NEVER
  an approximation** (a wrong cached `v` would display wrong until a recalc). The report labels each row **"value
  computed"** vs **"blank until recalc"**; `canonicalizeCellValue` (pricingHelpers) is the SINGLE source for the
  criterion/key canonicalization so an offline VLOOKUP key matches the materialized helper key by construction.
- **Save-time formula advisory (`pricingFormulaScan.ts`, PW-2a) is WARN-ONLY and PURE.** Scans
  `sheets[].celldata[].v.f` **after `serializeSheets`** so it sees exactly what will be persisted. Flags INDEX
  anywhere (ENGINE CAUTION #1 — `=INDEX(r,2)*2` silently returns 0), the engine-absent `XLOOKUP`/`IFS`/`LET`,
  and any name outside `window.luckysheet_function` (a plain object keyed by UPPERCASE name, 371 entries;
  `supportedFunctionsFromEngine` returns null when it is missing/implausible and the unknown-name rule is then
  **skipped — fail-OPEN**, never warn-on-everything). Detection strips BOTH `"..."` literals and `'...'`
  sheet-name references before matching `identifier(`, so `="INDEX of items"` and a sheet named
  `'Sheet (old)'` are not flagged. `handleSaveClick` scans then opens the dialog; `performSave` posts the
  ALREADY-SCANNED sheets so Continue never re-runs the 400 ms re-entry pass. Keep the module side-effect free —
  PW-2b's consent-based fixing is meant to be a caller change, not a rewrite.

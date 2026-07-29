## Restructure surface (Slice 1)

The restructure surface lets a reviewer re-parent a row by FINDING the target row in the
source sheet and selecting + saving a new placement. Built in slices:
**1a** = the searchable sheet-view component (FIND + SHOW only, certified via a throwaway
dev route); **1b-alpha** = the BACKEND (transactional reclassify+reparent endpoint + the
human-root encoding) -- DONE; **1b-beta** = the restructure MODAL that mounts 1a, adds
selection, consumes the 1b-alpha endpoint, and REMOVES the dev route -- DONE (feat e8eeab58).
The restructure-surface arc is now COMPLETE pending live-cert.

### Slice 1b-beta -- the restructure modal (feat e8eeab58, 2026-06-09)

**Scope:** FRONTEND only. The consumer of the live-certified `save_review_restructure` backend
(1b-alpha). Adds the reclassify-and-place-children surface to the review screen and removes the
temporary Slice 1a dev route as the final act. No backend file touched; no Frappe unit tests
(UI slice). In-container tsc 0 errors in touched wizard files (project-wide pre-existing baseline
3177 unchanged before/after); in-container foreground build exit 0. Manual live-cert LC1-12 pending Nitesh.

**Files:** `RestructureModal.tsx` (NEW); `ReviewTree.tsx` (pill DropdownMenu trigger + childless
light path + `onRestructured` prop + modal mount); `SheetReviewPage.tsx` (`onRestructured={handleSaved}`);
`routesConfig.tsx` (dev route removed) + `_DevSheetSearchHarness.tsx` (deleted). `SheetSearchView.tsx`
byte-for-byte untouched; `boqTypes.ts` untouched (the `save_review_restructure` response type is
defined LOCALLY in the modal + ReviewTree).

**1. Trigger chain.** In the row-detail panel the Classification line gains a "Change ▾" pill-styled
`DropdownMenu` of the 4 ASSIGNABLE targets (`line_item`/`preamble`/`note`/`spacer`; subtotal_marker/
header_repeat never offered). `onPickClass` counts children (`rows.filter(r => r.effective_parent_index
=== row.row_index)`): childless -> a light `AlertDialog` ("Change classification"; `save_review_restructure`
with `child_moves: {}`; plain Button so the dialog stays open + shows an inline error on a backend throw);
has-children -> the staged `RestructureModal`.

**2. The five child-placement options (no silent default).** (1) move children UP to this row's current
parent (null/<0 -> -1); (2) keep children UNDER this row (`child_moves: {}`), OFFERED only when the new
class is parent-capable (line_item/preamble), disabled with a reason for note/spacer; (3) move all to ONE
new parent (picker); (4) decide EACH child individually (per-child picker; each a picked row_index or -1);
(5) make all children top-level (-1 each). Save gated: 1/2/5 complete on selection, 3 needs the parent
picked, 4 needs every child resolved.

**3. child_moves assembly (Path A) + atomic save.** `buildChildMoves()` -> `{child_row_index:
new_parent_index}` (-1 = top-level). ONE `save_review_restructure(boq_name, sheet_name [VERBATIM #152],
row_index, new_classification, child_moves, reason?)`. The object passes directly to `useFrappePostCall`
(SDK serializes; backend accepts a dict). Success -> `onRestructured(edited_at)`; Cancel/close/Escape
writes nothing; a backend `frappe.throw` (e.g. batch cycle) surfaces inline, modal STAYS OPEN.

**4. Parent picker -- mounts the certified SheetSearchView untouched.** Consumed via its existing
`onCurrentHitChange`; the modal renders its OWN "Set as parent" button. **row_number -> row_index
resolution:** a `SheetPreviewRow` carries only the Excel `row_number`; resolve via `rows.find(r =>
r.source_row_number === hit.row_number)`. **No-match guard:** a hit on a header/banner/blank band row
resolves to no review row -> "Set as parent" DISABLED with a quiet reason. Option 4 children may also be
set top-level (-1) without picking.

**5. Refresh wiring.** ReviewTree gains an OPTIONAL `onRestructured?: (editedAt) => void` (backwards-compat
-- no existing caller breaks). SheetReviewPage wires it to the EXISTING `handleSaved` (setLastSavedAt +
`mutate()`), so the tree reflects the moved children + reclassified row via the SAME SWR revalidate path
the value/text edits use. No fetch/patch inside the modal.

**6. Dev-route removal (gated LAST).** After tsc + build green, the `upload-boq/_dev-sheetview/...` route
was removed from `routesConfig.tsx` and `_DevSheetSearchHarness.tsx` deleted; tsc + build re-run green
(precache 168 -> 166 entries, harness chunk gone).

**Deferred (NOT built):** batch "apply all edits at once", drag-to-reparent, fuzzy search.

**OWED next:** ~~single-pass full-sheet-read endpoint~~ LANDED (`get_sheet_preview_full`, feat 196ed765;
WIRED by SheetSearchView v2, feat fc7147db). ~~row-self-reparent~~ LANDED (Slice 1b-beta2, feat 1ed9d3b7
-- see the block at the top of this plan). ~~childless-row reposition~~ LANDED (Slice 1b-beta2b, feat
20e1f5a7 -- the childless reclassify path now offers Keep/Move; "Move" routes into RestructureModal, which
adapts for zero children; finding-9 CLOSED). Still OWED: C-values rate-editing live-cert against a
Pattern-2-rate vehicle. NOTE: a PURELY standalone reparent (change a row's parent WITHOUT reclassifying it
-- the locked design's standalone "Change parent" mock, :236) remains a distinct, not-yet-built surface;
1b-beta2b reaches the childless row-move only as part of a reclassify.

### Layout Part A -- RestructureModal sizing + child-list wrap (feat 51b3412e, 2026-06-10)

**Scope:** FRONTEND, cosmetic display-only follow-up to 1b-beta. ONLY `RestructureModal.tsx` touched
(3-line diff). No state/handler/save-path/option-logic change; SheetSearchView NOT touched; dialog.tsx
primitive NOT touched. In-container tsc 0 errors in RestructureModal.tsx; in-container foreground build
exit 0. Manual MA1-4 pending Nitesh.

**The two changes.** (C1) `DialogContent` widened `max-w-3xl` -> `max-w-6xl` (keeps `w-full` +
`max-h-[90vh] overflow-y-auto`). `w-full` stays from the primitive default, so the `max-w-*` ceiling is
the lever; `max-w-6xl` (~1152px) is a balanced, viewport-safe cap that gives the mounted SheetSearchView
parent picker real room without going absurdly wide on large monitors (`max-w-[90vw]` was the alternative,
rejected for over-wideness on big screens). (C2) the two children-list texts -- the "Children (N)" summary
`<li>` and the option-4 per-child `<span>` -- switch from single-line `truncate` to `whitespace-normal
break-words`, so a long child note WRAPS instead of clipping. The reclassified-row description line
(`font-medium`, no truncate) was already wrap-capable and was left as-is (judgment: a title line where
one line reads fine; wrapping it changes nothing).

**STILL OWED -- the picker-grid column fix (a SEPARATE slice).** SheetSearchView's cells hardcode
per-column `min-w-[120px]` + `truncate` (no-wrap), uniform across columns incl. Description, with no
sizing prop to influence from outside. Fixing the grid's column widths + cell wrap REQUIRES editing the
1a LIVE-CERTIFIED `SheetSearchView` (cell classes at its TableHead/TableCell + a Description-vs-others
width branch), which re-opens its 1a display/search certification. Deliberately split out per the
slice-composition framework, to be paired with click-to-select. Layout Part A widens the modal so the
grid has more room NOW, but the grid's own columns still clip until that slice lands.

### Slice 1b-alpha -- transactional restructure backend + human-root (feat f7761415, 2026-06-09)

**Scope:** PURE BACKEND (+ a minimal frontend type/reader touch). No modal, no selection UI --
that is 1b-beta. test_review_screen 110 -> 124, all green.

**1. Shared write helper `_apply_and_save_row_edit` (review_screen.py).** The certified
field-application block of `save_review_edit` (apply one field-change to a loaded doc + append
edit_log + stamp provenance + re-serialize list-JSON siblings) was extracted verbatim into a
module-level helper that ALSO calls `doc.save()` but does NOT commit. **Save-inside /
commit-outside is the atomicity boundary:** under one request transaction, N per-row saves all
roll back if a later row throws; the caller's single trailing `frappe.db.commit()` makes a batch
all-or-nothing. `save_review_edit` was refactored to call it -- behaviour-preserving: all 110
pre-existing tests pass UNCHANGED. Callers retain ALL per-call validation, the doc LOAD, and the
commit; the helper assumes validated inputs. The helper takes a `set_root: bool` kwarg (below).

**2. `save_review_restructure` endpoint (Path A).** `@frappe.whitelist(methods=["POST"])`. Atomically
reclassifies one row AND reparents its children in ONE commit. `child_moves` is a dict (or JSON
string) `{child_row_index: new_parent_index}`; `-1` = top-level/root. The caller sends a FULLY
RESOLVED plan -- the backend validates + writes, it does NOT compute placement. Validation (all
per-call, BEFORE any write): required args; BOQ + row exist; `new_classification` ASSIGNABLE;
each child exists + is CURRENTLY a child of row_index (effective parent) + proposed parent is -1
or an existing row + not self-parented; **BATCH cycle-guard** -- build the whole-sheet
effective-parent map, apply ALL moves AT ONCE, then `_chain_has_cycle` per touched row against the
COMBINED tree (two individually-acyclic moves can form a cycle together, so they are checked
applied-together, never one at a time). Write: reclassify target via helper (one
human_classification entry, carries `reason`); each child via helper (one human_parent entry,
reason = "parent moved: row {N} reclassified to {cls}"); single commit. Returns
`{ok, row_index, new_classification, children_moved, edited_at}`.

**3. FROM-but-not-TO classification narrowing.** `_ASSIGNABLE_CLASSIFICATIONS = {line_item, preamble,
note, spacer}` is a STRICT SUBSET of `_VALID_CLASSIFICATIONS` (all 6 RowClassification literals).
`subtotal_marker` / `header_repeat` are parser-only DETECTIONS -- valid existing/FROM states + reads
but never assignable as a write TARGET. Applied to BOTH `save_review_restructure` and
`save_review_edit`'s human_classification path (the ONE intentional behaviour change to
save_review_edit; no prior test asserted those as targets, so S2 held -- no existing test changed).

**4. Human-root encoding `human_is_root` (Option B -- the recon's chosen encoding).** The recon found
that `-1` on `human_parent` means "no override -> fall back to parser parent", NOT root, so the
human layer could not express "make this row top-level" without overloading the -1 sentinel. Fix:
a NEW `human_is_root` Check field on BoQ Review Row (default 0), ORTHOGONAL to `human_parent` -- the
-1 sentinel value space (#54) is UNCHANGED. `resolve_effective` consults `human_is_root` FIRST:
truthy -> `effective_parent_index = None` (root), skipping the human_parent_norm/parent_index_norm
derivation; else the existing logic runs verbatim. **Consistency invariant** (root XOR row-override,
never both) is enforced at the SINGLE `_apply_and_save_row_edit` chokepoint via `set_root`:
set_root=True -> human_is_root=1 + human_parent=-1 (case c); value>=0 -> human_parent=value +
human_is_root=0 (case a); value None -> human_parent=-1 + human_is_root=0 (case b). `child_moves`
value -1 calls the helper with set_root=True; the edit_log records `to=None` for a root move (root
reads as "no parent", not the -1 sentinel). `human_is_root` was added to every fetch field-list that
feeds resolve_effective (get_review_rows, get_structural_breaks, mark_sheet_parsed_check_done, both
cycle-guards) + the resolve_effective return dict. **Migration: NONE** -- purely additive; a new Check
defaults to 0, correct for every existing row (none are human-rooted). `bench migrate` confirmed the
column exists (`has_column` True).

**5. Frontend touch (minimal, no modal).** `human_is_root: number | null` added to the `ReviewRow` type
(`boqTypes.ts`). `ReviewTree.tsx` `parentOverridden` now ORs in `row.human_is_root === 1` so a
human-rooted row reads as an override in the detail panel ("row N -> root"). In-container tsc: 0 errors
in the touched wizard files. Everything else (the restructure modal + selection UI consuming
save_review_restructure + dev-route removal) is Slice 1b-beta.

**6. Tests (test_review_screen, 110 -> 124, all green).** New `TestSaveReviewRestructure` group: happy
reclassify+reparent (children to a new parent / to root / to a shared parent / promote to old parent),
childless reclassify, FROM-but-not-TO rejects (subtotal_marker/header_repeat), non-child-in-map reject,
nonexistent-parent reject, the headline BATCH-cycle reject (two individually-acyclic moves -> nothing
written), JSON-string child_moves, the human_is_root invariant (root sets is_root=1 + parent=-1; a later
real-parent move clears is_root to 0; root move logs to=None), and a mixed batch (some children to a real
parent, some to root, in one call). The pre-existing 110 pass unchanged (helper extraction proven
behaviour-preserving).

**OWED to 1b-beta:** the restructure modal (mount SheetSearchView + selection), wiring to
save_review_restructure, removal of the dev route + `_DevSheetSearchHarness.tsx`; plus the still-OWED
1a follow-ups (single-pass full-sheet-read endpoint; fuzzy search remains DEFERRED).

### Slice 1a -- searchable sheet-view component (feat 5ecf1820, 2026-06-08; LIVE-CERTIFIED 2026-06-09)

**Scope:** FRONTEND ONLY. No backend file, no doctype JSON, no `patches/`, no
`review_screen.py` / `sheet_preview.py` change. SheetDataGrid kept byte-for-byte
untouched. No selection / no save / no modal / no restructure endpoint (all 1b).

**What was built:**
- **`frontend/src/pages/boq-wizard/SheetSearchView.tsx`** (new) -- a self-contained,
  searchable, column-trimmed, scroll-to-hit view of ONE sheet's raw cell data. Props
  `{ boqName, sheetName, initialCentreRow?, onCurrentHitChange? }`. `onCurrentHitChange`
  is the non-destructive callback exposed for 1b to consume; wired to nothing that saves.
- **Self-contained fetch (owns its data):**
  1. *Rows* -- `get_sheet_preview` via `useFrappePostCall`. The endpoint hard-caps each
     window at 200 rows (`_PREVIEW_MAX_ROWS`), so on mount the component LOOPS windows of
     200, advancing by `end_row_requested + 1`, until `has_more === false` -- loading the
     ENTIRE sheet up front (decision: search must cover every row, not a 40-row page).
     Progressive "Loading sheet... (N rows loaded)" state; a 500-window safety backstop
     (100k rows) fails loudly rather than looping forever. **Cost note:** the endpoint
     re-fetches the file from S3 + re-opens the workbook PER call, so a ~1,186-row sheet =
     ~6 sequential calls (~tens of seconds). Acceptable for 1a behind the loading state; a
     true batch/full-sheet read endpoint is a possible 1b backend follow-up if it feels slow.
  2. *Role->letter map* -- `useFrappeGetDoc("BOQs", boqName)` -> `draft.sheet_config.column_role_map`
     (same source SheetSpokePage seeds from; handles object|string config + `{role,area}`
     and legacy role-only shapes). Preview cells are keyed by Excel COLUMN LETTER and are
     role-blind; this map supplies which letter is Sl.No / Description / Unit / Qty.
- **Column-trim:** renders ONLY `#` (Excel row) + Sl.No + Description + Unit + EVERY Qty
  column (per-area qty included -- each Qty column shown with its Excel letter and area
  label, e.g. "Qty (Phase 1) (D)"). Rate and Amount columns hidden. **Degraded mode**
  (no `column_role_map`): all columns shown (Excel order), search disabled with an inline
  amber note "Description column not mapped... search is unavailable."
- **Description search + hit stepper:** case-insensitive substring over the Description
  cell across the FULL loaded sheet. Counter "N of M"; prev/next step BOTH directions and
  CYCLE (wrap at both ends); all matches soft-highlighted (yellow), current hit emphasised
  (amber); empty/zero-match -> counter 0, toggles inert.
- **Scroll/centre/highlight:** the ReviewTree pattern PORTED fresh (not imported) --
  `rowRefs = useRef<Map<number, HTMLElement>>` keyed by `row_number` + `<tr>` ref callback;
  on current-hit change (and `initialCentreRow` once on first full-loaded render)
  `scrollIntoView({ behavior:"smooth", block:"center" })` (center clears the sticky header)
  + a transient brighter flash cleared after ~1.2s. The sticky `#` gutter stays
  `bg-background` for horizontal-scroll correctness, so the row tint reads across the data
  cells but not the gutter (known, accepted).
- **Reuse decision:** self-contained trimmed table (shadcn `Table`, sticky header, sticky
  gutter) instead of reusing/extending SheetDataGrid -- the scroll/highlight needs per-row
  DOM access SheetDataGrid does not expose, so reusing would mean adding 3-4 review-specific
  props to a shared component; a focused table keeps SheetDataGrid untouched. `sheet_name`
  used VERBATIM everywhere (no trim) -- trailing-space names exist on BOQ-26-00145 (#152).

**Temporary dev route (live-cert vehicle -- REMOVED in 1b):**
- **`frontend/src/pages/boq-wizard/_DevSheetSearchHarness.tsx`** (new) + one route entry in
  `routesConfig.tsx`: `upload-boq/_dev-sheetview/:boqId/:sheetName`. Both carry the comment
  "TEMPORARY dev harness for Slice 1a live-cert -- REMOVE in Slice 1b". Not linked from any
  real UI. Removal is a named 1b task.
- **Live-cert URLs (BOQ-26-00145, all Parsed, desc column B mapped):**
  clean name -> `/upload-boq/_dev-sheetview/BOQ-26-00145/Fire%20Fitting`;
  trailing-space -> `/upload-boq/_dev-sheetview/BOQ-26-00145/Electrical%20` (and `HVAC%20`).

**Gates (in-container, canonical):** tsc `--noEmit` IN THE CONTAINER -- 0 boq-wizard errors,
0 in `SheetSearchView` / `_DevSheetSearchHarness` / `routesConfig` (the ~3.1k total errors are
the repo's known pre-existing baseline outside wizard scope). Vite production build IN THE
CONTAINER exit 0. No automated tests this slice (UI component, no backend change); parser /
wizard suites deliberately NOT run (agreement #55 -- avoids churning fixture bytes).

**CERT STATUS:** gates green; **LIVE-CERTIFIED 2026-06-09.**
Result: 5/5 checks PASS on BOQ-26-00145 -- columns trimmed (#, Sl.No, Description, Unit, both Qty cols
shown; Rate+Amount hidden), exact-match description search + correct hit counter, cycling prev/next
stepper, scroll-to-hit + highlight, full-sheet load; verified on a clean-name sheet (Fire Fitting,
1001 rows) AND a trailing-space sheet (Electrical , #152).
Two findings logged as deferred/owed:
(a) FUZZY/TYPO-TOLERANT description search -- DEFERRED. Exact matching kept for V1; revisit only if
real use proves exact-match frustrating (risk = false-positive noise on large sheets). A logged
decision, not owed work.
(b) FULL-SHEET LOAD PERF -- ~30s on the 1001-row Fire Fitting sheet because the frontend loops
get_sheet_preview in 200-row windows and the endpoint RE-OPENS the workbook per window. OWED as a
Slice 1b backend follow-up: a single-pass full-sheet-read endpoint to replace the windowed loop.
(Small/medium sheets are already fast.)
  RESOLVED (backend) 2026-06-10, feat 196ed765: `get_sheet_preview_full(boq_name, sheet_name)` built +
  tests-certified (byte-identical to the windowed path; see the get_sheet_preview_full endpoint section
  above). The PERF benefit lands when SheetSearchView v2 wires the new endpoint up (deferred so the
  1a-certified SheetSearchView is re-certified once, bundled with column-widths/wrap + click-to-select).

**Files changed (feat 5ecf1820):**
- `frontend/src/pages/boq-wizard/SheetSearchView.tsx` (new).
- `frontend/src/pages/boq-wizard/_DevSheetSearchHarness.tsx` (new, TEMPORARY -- removed in 1b).
- `frontend/src/components/helpers/routesConfig.tsx` (one throwaway route entry -- removed in 1b).

**NO backend change, NO doctype/schema change.**

---


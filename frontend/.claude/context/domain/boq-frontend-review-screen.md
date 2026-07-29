# BoQ Frontend — Review screen

> ReviewTree live component contract, wizard_status literals and the Finalized config-freeze, review exports, C-flag dismissal, find-&-filter, detail-panel layout, Force Re-parse.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- Review screen (ReviewTree) conventions -- live component contract
- Edit-history render conventions (ReviewTree detail panel; full detail relocated to `boq-upload-plan.md` §"Slice A2")
- wizard_status literals + Finalized config-freeze conventions
- Review export conventions
- Slice D1 Parsed Check Done freeze conventions (`boqTypes.ts` + `SheetReviewPage.tsx` + `ReviewTree.tsx`)
- C-flag-dismissal conventions (per-row "Looks OK" -- `boqTypes.ts` + `ReviewTree.tsx` + `SheetReviewPage.tsx`)
- §9 #159 ReviewTree find-&-filter conventions (FRONTEND ONLY, `ReviewTree.tsx` only)
- ReviewTree detail-panel layout (the live design rule; full per-pass CSS detail relocated to `boq-upload-plan.md`)
- §9 #162 standalone Change-parent door conventions (FRONTEND ONLY, `ReviewTree.tsx` only)
- Force Re-parse FRONTEND slice conventions (two entry points + shared modal + rewritten warning)

---

**Review screen (ReviewTree) conventions -- live component contract** (consolidated from Slices B1 / B1.1a / B1.1b-i/ii/iii / fix-B; full per-slice as-built detail in `boq-upload-plan.md` §"Slice B1...". The pricing editor's `PricingGrid` reuses these via the extracted `reviewRender.tsx` -- see Slice 2):

- **Backend note (2026-06-24 parser fix, plan §17.45 -- BACKEND-ONLY, no frontend code change):** PREAMBLE rows now PRESERVE their source quantity (the parser no longer drops qty when a row is classified or Bug-19-promoted to preamble -- the owner-locked "no source attribute lost during parsing" Option-B fix in `hierarchy.py`/`orchestrator.py`/`review_screen.py`). Two ReviewTree-visible effects: (1) a preamble row can now render a real qty in its value/`qty_total` columns instead of blank/0; (2) ~~the server `priced_preamble_no_children` advisory flag now ALSO fires on a carried quantity~~ **[SUPERSEDED 2026-06-25 review-warnings cleanup: the `priced_preamble_no_children` flag (and `zero_amount_line_item`) were REMOVED from the review screen entirely. Effect (1) STANDS. qty-bearing preambles are now surfaced ONLY by the pricing editor (`priceability.isPriceableLine` → `needs_rate`).]**

- **Review warnings panel advisory flags (2026-06-25 cleanup):** `ReviewTree.tsx` `WARN_FLAG_ORDER` / `WARN_FLAG_LABELS` now carry exactly three flag types: `orphan`, `parser`, and the NEW **`classifier_warning`** ("classifier warning") — the latter surfaces the per-row `classifier_warnings` notes (verbatim, joined by " · " server-side) that were previously shipped but never rendered. The SAME `classifier_warnings` array is also rendered read-only as a "Classifier notes" list in the inline row detail panel (only when non-empty). Removed flags: `zero_amount_line_item`, `priced_preamble_no_children`. The `validation_warnings` ReviewRow type field was deleted (backend field removed). ~~Structural breaks (orphan/line_item_as_parent/cycle) + the orphan warn-and-confirm finalise gate are UNCHANGED.~~ **[SUPERSEDED 2026-06-26 — see next bullet: orphan demoted to advisory; classifier now bulleted; Looks-OK relocated.]**
- **Orphan demotion + warnings-UX polish (2026-06-26):** `orphan` is now a soft amber ADVISORY only — removed from `WARN_BREAK_LABELS` (must-fix = `line_item_as_parent` + `cycle`); it shows in the amber Advisory section and is dismissable, and (backend) no longer triggers the finalise "Structural issues found" dialog. A shared module-level `WarningFlagContent({flags, classifierNotes})` renders a row's advisory content uniformly across ALL THREE surfaces (top panel, in-grid "Show all flags" reveal, detail panel): a `classifier_warning` expands to one BULLET PER note (from the row's `classifier_warnings` array — NOT `flag.reason`), orphan/parser stay one bullet. It uses block-`<span>`s (NOT `<ul>/<li>`) because the panel entries are `<button>`s (list elements are invalid there). `classifierNotes` is threaded onto each `warningRows` entry (the panel has no row lookup in scope). **R2:** MUST-FIX panel entries now ALSO render their amber advisory chips + bullets (a classifier note on a `line_item_as_parent`/`cycle` row is never hidden). **R4:** the detail panel folds the old separate "FLAGS" + "Classifier notes" sections into ONE "Warnings" block (bordered amber card), with the per-row **"Looks OK" button moved to the BOTTOM** (below all warnings, behind a separator) so one click reads as acknowledging the whole block; per-row dismissal semantics unchanged. No backend dependency beyond the orphan-as-advisory contract.
- **Review route:** `/upload-boq/hub/:boqId/review/:sheetName` -- lazy, exports `{ SheetReviewPage as Component }`; same `encodeURIComponent`/auto-decode convention as the config spoke. `onOpenReview?: (sheetName) => void` on SheetCard navigates to it (distinct from `onOpenSpoke`; SheetCard stays router-free). The "Review parsed sheets" hub section shows when `reviewableDrafts.length > 0`.
- **Depth + visibility (the tree walk, in `reviewRender.computeDepths` + ReviewTree `isVisible`):** depth is computed from the `effective_parent_index` chain (memoised, visited-set cycle guard -> cycle members depth 0). **NEVER use the stored `level` field for indentation** -- it is the parser's static value and diverges after `human_parent` edits. `isVisible(row)` walks the parent chain (60-hop cap) starting from `row.effective_parent_index` (the PARENT, not the row), breaking on `cur < 0` (-1 sentinel = root) and `cur === row.row_index` (self-cycle). Net: a collapsed row stays visible; only its descendants hide. Do NOT start the loop at `collapsed.has(row.row_index)` (reintroduces the "parent disappears" bug). `collapsed` is a `Set<number>` of `row_index`. `computeDepths` pre-runs over ALL (unfiltered) rows, so depth is independent of view filters.
- **ColumnDescriptor type (`boqTypes.ts`):** `{col, role, area: string|null, value_field, value_key: string|null, rate_subkey: string|null}` + `GetReviewRowsResponse.column_descriptors`. `resolveDescriptorValue(row, d)` (in `reviewRender.tsx`): dynamic access `(row as unknown as Record<string, unknown>)[d.value_field]` (the `as unknown` intermediate is required for TS2352), walking value_field -> value_key -> rate_subkey, `undefined` at any missing level. `renderDescriptorCell(val)`: null/undefined -> `""`, number -> `fmtNum(val)` incl. `0 -> "0"`. **Absent-vs-zero rule:** a missing key (blank) and a zero ("0") are visually distinct -- never collapse them.
- **ClassificationPill (`reviewRender.tsx` as of Slice 2):** left-bordered pill driven by the Tailwind-class map `CLS_PILL_CLASSES` + label map `CLS_LABELS` (both in `reviewRender.tsx`). The old hex `CLS_COLORS` map no longer exists (superseded by the B2b restyle).
- **Fixed anchor columns vs descriptor columns:** `FIXED_ROLE_DEDUPE = Set(["sl_no","description"])` excludes those roles from the descriptor-driven list; they render as fixed anchors. The fixed-anchor column order is **Excel Row / Sl.No / Parent / Classification / Description**; everything else is a descriptor column (`displayDescriptors`). The **Parent** anchor shows the parent row's `source_row_number` (Excel row number) via `effective_parent_index -> byIdx.get(pIdx)?.source_row_number`; root (null/negative) renders blank; NEVER show the internal `row_index`. The **Classification** anchor holds chevron + ClassificationPill; **Description** holds the text + the depth indent (`paddingLeft = depth * INDENT_PX`).
- **Column-subset selector + classification toggles:** `visibleCols: useState<Set<string>>` (lazy-init all descriptor cols; re-synced via `useEffect([displayDescriptors])`); both `<th>`/`<td>` for a descriptor gate on `visibleCols.has(d.col)`; fixed anchors are never in the selector. Three independent `useState(true)` toggles `showSpacers`/`showNotes`/`showSubtotals` drive `classificationVisible(row)`, composed with `isVisible` as TWO SEPARATE `return null` gates (keep the concerns separate). Children of a toggled-off annotation render at their ORIGINAL computed depth (do NOT re-parent/re-indent).
- **Area column tinting:** `AREA_COLORS` + `buildAreaColorMap` are re-implemented LOCALLY in ReviewTree (verbatim copy of SheetDataGrid's local constants -- do NOT export-refactor SheetDataGrid to share them). Applied to descriptor column HEADERS only.
- **Scroll-to-parent:** `rowRefs = useRef<Map<number, HTMLElement>>` keyed by `row_index` (`<tr>` ref callback set/delete). `revealAndScrollToRow(idx)` walks the ancestor chain, removes collapsed ancestors from `collapsed`, then after `setTimeout(50ms)` (lets React commit the expand) `.scrollIntoView({behavior:"smooth", block:"nearest"})` + sets a transient `highlightedIdx` (amber row tint, cleared after 1500ms).

**Edit-history render conventions (ReviewTree detail panel; full detail relocated to `boq-upload-plan.md` §"Slice A2"):**
the "Edit history" block REUSES the SAME `byIdx` map the Parent column uses to render a `human_parent` entry's
internal-row_index `from`/`to` as `row {source_row_number}` (root for null/negative; raw `String(n)` defensive fallback)
-- never build a second map. A same-value `human_classification` entry (the §9 #162 no-op reclassify that rides with a
real `human_parent` move) is SUPPRESSED before the `.map` (type-guarded filter), not rendered blank. The stored
`edit_log` shape `{field, from, to, by, at, reason[, area][, rate_subkey]}` is unchanged.

**wizard_status literals + Finalized config-freeze conventions** (the rename migration history -- Reviewed->Config Done,
Parsed Check Done->Finalized -- is relocated to `boq-upload-plan.md` §"Slice A1"; the live rules below remain):

- **`wizard_status` is compared `===` against string LITERALS across backend AND frontend** (and is the `STATUS_PILL`
  lookup KEY in `SheetCard.tsx`). Any future status rename must hit EVERY `===` site or a branch silently breaks / the
  pill silently falls back to Pending. Verify with a zero-hit `grep` over the python package + `frontend/src`. **A naive
  quoted grep MISSES the doctype options token** (`\nReviewed`, no surrounding quotes) -- edit `boq_sheet_draft.json`
  options FIRST and read it back. The 9-value union: blank / Pending / Hidden / Config Done / Skip / General specs
  (derived, never stored) / Parse failed / Parsed / Finalized.
- **Finalized config-freeze = `_guard_sheet_not_finalized` (backend, all 5 config writers) + a `<fieldset disabled={isParsing
  || finalized}>` lock (frontend, `finalized = wizardStatus === "Finalized"`).** Reversibility = an "Un-mark and edit"
  TEAL ShieldCheck banner -> confirm `AlertDialog` -> the EXISTING `unmark_sheet_parsed_check_done` endpoint (function
  name unchanged) -> `onSaveSuccess()` re-fetch flips back to "Parsed" + unlocks the fieldset. The AlertDialog renders
  OUTSIDE the fieldset (portals to body). **Banner precedence: parsing amber beats finalized teal.** SheetCard's
  Finalized branch carries an "Edit config" -> `onOpenSpoke` button so the affordance is reachable.

**§9 #164 A3-frontend parse-lock conventions (`boqTypes.ts` + `SheetCard.tsx` + `SheetReviewPage.tsx` + `SheetSpokePage.tsx` + `SheetConfigPanel.tsx` + `BoqHubPage.tsx`):**

The frontend parse-lifecycle lock. Backend floor (per-sheet `parse_in_progress`, double-fire guard, write
guards, `check_parse_status`) is feat 004f80a8; this is FRONTEND ONLY (no backend, no `ReviewTree.tsx` --
its `readOnly` gating already freezes everything).

- **The signal flows for free (THE pattern).** `BoQSheetDraft.parse_in_progress?: 0 | 1` (boqTypes.ts) rides
  the `useFrappeGetDoc("BOQs", boqId)` payload (one-level child table -- Recon #2 Q3), so every surface that
  already fetches the BOQs doc reads it from its EXISTING draft lookup -- no new fetch, no new prop drilling
  from a fetch. `BOQsDoc.parse_in_progress` (BoQ-level) already existed. `parse_job_id`/`parse_enqueued_at`
  are deliberately NOT typed -- the frontend never reads them; `check_parse_status` returns a derived `state`.
- **SheetCard: disable + indicate ONLY the parse-admissible branches.** `isParsing = draft.parse_in_progress
  === 1`. The branches that can be superset-marked mid-parse are Reviewed / Parsed / Parsed Check Done AND
  **Parse failed** (v5.46: Parse-failed is force-re-parse eligible, so the enqueue superset can mark it; the
  worker reconcile clears it if assemble drops it, but the card must reflect the transient mark). Each
  actionable control on those four branches gets `disabled={isSaving || isParsing}` (Edit/Review nav +
  Set-pending + Re-parse + Export CSV); a compact `<Loader2 animate-spin/> Parsing...` amber chip renders by
  the status pill. Pending/Skip/Hidden/General-specs are NEVER parse-marked -> untouched.
- **SheetReviewPage: amber banner BEATS the teal D1 banner.** The existing `boq.sheet_drafts.find(...)` lookup
  now captures the whole draft -> `sheetStatus` + `isParsing = draft?.parse_in_progress === 1`. `readOnly=
  {isChecked || isParsing}` on `ReviewTree` (reuses the entire D1 freeze machinery). An AMBER parsing banner
  (border-amber-300/bg-amber-50 + dark, Loader2 icon, one "Go to hub" button) renders when `isParsing` and
  TAKES PRECEDENCE: the teal "Parsed Check Done" banner is gated to `isChecked && !isParsing` (parsing is the
  transient state worth surfacing first).
- **SheetSpokePage -> SheetConfigPanel: a `<fieldset disabled>` locks the whole panel.** The spoke derives
  `isSheetParsing` from its `:58` draft lookup and passes `isParsing` to SheetConfigPanel. The panel accepts
  `isParsing?: boolean`, renders an amber lock banner, and wraps ALL form content in a native `<fieldset
  disabled={isParsing} className="space-y-5 border-0 p-0 m-0 min-w-0 disabled:opacity-60">` -- native fieldset
  disabling cascades to every descendant shadcn Button/Input/Checkbox + Radix Select trigger (all `<button>`/
  `<input>`), so ONE flag locks Sections 1-4 + Save + Mark-as-reviewed with no per-control edits. Belt-and-
  braces: `dropIfReviewed` early-returns `if (isParsing)` so no programmatic write can fire either.
- **BoqHubPage: one-shot self-heal on mount.** A `useFrappePostCall("...parse_run.check_parse_status")` (the
  wizard's imperative GET-capable form -- NOT `useFrappeGetCall`, to avoid SWR re-fetch loops re-hitting a
  self-healing endpoint) is called once in a `useEffect([boqId])`. On `state === "cleared" | "cleared_stale"`
  -> `void mutate()` so the EXISTING `useEffect([boq])` on-mount recovery re-reads the healed BoQ + per-sheet
  flags. `running`/`idle` -> no action. The call is NON-FATAL by contract: any failure is `console.error`-only;
  the hub renders regardless. The `cancelled` unmount guard mirrors the upload-screen socket pattern.
- **§9 #161 getFrappeError migration (SheetConfigPanel was the lone un-migrated wizard writer).** Import
  `getFrappeError` from `@/utils/frappeErrors` (ReviewTree form). `handleSave` + `handleMarkReviewed`'s outer
  catches -> `setSaveError(getFrappeError(e) || "Save failed. Please try again.")`. The two inner static-string
  catches (work-packages step, status step) -> `${"...failed."} ${getFrappeError(e)} Click ... again.`.trim()
  (catch param changed from bare `catch {` to `catch (e: unknown)`). `dropIfReviewed`'s `callSetStatus` gains a
  `.catch((e) => setSaveError(getFrappeError(e) || "..."))` -- previously swallowed. Net effect: a stale-tab
  mid-parse config write surfaces the REAL backend `frappe.throw` text (from `_server_messages`) instead of the
  SDK's generic "There was an error." `frappeErrors.ts` is CONSUMED, not modified.
- **STALE FILE-IN-SCOPE PATH (recorded).** The build brief listed `frontend/src/types/boqTypes.ts`; the real
  file is `frontend/src/pages/boq-wizard/boqTypes.ts` (all wizard types live in the page folder). The correct
  file was edited + staged.
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|boqTypes` -> only the marker, empty) +
  in-container Vite build exit 0 (`✓ built in 3m 46s`, PWA 168 entries). No Frappe unit tests (frontend-only).
  Manual live-cert pending Nitesh: LC1 mid-parse card buttons disabled + Parsing chip; LC2 spoke locked +
  amber banner + dropIfReviewed inert; LC3 review screen read-only + amber banner (beats teal); LC4 post-parse
  all three unlock via socket->mutate without manual refresh; LC5 stale-tab config save shows the REAL backend
  message (getFrappeError proof); LC6 idle hub loads normally (check_parse_status idle, no side-effects);
  LC7 stuck-flag self-heal on mount -> cleared -> surfaces unlock.

**Review export conventions** (`exportReviewCsv.ts` + `exportReviewXlsx.ts` + `ExportWorkbookDialog.tsx`; consolidated from Slices D2 / D2b -- per-slice build history relocated to `boq-upload-plan.md` / git):

- **Wizard-local writers, NOT the shared util:** `src/pages/boq-wizard/exportReviewCsv.ts` (+ `exportReviewXlsx.ts`) -- the shared `src/utils/exportToCsv.ts` is deliberately NOT used/touched (TanStack-ColumnDef-coupled, wrong shape for the descriptor payload). Any future wizard export extends THESE writers. **Reuse the tree's helpers, never copy** (`resolveDescriptorValue`/`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` from `ReviewTree.tsx`, `ROLE_LABELS` from `boqTypes.ts`) so depth/value-resolution/labels/dedupe stay byte-identical to the rendered tree.
- **`buildReviewSheet` (in exportReviewCsv.ts) is the SHARED core (no csv/xlsx drift):** `{sheetName, rows, columnDescriptors} -> {headers, cells}` with **RAW TYPED cells** (numbers stay JS numbers, text string, empty null). The CSV writer maps cells -> `csvCell` (null->"", number->String); the xlsx writer feeds typed cells straight to exceljs (numbers land as real numbers). When extending the export, change `buildReviewSheet` -- never one writer alone. **Numbers RAW** (`String(val)`, NOT the display formatter -- thousands separators break Excel numeric parsing).
- **`append_notes_raw` is a `dict[str,str]`** keyed `column_headers.get(col_letter, col_letter)` (header text when mapped, else bare Excel letter; classifier.py:983); empty columns OMITTED; values are strings. The writer flattens to `"key: value"` joined `" | "` (flat, no JSON blobs per §8); defensively handles array/string/null.
- **CSV mechanics:** `Papa.unparse`; prepend a UTF-8 BOM so Excel renders rupee/unicode; filename a bare basename + `.csv` ONCE (the shared util's double-extension trap). Export is the sheet's DATA in row_index order, NOT the current view (filters/collapse/search ignored). The "Export CSV" button is NOT gated on status (a frozen/checked sheet is the prime export target).
- **XLSX dependency rule (reusable):** `exceljs` is **DYNAMICALLY imported** (`(await import("exceljs")).default`) so it stays in its OWN lazy chunk (~942 kB), absent from the hub/entry chunks. The npm `xlsx` (SheetJS) is FORBIDDEN (abandoned + 2 unpatched high-severity CVEs). **Install heavy deps IN-CONTAINER** (host installs corrupt the Linux-native node_modules). One worksheet per ticked sheet, header row bold, NO BOM (xlsx needs none). **Tab-name sanitize + dedupe (`sanitizeSheetTabName`/`dedupeTabName`) is TAB-TITLE ONLY** (#152): strip `: \ / ? * [ ]`, TRIM (Excel rejects the trailing-space corpus names as tab titles -- load-bearing), truncate to 31, " (2)"/" (3)" on collision; the Sheet Name COLUMN stays verbatim.
- **Hub vs card:** the global "Export reviewed" hub button -> `ExportWorkbookDialog` (ParseRunDialog pattern: pre-ticked Finalized sheets, sequential per-sheet `get_review_rows` fetch, abort-on-any-failure -> no partial file) -> ONE .xlsx; a per-card "Export CSV" -> the existing `buildAndDownloadReviewCsv` -> a single .csv. The hub owns all fetches; SheetCard stays fetch/router-free.

**Slice D1 Parsed Check Done freeze conventions (`boqTypes.ts` + `SheetReviewPage.tsx` + `ReviewTree.tsx`):**

The read-only freeze + mark/un-mark surface for the review screen. Owner-LOCKED model: a sheet at
"Parsed Check Done" is FULLY FROZEN (no value/text/area edits, no restructure, no remarks, no flag
dismissals); the freeze is enforced BOTH frontend (gated affordances) AND backend (write-endpoint guards --
see root CLAUDE.md). The frontend gating is the UI line of defence; the backend `_guard_sheet_not_frozen`
is the durable backstop.

- **Status derivation from `boq.sheet_drafts` (THE pattern -- no new fetch).** `SheetReviewPage` ALREADY
  fetches the BOQs doc via `useFrappeGetDoc("BOQs", boqId)`. `sheet_drafts` is a ONE-LEVEL child table, so it
  serializes on that payload -- the sheet's `wizard_status` is already in hand. Derive:
  `const sheetStatus = boq?.sheet_drafts?.find(d => d.sheet_name === (sheetName ?? ""))?.wizard_status;`
  (sheetName VERBATIM -- no trim, #152) and `const isChecked = sheetStatus === "Parsed Check Done";`. Do NOT
  add a status fetch. **Destructure `mutate: boqMutate`** from that same `useFrappeGetDoc` and call it after
  every successful mark / un-mark so the banner + button react (the get_review_rows `mutate` is a DIFFERENT
  hook -- mark/un-mark change the BOQs doc, not the rows, so they need `boqMutate`).
- **The Mark button (header right cluster).** Rendered ONLY when `sheetStatus === "Parsed"` (a
  Mark-and-the-banner are mutually exclusive by construction). It opens a LIGHT-CONFIRM `AlertDialog`; Confirm
  POSTs `mark_sheet_parsed_check_done` with `confirm:false`. `ok:true` -> close + `boqMutate()`. `ok:false`
  (breaks present) -> the SAME dialog switches to the ESCALATION view (`markBreaks` state non-null) listing
  each break (`BREAK_TYPE_LABELS[type]` + "Excel row {source_row_number}" + reason); the action button becomes
  "Mark anyway" which re-POSTs with `confirm:true`. A backend throw surfaces inline via `getFrappeError()`.
  The confirm action is a PLAIN `Button` (NOT `AlertDialogAction`) so the dialog stays open to escalate or
  show an error.
- **The read-only banner (when `isChecked`).** A full-width strip ABOVE the flags strip, TEAL family
  (`border-teal-300 bg-teal-50` + dark variants -- matching the "Checked" pill, NOT destructive red), with a
  `ShieldCheck` icon, the read-only explanation, and two buttons: "Un-mark" (light-confirm AlertDialog ->
  `unmark_sheet_parsed_check_done` -> `boqMutate()`) and "Go to hub" (reuses the Back nav `handleBack`).
- **`readOnly` prop on ReviewTree gates ALL 11 write affordances at their render sites.** `SheetReviewPage`
  passes `readOnly={isChecked}`. In `ReviewTree`, `readOnly?: boolean` (default false) HIDES (does not merely
  disable): the reclassify pill DropdownMenu (the plain classification text stays), the "Change parent" door
  (`canChangeParent && !readOnly`), the three edit blocks (`!readOnly && editable*Descriptors.length > 0`),
  the "Looks OK" button (the dismissed "Reviewed -- looks OK" span still shows read-only), and the Remarks
  editor -- which when `readOnly` renders the stored remark as READ-ONLY TEXT if present (else nothing),
  hiding the Textarea + Save. With the triggers gated, the value/area confirm dialog, the childless reclassify
  AlertDialog, and the RestructureModal become UNREACHABLE (all are state-driven and that state is set ONLY by
  the gated triggers -- verified: RestructureModal is imported/mounted only in ReviewTree). Every VIEW
  affordance stays fully live: expand/collapse, the detail panel (provenance, edit history, flag display),
  search, filters, column selector, scroll-to-parent.
- **Verification.** tsc 0 new wizard-file errors (baseline 3177 unchanged); in-container build exit 0
  (`✓ built in 3m 36s`, PWA 166 entries). No Frappe unit tests on the frontend (backend TestParsedCheckDoneFreeze
  / TestUnmark... + mark M1/M2 -> test_review_screen 147 green). Manual live-cert LC1 (Mark on a clean Parsed
  sheet -> banner appears, tree frozen) / LC2 (Mark on a sheet with structural breaks -> escalation dialog lists
  them, "Mark anyway" works) / LC3 (every edit affordance is gone when frozen; view affordances all still work) /
  LC4 (Un-mark -> tree editable again, edits land) / LC5 (Go to hub) / LC6 (a frozen write attempted out-of-band
  is rejected by the backend with the read-only message) / LC7 (reload a checked sheet -> banner persists from
  the payload) / LC8 (regression: a NON-checked sheet behaves byte-for-byte as before -- edits/remarks/restructure/
  dismissals all work) pending Nitesh.

**C-flag-dismissal conventions (per-row "Looks OK" -- `boqTypes.ts` + `ReviewTree.tsx` + `SheetReviewPage.tsx`):**

The per-row advisory-flag dismissal surface. Owner-LOCKED model: PER-ROW (one gesture clears ALL of a row's
currently-computing flags, NOT per-flag); a dismissal is an ACKNOWLEDGMENT, NOT an edit. Backend detail
(the `dismiss_row_flags` endpoint, the 3 `BoQ Review Row` fields, the `_apply_and_save_row_edit` chokepoint
clear-on-edit) is in root CLAUDE.md.

- **`flags_dismissed` is NOT an edit (THE invariant).** A dismissal must NEVER flip the row to "Edited" --
  the `isEdited` predicate (`row.edited_at !== null || edit_log.length > 0`), the Edited/Original pill, and
  the green tint are ALL left UNTOUCHED. The dismissal write path (`dismiss_row_flags`) mirrors
  `save_review_remark`'s bypass: it never stamps `edited_at` / `edit_log`. The frontend refreshes via the
  EXISTING `onRemarkSaved` (mutate only -- a dismissal, like a remark, does NOT advance the sheet-level
  "All changes saved" edit anchor); do NOT wire it to `onSaved`/`onRestructured`.
- **The "Looks OK" button (ReviewTree detail-panel Flags block).** Rendered in the detail panel's "Flags"
  block header (the natural "I've reviewed this row's flags" spot), sitting IMMEDIATELY BESIDE the "Flags"
  label on the LEFT. The header div is `flex items-center gap-2` (NOT `justify-between` -- a `justify-between`
  header right-pushes the button off-screen on a wide sheet, the same class of problem as #158 finding-7;
  bring the action to the eye, left-visible). It calls `useFrappePostCall("...dismiss_row_flags")` with
  `row_index` + `sheet_name` VERBATIM (#152) + `dismissed: true`; `onClick` does `e.stopPropagation()` (the
  table-body click dismisses the detail panel). When the row is ALREADY dismissed it reads "Reviewed — looks
  OK" (a span, not a button) -- NO separate un-dismiss button ships (edit re-opens / re-parse wipes / the flag
  reason stays readable cover the cases). A dedicated `dismissError` state (separate from `saveError` /
  `remarkError`) surfaces failures inline.
- **The dismissed visual = a NEW greyed/checked Info-marker state.** When `row.flags_dismissed` is truthy
  the table-body Info marker switches icon to `CheckCircle2` and colour to muted/grey (NOT amber-active,
  NOT removed -- the flags still EXIST, they're acknowledged); title "Reviewed — looks OK". The flag-reveal
  row appends a muted "Reviewed — looks OK" line (with who/when from `flags_dismissed_by`/`_at`). `isDismissed
  = !!row.flags_dismissed` is computed once per row alongside `hasFlags`/`flagsExpanded`.
- **The summary strip "N <label> – C cleared" (SheetReviewPage).** The existing per-type total (over the
  live `flags` array, which already auto-excludes resolved conditions) is kept; a per-type "cleared" count
  is ADDED = flags of that type whose `row_index` is in `dismissedRowIdx` (= the set of `flags_dismissed`
  rows from the row payload). Rendered as `N <label> – C cleared` when `C > 0`, else `N <label>`. Derived
  FRONTEND-side from the row payload + the flags array -- NO new endpoint, NO new backend data (mirrors the
  C-v2c remark-count strip's per-row-field derivation).
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0
  (`✓ built in 6m 46s`). No Frappe unit tests on the frontend (backend TestDismissRowFlags +6 -> 137 green).
  Manual live-cert LC1 (dismiss -> greyed/checked + stays Original + reload persists) / LC2 (summary "N – C
  cleared" rose) / LC3 (edit the dismissed row -> flips Edited AND re-opens) / LC4 (remark on a dismissed row
  -> dismissal STAYS, stays Original) / LC5 (re-parse -> dismissals gone) / LC6 (regression: #159 filter/
  search + Edited/Original pills + green tint + detail panel + restructure modal + remarks all intact)
  pending Nitesh.

**§9 #159 ReviewTree find-&-filter conventions (FRONTEND ONLY, `ReviewTree.tsx` only):**

A find & filter surface on the main review tree. Files touched: `ReviewTree.tsx` ONLY (no SheetSearchView
edit/import -- its hit-stepper PATTERN is MIRRORED, not imported; no backend, no doctype, no `boqTypes.ts`,
no `SheetReviewPage.tsx`). The owner-LOCKED interaction model (findings 6 + 8) -- not open to redesign.

- **CLS_LABELS-6 for the filter, NOT the 4 write-targets (THE convention).** The Classification filter's
  option source is `CLASS_FILTER_VALUES` (a module const = the 6 `CLS_LABELS` keys: `preamble, line_item,
  note, spacer, subtotal_marker, header_repeat`), NOT `ASSIGNABLE_CLASSIFICATIONS` (the 4 restructure
  write-targets). A FILTER reads all 6 existing classification states a row can carry; the 4-value set is
  exclusively for restructure write-targets. Do not conflate them.
- **Status filter predicate = the existing `isEdited` expression.** `statusFilter: "all" | "edited" |
  "original"` (default `"all"`). `passesFilter` re-states `row.edited_at !== null || (Array.isArray(edit_log)
  && edit_log.length > 0)` (the SAME expression as the inline `isEdited` at the render row, which is left
  UNTOUCHED). A remark-only row is Original -- `save_review_remark` never stamps `edited_at`/`edit_log`, so
  the predicate already encodes it; do not special-case remarks.
- **classFilter SHOW-set semantics (stated choice).** `classFilter: Set<string>` is seeded with ALL 6 values
  (`useState(() => new Set(CLASS_FILTER_VALUES))`). `allClassesShown = classFilter.size === 6` => no
  narrowing (everything shows, incl. null-classification rows via short-circuit); unchecking a type hides it;
  empty set => show none. This is "seeded-full, size-6-means-all", NOT "empty-means-all". A null
  `effective_classification` passes only when `allClassesShown` (never matches an explicit subset).
- **STRICT HIDE via a third return-null gate (THE compose-safe pattern).** A new
  `if (!passesFilter(row)) return null;` joins the existing `if (!isVisible(row)) return null;` +
  `if (!classificationVisible(row)) return null;` at the top of `rows.map`. The two filters AND-combine
  inside `passesFilter`. This is SAFE against the render pipeline because `byIdx`/`depths`/`hasChildrenSet`
  derive from the FULL `rows` prop in `useMemo([rows])` -- strict-hide narrows only the rendered subset,
  never the depth/parent-resolution maps. Parent context for a hidden ancestor stays readable via the
  Parent column (owner-accepted flat-list-of-matches).
- **Search highlight = RINGS, never backgrounds (THE collision rule -- recon Q4c; do NOT violate).** The
  row `cn()` block already stacks BACKGROUND tiers (`hover:bg-muted/30`, preamble `bg-muted/20`, edited
  `bg-green-50`, the `highlightedIdx` amber scroll-flash). A search highlight added there MUST use
  `ring-inset` (box-shadow -- a DIFFERENT CSS property), placed AFTER the background tiers, so it layers
  OVER them without masking edit-state. As-built: all hits = `ring-1 ring-inset ring-blue-300
  dark:ring-blue-700`; current hit = `ring-2 ring-inset ring-blue-500 dark:ring-blue-400`. The soft tier is
  gated `searchHitSet.has(idx) && currentHitRowIdx !== idx` so the two ring WIDTHS are mutually exclusive
  (Tailwind would otherwise have two `--tw-ring-*` widths fight). The existing single `highlightedIdx` amber
  flash is UNTOUCHED (separate concern). **`border-collapse` caveat:** ReviewTree's `<table>` is
  `border-collapse`; `ring-inset` is the more reliably-painted box-shadow variant on table rows -- if a
  live-cert shows no ring, the fallback (a follow-up) is moving the ring to an inner cell, NOT switching to
  a background.
- **Cycling reuses `revealAndScrollToRow` (do NOT reimplement auto-expand).** `stepSearchPrev`/
  `stepSearchNext` modulo-wrap `searchCurrentIdx` over `searchHits.length` (both directions), mirroring
  SheetSearchView's `stepPrev`/`stepNext` (`:343-350`) PATTERN -- NOT imported. On each step they call the
  EXISTING `revealAndScrollToRow(searchHits[ni])` (`:696-717`), which already expands collapsed ancestors +
  scrolls + sets the amber flash. `searchCurrentIdx` resets to 0 on hit-set change (`useEffect([searchHits])`,
  mirror of SheetSearchView `:288-290`). Prev/next disabled at 0 hits; counter `0 of 0` else
  `${safeSearchIdx + 1} of ${searchHits.length}`.
- **The shown-predicate compose interlock (THE resolved ambiguity).** `searchHits` (a `useMemo` over `rows`)
  keeps a row iff `classificationVisible(row) && passesFilter(row)` AND `description` matches the query ->
  ordered `number[]` of `row_index` (+ `searchHitSet`). It uses the SAME filter predicates the render gate
  uses, so a hit can NEVER be a filtered-out row; clearing a filter widens the hit set. **RESOLVED:** the
  build prompt's B3 literally listed `isVisible` in the hit predicate, but B5/LC5 require stepping to a hit
  under a COLLAPSED parent to auto-expand it -- which is impossible if hits gate on `isVisible` (collapse).
  So hits gate on the FILTER axis but DELIBERATELY NOT on `isVisible` (the collapse axis, which is reversible
  and is exactly what `revealAndScrollToRow` undoes). Render and hits agree on the filter axis; they differ
  only on collapse, by design. Any future change MUST keep the hit predicate's filter axis identical to the
  render gate's filter axis.
- **Filter Popovers live INSIDE the `<table>` `<th>` cells -> `stopPropagation`.** Each header `Filter`
  trigger button calls `e.stopPropagation()` (the `<table>` body-onClick dismisses the detail/flag panels;
  the column-selector Popover is OUTSIDE the table so it never needed this). The trigger icon turns
  `text-blue-600 dark:text-blue-400` when its filter is narrowing (`statusFilterActive` /
  `classFilterActive`). Popovers + Checkbox reuse the SAME primitives as the existing column-subset selector.
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0
  (`✓ built in 10m 54s`, PWA 166 entries). No Frappe unit tests (frontend-only). Manual live-cert LC1 (Status
  filter) / LC2 (Classification filter, all 6) / LC3 (AND-combine) / LC4 (search ring tiers, edited-green
  shows THROUGH the ring) / LC5 (cycling + auto-expand of a collapsed-parent hit) / LC6 (compose: filter
  then search, no hit on a filtered-out row) / LC7 (regression: edits still flip to Edited, detail panel +
  #162 door + #-pill modal + column-selector/flag-toggle/annotation checkboxes all still work) pending Nitesh.

**ReviewTree detail-panel layout (the live design rule; full per-pass CSS detail relocated to `boq-upload-plan.md`):**
The inline detail panel (the `expandedDetailRow === row.row_index` block) is a NESTED BRAND-TINTED CARD, not a hovered
row: indigo body tint (`bg-indigo-50/40 dark:bg-indigo-950/20`) + a BRAND-RED left-accent stripe `border-l-4
border-l-primary` (the `--primary` rose/crimson token -- NOT `--destructive`, whose pure-red would collide with the
error/re-parse-warning red on this screen) + border/radius/shadow/inset padding. Do NOT revert to a `bg-muted/30` tint
(it equals the row-hover tint -> the panel blends in) and do NOT swap the stripe to `--destructive`. Classification/Parent
render as a VERTICAL stack (`grid-cols-1`, avoids off-screen horizontal scroll on wide sheets); the three edit blocks
(numeric / text / per-area) are INDEPENDENT responsive `grid-cols-1 sm:2 md:3 lg:4` grids and stay SEPARATE (each has its
own save path). (A two-column "Context | Actions" revamp of this panel was prototyped + reverted on 2026-06-25 -- the
ORIGINAL single-column layout above is the live one; only the two read views below were kept.)

**Detail-panel read views `ParentChain.tsx` + `ChildrenList.tsx` (ADDITIVE, 2026-06-25 -- the ONLY survivor of the
reverted revamp):** two PURE read components mounted in the EXISTING panel, in a `mb-2 space-y-2` block placed right
after the Classification/Parent display grid and before the AI-suggestion block (no other panel change; both render in
editable AND readOnly sheets -- read context). **Text scale MATCHES the surrounding panel:** `text-[10px]` uppercase
section label + `text-xs` rows (not the roomier text-sm of the reverted revamp). `ParentChain` walks
`effective_parent_index -> byIdx` (the same walk as `revealAndScrollToRow`, `HOP_CAP=60` + self/cycle guard) to a vertical
indented ancestors→(this row) tree; ancestor crumbs are clickable. **ROOT indication (correct):** there is NO synthetic
"Root" node -- the actual root-most ancestor is tagged "top level" (only when its own `effective_parent_index` is null/-1,
guarding cycle/hop-cap stops), and a current row that is itself top-level renders "This row is at the top level — no
parent." (the prior synthetic "Root" line wrongly implied a top-level row had a root parent). `ChildrenList` reads the NEW
`childrenByParent` map (the O(n) inverse of `effective_parent_index`, built in ReviewTree's `[rows]` memo alongside
`byIdx`/`hasChildrenSet`) -- DIRECT children only, each with a `▸N` grandchild-count marker; **descriptions HARD-capped at
35 chars** (`capDesc`, JS slice + ellipsis -- not CSS truncate), capped `max-h-48` scroll, empty → "No children." Both
reuse `ClassificationPill` from `reviewRender` and take `onNavigate={navigateToRow}` where `navigateToRow(idx)` =
`setExpandedDetailRow(idx)` + `revealAndScrollToRow(idx)` (a crumb/child click OPENS that row's panel AND
reveals+scrolls+flashes it, auto-expanding collapsed ancestors). Known limit: a target hidden by an active
classification/status FILTER (not just collapse) is a no-op scroll -- same as the existing scroll-to-parent.
`GeminiAcceptBlock` + the panel body are UNCHANGED from the original.

**Fuzzy description search conventions (`boqDescriptionSearch.ts` + `ReviewTree.tsx` + `SheetSearchView.tsx`; full detail:
plan §"Fuzzy description search"):** the two description search boxes in the review workflow now use the app-wide
token-scoring matcher instead of substring `.includes()`. There are only TWO real implementations: `ReviewTree.tsx`'s
`searchHits` memo and `SheetSearchView.tsx`'s `hits` memo -- `RestructureModal.tsx` owns NO search (it embeds SheetSearchView
as its parent-picker, so it upgrades for free; do NOT add search to it). The other `boq-wizard/` "filters"
(classification/status/AI/priceability toggles) are NOT text search -- leave them alone.

- **ONE shared helper -- never inline a second matcher.** `boqDescriptionSearch.ts` exports the single pure
  `fuzzyDescriptionMatchSet<T>(items, query, getText) -> Set<T>` (the matching ORIGINAL references). It wraps
  `utils/tokenSearch` (the extracted `FuzzySearchSelect` core -- do NOT add `fuse.js`; it's an unused dep). Both surfaces
  call THIS; if you add a third description search anywhere in the wizard, call this too.
- **THE TRAP (load-bearing):** `tokenSearch` returns ALL items on an empty/too-short query (not an empty set). The helper
  GUARDS this -- a `< 2`-char trimmed query, or a query whose tokens are all 1-char, returns an EMPTY set (find-semantics:
  short query => no hits). Each call site ALSO short-circuits `query.trim().length < 2` before calling. Never feed the
  raw `tokenSearch` output to a find-stepper.
- **Locked config (the `/grill` decisions):** token **AND** (`minTokenMatches = tokenCount`, computed at the call site
  with the SAME `length >= 2` filter as the config's `minTokenLength` -- they MUST agree or nothing matches);
  `partialMatch: true`; `minSearchLength: 2` / `minTokenLength: 2`.
- **Fuzzy = MEMBERSHIP, document = ORDER (decision A).** The helper returns a Set; each surface iterates its OWN
  document-ordered source (`rows.filter(...)` / `allRows`) and keeps `set.has(item)`, mapping to its identity field
  (`row_index` for ReviewTree, `row_number` for SheetSearchView). tokenSearch's relevance ranking is DELIBERATELY
  discarded so prev/next steps top-to-bottom -- do NOT "fix" this by using the ranked order.
- **Invariants preserved.** ReviewTree still gates candidates on the FILTER axis (`classificationVisible && passesFilter`),
  NOT the collapse axis (`isVisible`) -- the "hit predicate's filter axis == render gate's filter axis" rule holds (only
  the text test changed). SheetSearchView keeps its `searchEnabled`/degraded-mode guard. All steppers, ring/flash highlight
  tiers, "N of M" counters, `revealAndScrollToRow`, and `onCurrentHitChange` are UNCHANGED.
- **Verification.** tsc delta-0 (3181 == 3181; 0 errors in the 3 touched files -- the `@/`-alias "cannot find module" +
  implicit-any are standalone-LSP noise, not tsc errors); in-container Vite build exit 0 (`✓ built in 1m 24s`). No Frappe
  tests (frontend-only). Manual live-cert pending Nitesh: LC1 ReviewTree `cable 16` finds a non-contiguous match + Next
  walks top->bottom; LC2 same in the RestructureModal parent-picker; LC3 1-char => no hits; LC4 filters still gate hits;
  LC5 highlight/flash/counter intact.

**§9 #162 standalone Change-parent door conventions (FRONTEND ONLY, `ReviewTree.tsx` only):**

A SECOND front door to the EXISTING `RestructureModal`, reached WITHOUT a reclassification. Files touched:
`ReviewTree.tsx` ONLY (no `RestructureModal.tsx`, no backend, no doctype JSON, no `boqTypes.ts`).

- **The button + placement (mirror the reclassify control).** The row-detail panel's `grid grid-cols-2`
  has a CLASSIFICATION cell (left, already hosts the "Change ▾" reclassify DropdownMenu) and a PARENT cell
  (right, previously display-only). This slice wraps the PARENT cell's existing content in a
  `flex items-center gap-2` and adds a "Change parent" `<button>` beside the current-parent display,
  styled IDENTICALLY to the "Change ▾" pill (`rounded-full bg-blue-100 ... text-[10px]`). **Plain button,
  NOT a single-item DropdownMenu** -- there is no list to pick; the single action is "open the modal", so a
  dropdown would be a hollow one-item menu.
- **The open call = a NO-OP reclassify (THE pattern).** On click:
  `setRestructureModal({ row, newClassification: row.effective_classification as string })`. It uses the SAME
  `setRestructureModal` state setter the childless AlertDialog's "Move under a new parent" radio already uses
  -- and DIRECTLY, NOT via `onPickClass` (which would route a childless row to the light AlertDialog confirm
  instead of the modal). `newClassification` = the row's CURRENT class, so the modal's reclassify write is a
  no-op (same value) while the row-position picker drives the actual move. `canSave` in `RestructureModal`
  never compares new-vs-current classification, so a same-value class is benign (verified).
- **NON-NEGOTIABLE -- no silent reparent (why we reuse the modal, not a lighter path).** A WITH-children row
  opened via "Change parent" STILL surfaces the five child-placement options: the `children.length > 0` gate
  inside `RestructureModal` is left EXACTLY as is -- do NOT suppress it for a parent-only open. The reviewer
  must decide the children's fate; the modal's batch cycle-guard + the single write-chokepoint come along. A
  CHILDLESS row opens with the children block already suppressed (the existing childless adaptation;
  `rowPosition` lazy-inits to "move") -> only the row's-own-position picker shows.
- **Scope exclusion (owner-locked) -- `canChangeParent` gate.** The button does NOT render when the row's
  CURRENT classification is `subtotal_marker` or `header_repeat`:
  `const canChangeParent = row.effective_classification != null && (ASSIGNABLE_CLASSIFICATIONS as readonly string[]).includes(row.effective_classification);`
  (the `as readonly string[]` cast is required -- the const is a `readonly [...]` tuple, so `.includes` of a
  `string | null` otherwise fails TS2345). A no-op reclassify on those two parser-only detections would be
  rejected by the backend `_ASSIGNABLE_CLASSIFICATIONS` gate, so the door must not appear there.
- **edit_log fidelity (VERIFIED, no backend change).** The standalone reparent must appear in the row's
  edit_log. The no-op reclassify writes a same-value `human_classification` entry (harmless), but the PARENT
  change is captured SEPARATELY: `save_review_restructure`'s `row_new_parent` path calls
  `_apply_and_save_row_edit(..., "human_parent", ...)`, which ALWAYS appends its own edit_log entry for the
  field it writes -- field `human_parent`, `from` = prior effective parent, `to` = new parent (or null for
  root), reason `"row moved: row N reclassified to <cls>"`. So the parent move is ALREADY logged; the B2
  conditional (and its chokepoint STOP-gate) were NOT triggered -- backend untouched.
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0.
  No Frappe unit tests (frontend slice; reused modal + backend already certified). Manual live-cert LC1-LC6
  (LC2 children-prompt + LC6 cycle-block are the load-bearing no-silent-reparent proofs) pending Nitesh.

**Force Re-parse FRONTEND slice conventions (two entry points + shared modal + rewritten warning):**

Frontend-only. Files touched: `SheetCard.tsx`, `ParseRunDialog.tsx`, `BoqHubPage.tsx` ONLY (no backend, no doctype JSON, no `boqTypes.ts` -- the dialog's new props are typed locally on `ParseRunDialogProps`). The slice builds the UI that sets `force_reparse: true` on the already-certified backend floor (`run_parse(..., force_reparse=False)` / `assemble_mapping_config`, feat 95928637).

- **Two-button hub pattern (THE convention).** The hub parse-gate footer now holds TWO buttons in a `flex gap-2` cluster on the right: the existing **"Parse workbook"** (primary, UNCHANGED gate `!canParse || parseInFlight`) and a new **"Re-parse"** (`variant="outline"`). The Re-parse button sits BESIDE Parse -- it does NOT replace Parse and does NOT re-enable a greyed Parse. Each button keeps its own `Tooltip` (disabled-reason pattern). Apply this two-button shape if a future hub action needs a "destructive variant of an existing primary action" beside it.
- **Re-parse path sends `force_reparse: true`; normal Parse does NOT (THE wire rule).** `BoqHubPage.handleParseConfirm` spreads `...(parseDialogMode === "reparse" ? { force_reparse: true } : {})` onto the EXISTING `callRunParse({ boq_name, sheet_names })` payload. Normal Parse omits the param entirely (backend default False). The SDK serializes the bool; the backend coerces `"true"/true`. NEVER send `force_reparse` on the normal Parse path.
- **Per-card eligibility = `has_prior_parse === 1` AND effective status in {Parsed, Parsed Check Done, Reviewed} (THE eligibility convention).** Computed as `canReparse` in `SheetCard.tsx` (per-card render gate) and as `reparseEligibleDrafts` in `BoqHubPage.tsx` (global-button enable gate + the dialog's tickable source) -- the SAME predicate in both places. **"Parse failed" is DELIBERATELY EXCLUDED** (decision recorded): the backend floor does NOT widen `force_reparse` to "Parse failed" (`assemble_mapping_config` Rule 4 keeps it `not_eligible` regardless of the flag), so offering it would be a control that silently no-ops (the sheet would surface in the completion modal's "Not parsed" line). A never-parsed sheet (`has_prior_parse !== 1`) NEVER shows a Re-parse control. The per-card "Re-parse" Button (`variant="outline"`) renders inside the Parsed / Parsed Check Done / Reviewed action blocks only; on click -> `onReparse?.(draft.sheet_name)` (VERBATIM #152).
- **Global-button enable rule: `reparseEligibleDrafts.length >= 1` (+ `parseInFlight` guard); NO blockingCount gate.** Deliberate divergence from `canParse` -- a Parse-failed sheet must NOT block re-parse of the previously-good sheets; the two concerns are independent. Greyed -> "No previously-parsed sheets to re-parse" tooltip.
- **Shared-modal mode mechanism.** `ParseRunDialog` gains `mode?: "parse" | "reparse"` (default `"parse"`) + `reparseDrafts?: BoQSheetDraft[]` (tickable source in reparse mode) + `restrictToSheetName?: string | null` (per-card pre-filter). The PARENT owns `parseDialogMode` + `reparseRestrictSheet` state (set BEFORE `parseDialogOpen` flips true) and derives `force_reparse` from `parseDialogMode` -- so `onConfirm(sheetNames)`'s signature is UNCHANGED (smallest blast radius; the dialog needs `mode` only for rendering). `tickableDrafts = isReparse ? (restrictToSheetName ? reparseDrafts.filter(one) : reparseDrafts) : reviewedDrafts`; `tickedSheets` seeds from `tickableDrafts`; the seed `useEffect` still keys on `[open]` (reads the fresh tickable source because mode/restrict are already set). The four informational lists (General specs / Already parsed / Pending / Skipped) are gated `mode === "parse"` -- hidden in reparse mode. Title / description / confirm-button label / "Will (re-)parse" heading all branch on `isReparse`. This was the B3 PROCEED path (extend the tickable-source array feeding the EXISTING checkbox machinery; NO four-list restructure).
- **Rewritten destructive warning (step 2 = the safety surface).** Trigger shape UNCHANGED: `if (dirtyTicked.length > 0) setStep(2)`, where `dirtyTicked` = ticked sheets with `has_prior_parse === 1` -- now catching Parsed + Parsed Check Done + dirty-Reviewed (re-targeted from dirty-Reviewed-only). Copy REWRITTEN to name specifically the parsed output AND every review-screen change -- edited values and text, REMARKS, classification changes, and parenting/restructure moves; "cannot be undone." A LOUDEST `destructive`-styled callout keyed on `checkedDoneTicked` (`dirtyTicked` filtered to `wizard_status === "Parsed Check Done"`) names the hand-reviewed+Checked sheets. In normal-parse mode the Checked callout never appears (no Checked sheet is tickable there) and a FRESH Reviewed sheet (`has_prior_parse !== 1`) still triggers nothing -- the normal Parse path is unchanged.
- **Verification.** tsc 0 NEW wizard-file errors (project baseline unchanged) + in-container build exit 0. No Frappe unit tests (frontend slice; backend floor already test-certified). Manual live-cert LC1 (never-parsed -> no per-card control, global greyed when zero eligible) .. LC7 (normal Parse on a fresh Reviewed sheet unchanged) -- DESTRUCTIVE, pending Nitesh. #145 (all-Parsed workbook: Parse greyed but Re-parse ENABLED) is closed by this slice.

---



### Slice 5b -- Download priced tender hub UI + staleness (FULL-STACK, NO schema/migrate, base tip 0b0b7eaf, 2026-06-25)

**The hub UI for the 5a Excel write-back** -- download the original tender workbook with the priced rates + the user's
colour/remark notes stamped in. Completes the Slice-5 arc (5a backend + highlight + 5b UI).

**Backend (additive, NO schema, NO migrate -- `commit_gate.get_committed_state`):** the endpoint now ALSO returns, per
committed sheet, two ADDITIVE fields (existing keys UNCHANGED -> existing consumers unbroken):
- **`last_exported_at`** -- the committed `BoQ Sheet.last_exported_at` (5a field). FREE: folded into the EXISTING
  `is_current=1` BoQ Sheet lookup the endpoint already does for `sheet_order` (one field added to `fields=[...]`).
- **`pricing_changed_since_export`** (bool) -- TRUE iff `max(priced_at over BoQ Cell Pricing, colored_at over BoQ Cell
  Color, remarked_at over BoQ Cell Remark)` for the sheet's **CURRENT** `commit_version` (`is_current=1`) is AFTER
  `last_exported_at`; content-exists-but-never-exported -> TRUE; nothing priced/colored/remarked -> FALSE. **Version-isolated**
  (the new `_latest_change_by_sheet_version` groups by `(sheet_name, committed_version)`, so an OLD version's timestamp can
  never mark the current version stale). Three GROUPED queries total (NOT per-sheet); `_is_changed_since_export` normalizes
  both sides via `frappe.utils.get_datetime` (get_all-Datetime vs raw-SQL-MAX type-robust). Server-computed (one hub fetch,
  the `get_stale_sheets` idiom) -- NO separate endpoint.

**Frontend:**
- **NEW "Download priced tender" hub button** (6th sibling in the header action cluster, gated on `committedMap.size > 0`,
  Tooltip/disabled-reason pattern). **DELIBERATELY distinct from "Export Parsed BoQ"** (the D2b draft-review .xlsx built
  client-side -- renamed from "Export Finalized" in the footer-rework slice below): this downloads the ORIGINAL tender file
  stamped server-side.
- **NEW `PricedTenderDialog.tsx`** -- mirrors CommitDialog's `committedState`-driven rows + per-row metadata sub-line, with
  ExportWorkbookDialog's self-contained "confirm does the download" shape. Source = `committedMap` (committed sheets, same as
  TenderingDialog -- NOT `committableSheets`). **All finalized (grid_and_nodes) rows ticked by default** (reset in
  `useEffect([open])`); **grid-only general-specs rows SHOWN but DISABLED ("no rates to write")** (passthrough no-op).
  Per-row sub-line: `last exported {date}` / `never exported` + an amber "changed since export" when
  `pricing_changed_since_export`. Dismiss-guard while running; inline `getFrappeError`.
- **NEW `downloadBlob.ts`** -- `base64ToBytes` (PURE, unit-tested) + `downloadBytes` (the `exportReviewXlsx` `Blob ->
  createObjectURL -> anchor[download] -> click -> revokeObjectURL` tail). The dialog calls `export_priced_workbook`, decodes
  `content_base64`, downloads, then hands the result up via `onDownloaded`.
- **Skipped-formula message** (0 client-owned-doc requirement -- tell the user what we left untouched): an acknowledge-only
  results note (`AlertDialog`, single OK, mirrors `CommitResultsModal`) names the sheets+columns left untouched because they
  hold formulas; plain success when none skipped. The hub `onDownloaded` mutates `get_committed_state` so the staleness chips
  refresh.
- **Per-sheet staleness chip on `SheetCard`** -- a muted amber "priced since last export" chip when
  `committedState.pricing_changed_since_export` (rides the EXISTING `committedState` prop -- NO new wiring; mirrors the
  needs-attention chip styling).
- **`boqTypes.ts`**: `CommittedSheetState` gains `last_exported_at?` + `pricing_changed_since_export?`; NEW
  `ExportPricedWorkbookResponse`.

**Tests:** backend `test_commit_gate` 20 -> 27 (+7: last_exported_at surfaces null/value, stale TRUE when change-after-export,
FALSE when export-after-change, never-exported-with-content TRUE, no-content FALSE, colour-driven TRUE, version-isolation).
frontend vitest 303 -> 307 (+4: `base64ToBytes`). tsc 3175 (0 new). NO migrate. Backend extension live-verified on
BOQ-26-00145 (both fields surface, staleness + version-isolation correct). The browser download round-trip (`atob -> Blob ->
anchor`) is **owner-certified live, NOT headless-unit-runnable**.

**OWED live-cert (pending Nitesh):** (i) **VRF formula-skip live proof** -- price a VRF combined-rate (`=SUM`) cell,
Download priced tender, confirm the column appears in the skipped-formula note + the cell stays a formula + carries NO teal;
(ii) **uncommitted/unticked-sheet-unchanged** -- a grid-only sheet (disabled, untickable) and an unticked finalized sheet are
not stamped; LC the staleness chip flips after a new price + clears after a re-download.


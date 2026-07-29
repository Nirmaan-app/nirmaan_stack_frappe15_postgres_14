### Version-view -- read-only committed-version history browser (FULL-STACK, NO migrate, base tip 761c4bf3, 2026-06-26)

**A read-only HISTORY BROWSER for the pricing editor: a version dropdown selects an OLDER committed version of a sheet
and shows it read-only WITH that version's own saved pricing.** Slice 1 of 2 (version-view ONLY -- copy-forward, the
write-side, is the SEPARATE next slice; NO copy/write/apply built here, NO copy-forward button per owner). Default =
current version, editable (today's behaviour, unchanged). Selecting an earlier version drops the WHOLE editor into a
clearly-marked read-only history mode. Recon (read-only, three-BoQ, + a post-231f3361 re-commit identity check) preceded
this build; the load-bearing findings are quoted in the build prompt.

**BACKEND (additive read paths only -- the live-editor hot path is byte-for-byte unchanged; NO migrate):**
- **The hot-path problem:** `get_priced_rows` / `get_committed_rows` are welded to the CURRENT version (`get_committed_rows`
  resolves the BoQ Sheet + nodes by `is_current=1`). The pricing + grid reads were ALREADY version-parameterized
  (`get_sheet_pricing` / `get_committed_sheet_grid` take `committed_version`); only the NODE read was hardwired.
- **`review_screen.py`:** extracted the node-read + row-assembly tail of `get_committed_rows` into a private
  `_assemble_committed_rows(boq, node_filters, column_descriptors, commit_version)`. The CURRENT path passes
  `{boq, sheet, is_current:1}` -- **byte-for-byte the prior query** (proven: `test_review_screen` 232 unchanged & green).
  Added `get_committed_rows_at_version(boq, sheet, committed_version)` (whitelisted): resolves the BoQ Sheet by
  `commit_version` (ANY is_current -- an old version is is_current=0), rebuilds descriptors from ITS config, reads nodes
  scoped by the resolved version's BoQ Sheet name (no is_current -- that row IS the version). Graceful empty when the
  version has no node-tier row (the node tier + grid tier can carry different version sets -- the FAS {1,3,4} vs grid
  {1,2,3,4} recon case) -> client falls back to the faithful grid.
- **`pricing.py`:** extracted the overlay-merge block of `get_priced_rows` into `_merge_overlays(boq, sheet, version, rows,
  column_descriptors)` (behavior-preserving; `get_priced_rows` calls it -> `test_pricing` proves equivalence). Added
  `get_version_priced_rows(boq, sheet, committed_version)` (whitelisted): mirrors `get_priced_rows`' shape so the grid
  renders an old version with NO new render code, but forces the read-only posture -- `editable=False`, `lock_info=None`
  (a historical read NEVER touches the single-editor lock). `column_formulas` / `dismissals` / `reconciliation_choices`
  read for the REQUESTED version (all version-parameterized). Reuses `_merge_overlays`.
- **`commit_gate.py`:** `get_sheet_versions(boq, sheet)` (whitelisted) -- the dropdown's version list. **Version
  SOURCE-OF-TRUTH = the committed GRID tier** (the existing "what versions exist" authority; covers grid-only sheets +
  versions the node tier lacks). Each version carries its last-pricing-change via **reuse of
  `_latest_change_by_sheet_version`** (the Slice-5b staleness helper -- one grouped call, every version). Missing key =
  never-priced -> `last_change_at=None` (client labels by committed_at + "never priced", a COMMON case). Sorted version-desc.
- **FINDING (S5, reported, NOT guarded this slice):** the WRITE endpoints (`save_cell_price` etc) take `committed_version`
  and resolve the cell at that version WITHOUT requiring is_current -- a crafted POST could write an OLD version. This is
  BY DESIGN (each version legitimately carries its own pricing lifecycle -- recon Q3) and version-view adds no write, so
  no new exposure; flagged because it informs copy-forward's next slice. No out-of-scope guard added.

**FRONTEND (`SheetPricingPage.tsx` + new `VersionRibbon.tsx`):**
- **The read-only spine = the EXISTING `locked` choke:** `locked = editable === false || takenOver || isLocked ||
  isViewingHistory`. One-line addition -- every `onSave*` (already `locked ? undefined`) and `disabled={locked}` control
  collapses to read-only by construction. NO parallel gate; **`pricingRowPropsAreEqual` UNTOUCHED**. The history payload
  ALSO reports `editable=false` (server belt to the client suspenders).
- **State + fetches:** `selectedVersion: number|null` (null = current/live; reset on sheet switch in the `[sheetName]`
  effect). Two ADDITIVE conditional fetches: `get_sheet_versions` (dropdown list) + `get_version_priced_rows` (enabled
  only when `isViewingHistory`). The live `get_priced_rows` fetch is unchanged; `activeMessage` ternary swaps the data
  source (rows/descriptors/formulas/dismissals/recon/commitVersion/editable/lock/loading/error) to the history payload
  when viewing history.
- **`VersionRibbon.tsx` (new):** the OUTERMOST band, ABOVE the top ribbon -> shows on ALL sheet types (above the
  `{!isGridOnly}` gate); renders only when 2+ versions exist (version-COUNT gated, not type-gated). shadcn `Select` only.
  Pure `versionLabelParts` / `formatVersionLabel` helpers (vitest): current -> "Current (live)" (no date, only editable
  one); earlier priced -> its last-change date; earlier never-priced -> committed_at + "never priced". An indigo read-only
  pill when viewing history (DISTINCT from the teal deliberate-lock / amber concurrency banners).
- **Wiring:** grid `key` extended to `${sheetName}::${selectedVersion ?? "current"}` (clean remount on version switch);
  `commitVersionForGrid` tracks the viewed version (grid-only history); lock toggle disabled `|| isViewingHistory`;
  concurrency/lock banners suppressed in history (`isGridOnly || isViewingHistory ? null : ...` -- the ribbon's own banner
  is the read-only surface, else editable=false would trip the holder banner); override banner suppressed; editor note
  shows a history variant. **Never-priced common case** (VRF, Electrical v1/v2) renders through the normal node path with
  an empty pricing overlay -- NOT grid-only, no special path.
- **Types (`boqTypes.ts`):** `SheetVersionRow` + `GetSheetVersionsResponse`; the version read reuses `GetPricedRowsResponse`.

**Tests:** backend `test_pricing` 158 -> 166 (+8 `TestGetVersionPricedRows`: old version reads its OWN frozen price [150
not the current 999]; current via the version read; the live hot path still sees only current [version-isolated]; read-only
posture [editable False / lock_info None]; no concurrency lock touched by a read; `get_committed_rows_at_version` reads
old [is_current=0] nodes; missing-version -> empty rows; arg guards). `test_commit_gate` 27 -> 33 (+6 `TestGetSheetVersions`:
all versions version-desc; is_current flags; last_change_at = max pricing change for a priced version; never-priced -> None
[committed_at fallback]; committed_at + disposition surface; arg guards). `test_review_screen` 232 (unchanged -- the
`get_committed_rows` refactor is byte-for-byte). Frontend vitest 323 -> 330 (+7 NEW `VersionRibbon.test.ts`: the pure
label-shape helper -- current/priced/never-priced, currentVersion match, never-priced tag). tsc 3175 (0 new, 0 in
touched). in-container Vite build exit 0. NO migrate (read-only endpoints + frontend). Frontend vitest/tsc/build run
IN-CONTAINER (host is win32-arm64; the installed rolldown bindings are linux-arm64 -> vitest can't start on the host; an
existing test fails identically -- environmental, not this change). OWNER live-cert pending on all three canonical BoQs:
VV1 Electrical (1..6 versions) -> dropdown lists all, current tagged "live", switch to v3 -> read-only history + its own
pricing; VV2 a never-priced version (VRF / Electrical v1) -> "never priced" label + renders read-only with no prices;
VV3 grid-only sheet (SOW) multi-version -> ribbon shows, faithful grid at the selected version; VV4 switch back to
"Current (live)" -> editing returns.


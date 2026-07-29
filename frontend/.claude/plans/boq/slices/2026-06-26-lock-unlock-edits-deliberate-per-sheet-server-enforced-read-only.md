### Lock/unlock edits -- deliberate per-sheet server-enforced read-only lock (FULL-STACK + MIGRATE, base tip c339c5d8, 2026-06-26)

**A DELIBERATE, user-controlled, per-sheet, PERSISTED, SERVER-ENFORCED read-only lock for the pricing editor -- the
pricing twin of the review-screen "Finalized" freeze.** When a sheet is locked the editor is fully read-only (NO rate /
amount formula / color / remark / dismissal / reconciliation choice); the "Price any row" override does NOT bypass it;
it persists across sessions + users; ANY user may unlock (no role gate -- a coordination signal); the unlock toggle stays
live when locked; a re-commit INVALIDATES the lock (a new commit_version starts unlocked). DISTINCT from (a) the transient
single-editor CONCURRENCY lock (`BoQ Sheet Pricing Lock` / `BOQ_PRICING_LOCKED`) and (b) the inert per-cell `is_finalized`.

**BACKEND:**
- **Doctype (additive, migrate):** three fields on **`BoQ Sheet`** (the committed sheet tier, mirroring the
  `last_exported_at` additive precedent): `is_locked` (Check, default 0), `locked_by` (Data, read_only -- matches
  `BoQ Cell Dismissal.dismissed_by` / `BoQ Cell Reconciliation Choice.chosen_by`), `locked_at` (Datetime, read_only).
  `bench migrate` created all three (verified via information_schema: `is_locked` smallint default 0 / `locked_by`
  varchar / `locked_at` timestamp). Migrate hit the pre-existing unrelated `backfill_cashflow_gap_limited` patch wart
  (NOT this slice) -- schema sync runs BEFORE the patch phase, so the columns landed.
- **Endpoints (`pricing.py`):** `lock_sheet(boq_name, sheet_name, committed_version)` / `unlock_sheet(...)` (both
  `@frappe.whitelist(methods=["POST"])`), mirroring `mark_sheet_parsed_check_done`/`unmark`: resolve the `is_current=1`
  BoQ Sheet row for (boq, sheet_name VERBATIM #152, committed_version) via the shared `_set_sheet_lock` ->
  `frappe.db.set_value` (NOT doc.save -- the list-valued `area_dimensions` JSON throws on a full save) of the three
  fields + an explicit commit. NO role check (any user). Returns `{ok, is_locked, locked_by, locked_at}`.
- **Guard (`pricing.py`):** `_guard_sheet_not_locked(boq, sheet, version)` (mirrors `_guard_sheet_not_frozen`): a single
  `frappe.db.get_value` of `is_locked` on the `is_current=1`+`commit_version` row; throws `_LOCKED_WRITE_MESSAGE`
  ("This sheet is locked and is read-only. Unlock it to make changes.") if truthy. Called in ALL SIX save_* endpoints --
  `save_cell_price` (before the formula/priceability gates so the lock error wins precedence), `save_row_remark`,
  `save_cell_color`, `save_cell_dismissal`, `save_cell_reconciliation_choice`, `save_amount_formula` -- AFTER the cell/
  target resolve and BEFORE `acquire_or_refresh` (reject-mutates-nothing; the same slot the mandatory-formula gate uses).
  PURELY ADDITIVE: an unlocked sheet passes through byte-for-byte. **The server is the real boundary** -- a direct API
  call on a locked sheet is rejected (proven by test), so the frontend gate is not bypassable.
- **Return fold:** `get_priced_rows` adds an `is_locked` key BESIDE `editable` (a SEPARATE key, NOT folded into editable
  -- the frontend keeps the reason distinct for the banner); built in the existing `commit_version is not None` branch.
  `get_committed_state` folds `is_locked` into the EXISTING `is_current=1` BoQ Sheet lookup (one more field, no new query
  -- like last_exported_at) -> a per-sheet `is_locked` for a future hub indicator.
- **Re-commit invalidates FOR FREE:** `_write_committed_boq_sheet` `new_doc()`s a fresh BoQ Sheet row per commit and
  NEVER sets `is_locked`, so a new commit_version defaults `is_locked=0`; the version-scoped guard/read (commit_version +
  is_current) means a re-committed-away version is never locked. NO pipeline change.

**FRONTEND:**
- **The lock boolean:** `isLocked = pricedData?.message?.is_locked ?? false`; `locked = editable === false || takenOver ||
  isLocked`. This ALONE makes the grid read-only -- all six handlers already withhold on `locked` (callback-presence
  gate), and the override lives INSIDE `isRateEditableRow` ANDed AFTER the withheld `onSaveRate`, so it can NEVER reach
  past the lock (verified -- no parallel override gate added). **`pricingRowPropsAreEqual` is UNTOUCHED.**
- **The toggle (`SheetPricingPage` top-ribbon right cluster, inside `{!isGridOnly}`):** a state-aware Lock/Unlock button,
  DISTINCT icon (`ShieldCheck`/`ShieldOff`) from the override's Lock/Unlock so they never read alike; **NOT gated by
  `locked`** (the one control that stays live so an unlock is always reachable); disabled while the POST is in flight or
  the sheet is uncommitted; loudly TEAL when locked. On click -> POST `lock_sheet`/`unlock_sheet` then `mutate()` so the
  editor re-reads `is_locked` (persisted + cross-user). Absent on grid-only sheets (inherits the `{!isGridOnly}` gate).
- **The signal:** a TEAL `ShieldCheck` banner when `isLocked` ("This sheet is locked (read-only). Unlock it to make
  changes." + an Unlock button + Go to hub), VISUALLY DISTINCT from the two amber concurrency banners. **Precedence: the
  deliberate lock banner DOMINATES** -- a locked sheet shows the teal banner even if a takeover/holder reason is also true
  (the persistent reason wins over the transient ones).
- **Residue buttons disabled when locked:** the "Price any row" override toggle + the "Save now"/flush button (inert under
  the lock anyway -- removes the clickable-but-dead confusion).
- **Types (`boqTypes.ts`):** `is_locked: boolean` on `GetPricedRowsResponse`; `is_locked?: boolean` on
  `CommittedSheetState`.

**Tests:** backend `test_pricing` 151 -> 158 (+7 `TestSheetLock`: lock/unlock set+clear the three fields; any-user-unlocks
[no ownership check]; the guard REJECTS all six save_* paths + override-doesn't-bypass + reject-mutates-nothing [no overlay
row, concurrency lock never acquired]; unlocked passes through; `get_priced_rows` + `get_committed_state` surface
is_locked; re-commit starts unlocked [carry-forward NOT]). `test_commit_gate` 27 (unchanged -- additive field). Frontend
vitest 323 (unchanged -- the toggle/banner are UI, owner-live-certed; no new pure leaf, no brittle DOM test invented).
tsc 3175 (0 new, 0 in touched). in-container Vite build exit 0. bench migrate landed the 3 columns. OWNER live-cert
pending: LC1 lock a grid_and_nodes sheet -> every path read-only + override can't re-enable + teal banner + toggle reads
Unlock; LC2 unlock -> editing returns; LC3 persist across reload + cross-user; LC4 direct API save on a locked sheet
rejected (server proof -- covered by test); LC5 grid-only sheet -> no toggle, no banner; LC6 re-commit -> unlocked; LC7
concurrency lock + deliberate lock compose (locked stays read-only regardless; unlock doesn't grant the concurrency lock).


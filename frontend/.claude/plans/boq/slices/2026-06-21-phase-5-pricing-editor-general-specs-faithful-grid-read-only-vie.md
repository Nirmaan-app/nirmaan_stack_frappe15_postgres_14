### Phase 5 Pricing Editor -- general-specs faithful-grid read-only view (FULL-STACK, additive backend read + frontend render fork, feat pending, 2026-06-21)

**Goal.** A GRID-ONLY (general-specs) committed sheet -- SOW, MEP Make List, Assumptions & Exclusions, etc. -- commits a
FAITHFUL grid with ZERO nodes, so the node-based `get_priced_rows` renders it EMPTY in the pricing editor. When the
active tab is a grid-only sheet, render its FAITHFUL committed grid as READ-ONLY reference. Data sheets keep the
node-based pricing grid exactly as before. NO migrate (sheet_disposition already exists; the new endpoint is a pure
read).

**`get_committed_state` surfaces `sheet_disposition`.** Added to its grid-tier `fields=[...]` + the per-sheet return dict
(purely additive). `CommittedSheetState` (boqTypes.ts) gains `sheet_disposition: "grid_only" | "grid_and_nodes"`.

**NEW endpoint `get_committed_sheet_grid(boq_name, sheet_name, committed_version)` (pricing.py, bare whitelist,
GET-capable, PURE READ).** Returns the faithful committed grid for ONE `(boq, sheet_name VERBATIM #152,
committed_version)` = `{rows: [{row_number, cells}], column_role_map, column_headers, area_dimensions, header_row,
header_row_count}`. Reads grid rows from `BoQ Committed Sheet Grid Row` (parent = the current grid for that
boq+sheet+version, ORDER BY row_order asc) + the column-config snapshot from the committed `BoQ Sheet`. A NEW
`_parse_json_field` guard handles BOTH a json.dumps STRING and an already-parsed dict/list (`get_value(as_dict)` returns
JSON fields parsed). **THE EMPTY-CONFIG CASE (load-bearing):** the row return is NEVER gated on a non-empty config -- a
general-specs sheet (SOW) has empty role/header maps, its grid ROWS are returned regardless (the render falls back to
raw Excel letters). Guards mirror the other committed reads.

**Frontend render fork (`SheetPricingPage.tsx`).** `isGridOnlySheet(committedSheets, sheetName)` (NEW pure exported
helper in PricingGrid.tsx) returns true ONLY for `sheet_disposition === "grid_only"`, **FAILS-TO-FALSE in the
indeterminate (committed-state loading) window** so a data sheet never briefly renders grid-only. When grid-only -> fetch
`get_committed_sheet_grid` (disabled until boqId+sheetName+commit_version known -- commit_version comes from the
already-running `get_priced_rows`, which carries it for BOTH dispositions) + render the EXISTING `SheetDataGrid`
read-only (pagination stubbed), SUPPRESS the lock banners / save-status chip / Summary toggle+panel / "Save now" /
`onSaveRate` / save-error, replace the editor note with a read-only reference note; the tab strip STAYS. SheetDataGrid
was NOT touched (the spoke usage is unbroken). The key-remount discipline (3d) is unaffected. NEW types
`CommittedSheetGridResponse` + `CommittedSheetState.sheet_disposition`.

**Tests + verification.** backend `test_commit_gate` **19 -> 20** (+1 disposition surfacing); `test_pricing` **36 -> 41**
(+5 `TestGetCommittedSheetGrid` incl. the empty-config case + guards); Vitest **64 -> 68** (+4 `isGridOnlySheet`). tsc
3178, 0 in touched; Vite build exit 0. Live cert: `get_committed_sheet_grid("BOQ-26-00145","SOW",5)` -> 39 rows + empty
config. (See root CLAUDE.md `// prior:` "GENERAL-SPECS FAITHFUL-GRID READ-ONLY VIEW" + frontend CLAUDE.md `**Status
(...)**`.)


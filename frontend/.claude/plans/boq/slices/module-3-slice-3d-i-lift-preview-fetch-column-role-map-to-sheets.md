### Module 3 Slice 3d-i -- lift preview fetch + column_role_map to SheetSpokePage

**Status:** COMPLETE (feat 0c297e24 refactor + e1b39ffc docs). Frontend-only refactor. Files changed: `boqTypes.ts` (ColumnRoleEntry type added), `SheetSpokePage.tsx` (full rewrite -- new owner of preview state + columnRoleMap), `SheetDataGrid.tsx` (full rewrite -- pure render component), `SheetConfigPanel.tsx` (prop interface + handleSave updated). No .py files touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean.

**Why:** Slice 3d-ii (next) adds a Section 3 column-role list to SheetConfigPanel. Slice 3d-iii annotates the preview grid from the role-map. Both need: (a) the full preview rows, and (b) the column_role_map state -- shared across SheetConfigPanel (editor) and SheetDataGrid (annotator). Lifting both to SheetSpokePage (the common parent) gives each child access to the same live state without prop-drilling back up.

**State ownership decision (columnRoleMap):**
- **Owner:** SheetSpokePage. Seeded once from `draft.sheet_config.column_role_map` when the doc first arrives. `setRoleMapInitialized(true)` fires only after `rawCfg` is successfully parsed (draft absent → early return; JSON fail → rawCfg null → early return); a later mutate() re-fetch does NOT overwrite in-progress user edits. Seed loop handles both the current `{role,area}` object shape (3d-ii onward) and legacy role-only strings defensively (see read-back fix below).
- **SheetConfigPanel:** receives `columnRoleMap` + `setColumnRoleMap` + `rows` as props. `handleSave` (from Slice 3d-ii onward) writes `column_role_map: {role, area}` objects per column (NOT role-only strings -- 3d-i wrote strings; 3d-ii corrected the save shape). The `...existing` spread still preserves all other unknown blob keys. `setColumnRoleMap` and `rows` are accepted in the interface for Slice 3d-ii forward compat but not yet consumed in the render.
- **SheetDataGrid:** receives `columnRoleMap` as a read-only prop for Slice 3d-iii. It is in the interface and accepted in the call but not destructured in this slice (no annotation visuals yet).

**Preview fetch lift:**
- The initial load (rows 1-40) and the load-more handler were both lifted from SheetDataGrid to SheetSpokePage. SheetDataGrid is now a pure render component: no `useFrappePostCall`, no local state, no `useEffect`. It receives `rows`, `hasMore`, `isInitLoading`, `initError`, `isLoadingMore`, `loadMoreError`, and `onLoadMore` as props.
- Pagination is fully preserved: `handleLoadMore` in SheetSpokePage computes `nextStart` from the last row's `row_number` (same logic as before), appends via `setPreviewRows(prev => [...prev, ...newRows])`, and passes the handler as `onLoadMore` to SheetDataGrid.
- `useFrappePostCall` stable-ref trick (fetchRef) is preserved in SheetSpokePage.

**ColumnRoleEntry type (boqTypes.ts):**
- `interface ColumnRoleEntry { role: string; area: string | null }` -- new type for the shared lifted state.
- Backend blob stores `column_role_map: Record<string, {role, area}>` objects (3d-ii onward; earlier blobs written by 3d-i stored role-only strings and are handled defensively by the seed). Conversion: seed (`{role,area}` object OR legacy string → `ColumnRoleEntry`) in SheetSpokePage; serialize (`{role,area}` → `{role,area}` with area forced null for non-compatible roles) in SheetConfigPanel.handleSave.

**Manual test plan (3d-i specific -- run on :8080 after clear-site-data + re-login):**
1. GRID RENDER: Open a Pending sheet spoke. The SheetDataGrid must render exactly as before -- same rows, same column letters, same sticky header/gutter, same load-more button. (Proves the lift did not break the grid.)
2. LOAD MORE: On a sheet with >40 rows, click "Load next 40 rows". Must append rows, re-evaluate has_more, disable button while loading. (Proves pagination still works.)
3. CONFIG PANEL: Section 1 + Section 2 must look and behave identically. Save + hard-reload -- column_role_map (prefilled or empty) must round-trip correctly under the new explicit-write ownership.
4. SHEET NAVIGATION: Navigate to a second sheet spoke without going through the hub. Preview grid must load fresh rows for the new sheet (not reuse rows from the first sheet). (Proves the `[boqId, sheetName]` effect dependency resets state correctly.)

---


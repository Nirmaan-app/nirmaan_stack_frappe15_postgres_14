### Module 3 batched UI-fixes Part 1 -- Finding #1 + #2 + #5

**Status:** COMPLETE (feat bdf32e37 + docs this commit). Frontend-only. File changed: `SheetConfigPanel.tsx` only. No .py files, no boqTypes.ts, no SheetSpokePage.tsx touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean (exit 0, 5m build).

**Scope note (Finding #4 -- amount_combined dropdown removal):** OFF for this slice. Recon pass (same session) confirmed auto-guess CAN emit `amount_combined` (5 keyword entries in `_HEADER_KW["amount_combined"]` in classifier.py: "sitc amount", "s&i amount", "s+i amount", "supply & installation amount", "combined amount"). Removing the role from the dropdown would break pre-filled configs on SITC/S&I sheets. Finding #4 is reframed as helper-text only (a separate, future slice).

**Scope note (Finding #3 -- hub changes):** Deferred, separate slice.

**Finding #1 -- Section-1 conditional top-header subform:**

The original "Top header row(s)" free-text input (`topHeaderInput: string`) accepted comma-separated row numbers with instructions to "leave blank when adjacent". This framing inverted the default: most 2-row headers ARE adjacent, so users had to know to leave it blank. Mis-entering the adjacent row (the Alorica case) produced bad `top_header_rows_override` values.

**New design:** Yes/No segmented toggle (mirrors Section 2 Single/Multi pattern). Default = Yes (adjacent, `top_header_rows_override=null`). No = reveals a single number Input for the specific top-header row (serializes `[N]`, single-element list). Parser-check A confirmed the orchestrator reads only `top_header_rows_override[0]`, so a single-element list is the correct contract.

**State changes:**
- Removed: `topHeaderInput: string` (state + seed + save).
- Added: `topAdjacent: boolean` (default `true`); `topHeaderRowNum: string` (default `""`).
- Seed effect: if `cfg.top_header_rows_override` is a non-empty array → `topAdjacent=false`, `topHeaderRowNum=String(arr[0])`; else → `topAdjacent=true`, `topHeaderRowNum=""`.
- Save: `if (hrc === 2 && !topAdjacent && topHeaderRowNum !== "") { n = parseInt(topHeaderRowNum); if valid → topRows=[n] }`; else `topRows=[]`. `top_header_rows_override: topRows.length > 0 ? topRows : null`. Contract unchanged.
- Sparkle: toggle shows sparkle (on Label) when `!topAdjacent` (non-default prefilled). Number input shows sparkle when `topHeaderRowNum !== ""`. Clicking Yes clears `topHeaderRowNum` and removes sparkle. Clicking No does not clear (user may want to keep their custom row number). Adjacent hint `"Top header will be row N-1"` shown as helper text when topAdjacent=true and headerRowNum is known.

**Finding #2 -- Data-start-row restyle:**

The prior display was a `<p>` with `rounded-md border border-border bg-muted/30 px-3 py-2` chrome -- visually indistinguishable from an input box at a glance. Replaced with a single plain `<p className="text-xs text-muted-foreground">` sentence: "Data starts at row **N** (derived from header row + row count)". No Label, no box, no separate helper text. Derivation is unchanged (`headerRowNum + hrc`).

**Finding #5 -- Section-3 save-time unmapped-column warning:**

At Section-3 save, `handleSave` scans `allColumns` (the `useMemo` over loaded `rows` prop -- no new fetch) for columns where: (a) no entry in `columnRoleMap`, or entry with empty role; AND (b) at least one loaded preview row has a non-null, non-empty-string value in that column. For each match, records `{col, exampleRow}`. Sets `unmappedWarnings` state. Save proceeds regardless.

Warning renders as an amber callout block above the Save button (appears after first save attempt). Lists each column + first data row with that column's data. "Assign roles above to include these columns, then save again." Non-blocking: user can ignore and save is already done.

**Accepted limitation:** Preview-rows-only scope. If preview did not load (rows=[]) or a column's data starts beyond row 40+, the warning does not fire. This is acceptable per Findings_v2 -- the dim-unmapped visual in SheetDataGrid (Slice 3d-iii) covers the full sheet.

**Manual test plan (Part 1 -- restart Vite + hard-reload :8080 before testing):**
1. **FINDING #1 - YES default:** Open a double-header sheet. Section 1 shows Yes/No toggle, default Yes. Helper text shows "Top header will be row N-1". Save -- verify `top_header_rows_override: null` in the saved blob (check DevTools or the DB).
2. **FINDING #1 - NO path:** Click "No -- specify row". Row input appears. Enter a row number. Save -- verify `top_header_rows_override: [N]` in blob.
3. **FINDING #1 - prefill from auto-guess:** Load a sheet where auto-guess set `top_header_rows_override=[5]`. Toggle should show "No -- specify row" selected (dimmed/sparkle). Row input shows "5" (dimmed). Click the input -- sparkle clears.
4. **FINDING #1 - single-header:** Switch Header type to Single (1 row). Top-header toggle disappears entirely.
5. **FINDING #2 - restyle:** Data start row is now plain inline text "Data starts at row N (derived...)". No box chrome. Visually distinct from all editable inputs above it.
6. **FINDING #5 - warning fires:** Map only some columns (leave one with data unmapped). Save -- amber warning block appears listing the unmapped column + row. Save button is not disabled and save completed normally.
7. **FINDING #5 - warning clears on next save:** Map the previously unmapped column. Save again -- warning disappears (or shows only remaining unmapped columns).
8. **FINDING #5 - no false positive on empty column:** A column that appears in the header row but has no data in preview rows (all null) should NOT trigger a warning.
9. **REGRESSION:** Section 1 single-row header, data start row display, Section 2 areas, Section 3 role mapping, and sparkle behavior on all other fields unaffected.

---


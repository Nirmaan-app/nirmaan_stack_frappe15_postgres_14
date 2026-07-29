### Module 3 Slice 3d-ii -- Section 3 column-role list + {role,area} save shape fix

**Status:** COMPLETE (feat f24ac4fe + docs 71d05d1d). Frontend-only. Files changed: `SheetConfigPanel.tsx` (Section 3 UI + cross-section reactivity + handleSave shape fix), `boqTypes.ts` (ColumnRoleEntry comment corrected). No .py files touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean.

**handleSave shape correction (over 3d-i):** 3d-i wrote `column_role_map: Record<string,string>` (role only). The parser contract is `dict[col -> {role, area}]` (objects). 3d-ii changes `handleSave` to write `{role, area}` per column. Non-area-compatible roles always get `area: null`. Entries with empty role (uncommitted pending rows) are excluded from the saved map.

**Role vocabulary (21 roles, qty_by_area excluded):**
- Structural: `sl_no`, `description`, `unit`
- Quantity: `qty`, `qty_total`
- Rate: `rate_supply`, `rate_install`, `rate_combined`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`
- Amount: `amount_supply`, `amount_install`, `amount_total`, `amount_combined`, `amount_by_area`
- Notes: `make_model`, `row_notes`, `append_to_notes`, `reference_images`
- Ignore: `ignore`

**Area-compatible roles (8):** `qty`, `amount_supply`, `amount_install`, `amount_total`, `amount_by_area`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Area dropdown shown only when role is one of these AND sheet is multi-area (Section 2 `isMulti`) AND at least one non-empty area box exists.

**Area-required roles (4, the *_by_area group):** `amount_by_area`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Empty area flagged with `border-destructive` on the area Select trigger + "— required —" placeholder.

**Singleton roles (12):** `sl_no`, `description`, `unit`, `qty_total`, `rate_supply`, `rate_install`, `rate_combined`, `amount_total`, `amount_combined`, `make_model`, `row_notes`, `reference_images`. Enforcement: disabled in other rows' **role** dropdowns when already used. `usedSingletons` Map (role → col) derived from `columnRoleMap` via useMemo. Note: this is role-level uniqueness only -- does NOT cover area-pair uniqueness (see below).

**Per-(role, area) pair uniqueness (area-compatible roles):** The parser enforces that within a sheet, each (role, area) pair may appear on at most ONE column -- e.g. two columns cannot both be `qty` + "Zone A". `qty` + "Zone A" and `qty` + "Zone B" is valid (different areas); `qty` + "Zone A" twice is invalid. Enforced in the **area** dropdown: for each area option A in a given row with role R, A is disabled if another column already holds (R, A). The current row's own selection is never disabled (it must remain selectable). Distinct from singleton enforcement: `qty` is NOT a singleton; this is pair-uniqueness only. `usedAreaPairs` Map (`"role|area"` → col) derived from `columnRoleMap` via useMemo alongside `usedSingletons`. Applies to all 8 area-compatible roles. The `"__none__"` sentinel option is unaffected.

**State representation:**
- `columnRoleMap` (lifted prop from SheetSpokePage): the persisted source. Mapped rows display derives from `sortedMappedCols = sortColLetters(Object.keys(columnRoleMap))`.
- `pendingRows: string[]` (local): transient rows without a column letter. Each element is a unique string ID (from `pendingIdRef`). On column selection → `commitPendingRow(id, col)` removes from pendingRows, adds `{role: "", area: null}` to columnRoleMap. Role and area shown only after column chosen.
- Column picker for pending rows uses `value=""` (uncontrolled placeholder). Mapped row pickers use the committed column as `value`.

**Column picker header text:** Derives from the BOTTOM header row (`headerRowNum` = the `headerRow` S1 field). `getColumnLabel(col)` returns `"C — Description of Work"` when the header cell has text, or just `"C"` otherwise. For 2-row headers, shows the bottom row text only (the primary parser label row). The column picker disables already-mapped columns in other rows' pickers (one row per column constraint).

**Cross-section area reactivity:** `useEffect([validAreas])` — when Section 2 `areaBoxes` changes, any `columnRoleMap` area value no longer in `validAreas` is cleared to null via functional `setColumnRoleMap`. "column_role_map" removed from `confirmedFields` (re-sparkle) so user knows re-assignment is needed. Dependencies: `[validAreas]` only (intentional — reads `columnRoleMap` from outer scope with eslint-disable; functional update handles safety).

**Sparkle/confirm:** Single key `"column_role_map"`. Cleared (`touch("column_role_map")`) on any Section 3 interaction. Seeded unconfirmed (like all fields) on first load. Re-marked confirmed after Save. Cross-section reconciliation re-removes the key.

**Area dropdown sentinel:** `value="__none__"` maps to `area: null`. Options: `<SelectItem value="__none__">Any area / — required —</SelectItem>` first, then active area names. `changeArea(col, "__none__")` → `area: null`.

**handleSave non-area guard:** `AREA_COMPATIBLE_ROLES.has(entry.role) ? entry.area : null`. Ensures non-compatible roles (13 of 21) never write a non-null area to the blob.

**Manual test plan (3d-ii specific -- run on :8080):**
1. ADD + MAP: open a spoke. Section 3 shows below Section 2. Click "+ Add column mapping" → pending row with column picker. Pick a column → role dropdown appears. Pick a role, save, hard-reload → mapping persists and re-displays.
2. AREA CONDITIONAL: on a multi-area sheet, set role to "Quantity" → area dropdown appears with Section 2 area names. Switch to "Description" → area dropdown disappears. Set to a *_by_area role → area is required (border-destructive + "— required —" placeholder).
3. SINGLETON: map a column as "Description". Add another row → "Description" is disabled in its role dropdown.
4. CROSS-SECTION REACTIVITY: map a column with area "Zone A". Go to Section 2, remove/rename "Zone A". The Section 3 row's area clears and it re-sparkles. Save, reload → consistent.
5. OBJECT SHAPE: map qty with area "Zone A", save, hard-reload → area persists (proves {role,area} save-shape fix over 3d-i which dropped area).
6. PREFILL + SPARKLE: a sheet with existing column_role_map shows those rows prefilled with sparkle; any interaction clears it.

---


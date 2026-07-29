## Classifier module -- CL-3 (classify verdict picker: click-to-edit human verdict) COMPLETE

Frontend click-to-edit for the Category column + one read-only backend endpoint (the category catalog), on `feature/boq-phase-5` (one feat commit + this docs commit). Additive: `set_row_category` / `get_sheet_categories` contracts unchanged (CALLED, not edited), `list_engines`' shape untouched, the row memo intact. No doctype change (no migrate). The two-engine overlap-conflict fork stays PARKED.

**Backend (read-only add):**
- `classify.get_category_catalog(discipline="Electrical")` -> `{discipline, categories:[{id,label}]}` from `load_ruleset` (labels = `categories_<disc>.json` name, id fallback). Engine-scoped (unavailable engine throws). Drives the picker + the Category-column label. `test_classify` +1 catalog test (22 -> 23).

**Frontend (`frontend/src/pages/boq-wizard/`):**
- **`boqTypes.ts`** -- `CategoryCatalogEntry` / `EngineCatalog`.
- **`CategoryVerdictPicker.tsx` (new)** -- a Radix Popover anchored to the clicked grid cell (external `virtualRef`); categories GROUPED BY the engine(s) that ran (engine-scoped, NOT all-15; v1 = one Electrical group), each its own catalog; a "Clear verdict (use machine answer)" action -> `onSelect("")`; closes on select/clear/escape/outside. Pure vitest helpers: `deriveVerdictState` (unclassified/auto/needs_review/human), `isRowEditable` (classified-only), `labelFor` (id fallback), `buildEngineGroups` (filter to run disciplines). + `CategoryVerdictPicker.test.ts` (17).
- **`PricingGrid.tsx`** -- the Category cell is now CLICK-TO-EDIT: click + Enter (on the focused cell, colIndex `FIXED_ANCHOR_COUNT`) open the picker via a REFERENCE-STABLE page-owned `onCategoryClick(excelRow, cellEl)` callback -- **open-state is NOT a per-row prop** (row memo untouched; `onCategoryClick` + `categoryLabelById` compared by identity, two comparator lines). Only classified rows editable. The cell shows the human-readable LABEL (`labelFor`, id fallback) + 3 visual states (`deriveVerdictState`: auto / amber needs-review / emerald "your pick" human). Nav matrix unchanged.
- **`SheetPricingPage.tsx`** -- `get_category_catalog` fetch -> `categoryLabelById` + `engineCatalogs`; page-owned `pickerState` + one anchored `CategoryVerdictPicker`; `set_row_category` on select/clear with an OPTIMISTIC `categoryOverrides` patch folded into the reference-stable `categoriesByExcelRow` map + `mutateCategories` reconcile + revert-on-error (inline error strip -- no toast exists in this editor). Needs-review filter UNCHANGED (a human verdict auto-drops the row via `isNeedsReviewCategory`).

**Gates (in-container):** `tsc --noEmit` clean for all CL-3 files (pre-existing unrelated errors remain); `vitest` 214 passed (17 new picker + 21 dialog + 131 grid + 45 priceability); `yarn build` exit 0. Backend `test_classify` 23 green.

**Manual verification (owner -- full CL-1..CL-3 pass):** restart bench workers (backend changed -- the catalog endpoint). On a committed NBoQ Electrical sheet: run Classify sheet -> click a needs-review row's Category cell -> pick a category -> cell shows the human verdict (emerald "your pick") + the row drops from the needs-review filter -> click again -> Clear -> reverts to the machine verdict. Plus the CL-2 flow (button/progress/summary/column/filter) + the arrow-nav-into-Category-cell glance.


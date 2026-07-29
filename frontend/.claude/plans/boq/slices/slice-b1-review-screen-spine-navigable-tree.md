### Slice B1 -- review screen spine (navigable tree)

**Status:** COMPLETE (feat 0683f7b9; frontend + backend endpoint + tests; +3 wizard tests; 37 total review-screen tests, 205 total wizard tests).

**What landed:**

*Backend:*
- `get_structural_breaks(boq_name, sheet_name)` -- new `@frappe.whitelist()` read-only endpoint in `review_screen.py`. Fetches minimal row fields, calls `check_structural_integrity`, returns `{"breaks": [...]}`. Does NOT write, does NOT change `wizard_status`. Dedicated read contract for B2 flag overlay (avoids coupling to `mark_sheet_parsed_check_done` side-channel).
- 3 new tests in `TestGetStructuralBreaks`: (a) orphan sheet returns break of type orphan with correct `row_index`/`source_row_number`; (b) clean sheet returns `{"breaks": []}`; (c) call does not mutate `wizard_status`.

*Frontend:*
- `boqTypes.ts`: `"Parsed Check Done"` added to `WizardStatus` union. New types: `EditLogEntry`, `ReviewRow` (all BoQ Review Row fields + `effective_classification`/`effective_parent_index`), `GetReviewRowsResponse`, `StructuralBreakOrphan`, `StructuralBreakLineItemAsParent`, `StructuralBreakCycle`, `StructuralBreak` (discriminated union), `GetStructuralBreaksResponse`.
- `SheetCard.tsx`: `"Parsed Check Done"` entry in `STATUS_PILL` (teal-600, label "Checked"). New `onOpenReview?: (sheetName) => void` prop. "Parsed Check Done" action branch: "Review" button (calls `onOpenReview`) + `last_parsed_at` display.
- `routesConfig.tsx`: new lazy route `/upload-boq/hub/:boqId/review/:sheetName` -> `SheetReviewPage`.
- `BoqHubPage.tsx`: `handleOpenReview` callback (navigates to review route, same encode convention as `handleOpenSpoke`). `reviewableDrafts` derived list (Parsed + Parsed Check Done). "Review parsed sheets" section (shown when `reviewableDrafts.length > 0`): grid list of reviewable sheets with soft status pills + "Review" buttons. `parsedCheckDoneCount` in footer breakdown. `onOpenReview={handleOpenReview}` passed to all `SheetCard` instances.
- `ReviewTree.tsx` (new): pure render component. `computeDepths` -- iterative memoised chain-walk, cycle-safe (visited set, assigns depth 0 to cycle members). Expand/collapse via `Set<number>` of collapsed `row_index` values; `isVisible` walks parent chain (capped at 60 hops). Columns: source_row_number, description (with indent + toggle + classification badge), unit, qty_total, rate_combined/rate_supply fallback, amount_total. Preambles tinted bg-muted/20 + font-medium; line_items normal; others italic/muted. `INDENT_PX = 20` per depth level. No flag overlays (B2), no row-detail (B2), no edit affordances (C).
- `SheetReviewPage.tsx` (new): mirrors `SheetSpokePage` shell. `useParams<{boqId,sheetName}>`. `useFrappeGetDoc<BOQsDoc>` for header. `useFrappeGetCall<{message:GetReviewRowsResponse}>` for review rows (SWR-managed, disabled until both params present). Full-page spinner while BOQ doc loads; inline loading/error for rows. Back nav: `navigate(/upload-boq/hub/${boqId})`. Exports `{ SheetReviewPage as Component }` for RR v6 lazy.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `get_structural_breaks` endpoint added (no existing code modified).
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `get_structural_breaks` import added; `TestGetStructuralBreaks` class (3 tests) appended.
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- `WizardStatus` + 8 new types.
- `frontend/src/pages/boq-wizard/SheetCard.tsx` -- STATUS_PILL + prop + action branch.
- `frontend/src/components/helpers/routesConfig.tsx` -- review route.
- `frontend/src/pages/boq-wizard/BoqHubPage.tsx` -- review section + handler + card prop.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- NEW FILE.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- NEW FILE.

**Test counts:**
- `test_review_screen`: 37 tests (was 34, +3 `TestGetStructuralBreaks`).
- Total wizard: 205 (60 + 37 + 66 + 7 + 23 + 12).

**tsc:** 0 errors on boq-wizard files. Vite build exit 0.

---


### Module 3 batched UI-fixes Part 2 -- Finding #3

**Status:** COMPLETE (feat 2f8bf533). Frontend-only. Files changed: `BoqHubPage.tsx` + `boqTypes.ts`. No .py files, no SheetConfigPanel.tsx, no SheetSpokePage.tsx, no SheetDataGrid.tsx touched. Parser tests 588 unchanged. tsc: 0 errors. Vite build: confirmed clean (run in Docker).

**Finding #3 -- Hub "back to project" semantic route:**

The hub page had no "back to project" button at all (it was never implemented). The task framed it as "currently relies on browser history" -- the actual state was the button was absent. Implementing it with semantic routing from the start avoids the history.back() trap (misfires on hard refresh / direct URL with no history stack).

**Recon findings:**
- `boq.project` is present on the Frappe BOQs doctype (confirmed via boqs.json field at position 11/37) but was absent from the `BOQsDoc` TypeScript interface in `boqTypes.ts`. Added `project?: string` to the interface.
- The existing `useFrappeGetDoc("BOQs", boqId)` already returns `project` at runtime -- no new fetch needed.
- Canonical in-project BoQ tab route: `/projects/${projectId}?page=boq` (from CLAUDE.md M1.5 + pmo-project-detail.tsx precedent for page param).

**Implementation:**
- `boqTypes.ts`: Added `project?: string` to `BOQsDoc`.
- `BoqHubPage.tsx`: Added `ArrowLeft` to lucide import. Added conditional "Back to project" button above the header strip: renders only when `boq.project` is set (graceful for orphan BoQs), navigates to `/projects/${boq.project}?page=boq`. Uses `Button variant="ghost" size="sm"` + `-ml-2` offset, matching the panel's ghost-button style.

**Navigation convention (applies to future hub/spoke back-buttons):** All back-navigation in the BoQ wizard routes by entity ID -- never `navigate(-1)` or `window.history.back()`. Reason: wizard pages are accessible via direct URL (the hub at `/upload-boq/hub/:boqId` and spoke at `.../sheet/:sheetName`) with no guaranteed history stack.

**Manual test plan (Part 2 -- restart Vite + hard-reload :8080 before testing):**
1. Navigate directly (fresh tab) to `/upload-boq/hub/BOQ-26-XXXXX`. Confirm "Back to project" button appears above the BoQ title. Click it -- lands on the project page at the BoQ tab (`?page=boq` in URL).
2. **Graceful absent project:** If a BoQ exists with no `project` field (edge case), the button should not render. (Verify by checking the conditional: `{boq.project && ...}`.)
3. **Hard refresh on hub:** Refresh the hub page. Button still present and navigates correctly -- no history required.
4. **REGRESSION:** Spoke back button (returns to hub), status pills, general-specs selector, parse gate footer all unaffected.

---


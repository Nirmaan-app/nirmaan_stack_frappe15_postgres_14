# BoQ Frontend — Hub

> Hub route and back-navigation, hub cards and button set, general-specs derivation, ParseRunDialog, dirty-marker fields, hub visual conventions.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- BoQ in-project list conventions (2026-06-01)
- Hub route (Module 2b, feat 81568df9)
- Back-navigation convention (hub/spoke, Part 2 feat 2f8bf533)
- Hub components in `src/pages/boq-wizard/`
- Mutation pattern (first wizard use of useFrappePostCall, feat 459f85ae)
- Per-card saving convention
- Hub button set (per effective status)
- General-specs derivation rule (M2.16) -- CRITICAL (Slice 2c updated)
- EXACT sheet_name constraint (verified 2026-05-31)
- M2.23 general-specs confirm flow (Slice 2b-frontend-ii -- combined multi-warning)
- Hub parse-gate (M2.11/M2.12)
- ParseRunDialog.tsx (Slice 2b-frontend-i) -- the hub's parse confirm UX
- Checkbox-checklist pattern (wizard convention, Slice 2b-frontend-i + 2b-frontend-ii)
- Dirty-marker / parse-history fields (Slice 2b-backend + 2b-frontend-i)
- Hub visual conventions (Module 2b-iii, feat 57152c52)

---

**BoQ in-project list conventions (2026-06-01):**
- `BoqProjectTab` is the canonical in-project BoQ list component (and also reused as the **BOQs tab** on the Tendering project view -- see Tendering tabbed-view conventions below).
- Data: single `useFrappeGetDocList("BOQs", { fields: [...], filters: [["project","=",projectId]], orderBy: {field:"uploaded_at",order:"desc"}, limit:50 }, projectId ? \`boq-list-${projectId}\` : null)`. The third arg is the swrKey; passing `null` disables the fetch until projectId is available (standard SDK gotcha -- see useFrappeGetDoc swrKey note above).
- Status display: `wizard_state` Select field on BOQs -- ""/blank -> "Not started", "In progress", "Configured", "Parsed". No child-table reads; no sheet_drafts computation.
- Row navigation: `onClick` on `TableRow` -> `navigate(\`/upload-boq/hub/${row.name}\`)`. boqId = `row.name` (BOQs docname from Frappe autoname). Hub route: `upload-boq/hub/:boqId` (routesConfig.tsx).
- Date: `formatDate(row.uploaded_at || row.creation)` -- `uploaded_at` is the primary field; falls back to Frappe built-in `creation` for pre-M1 docs.
- UI: shadcn `Table` + `Skeleton` (mirrors ProjectTransferMemosTab), NOT TanStack/DataTable.
- BoqProjectTab is reused verbatim as the **BOQs tab** of `TenderingProjectView` (feat: tendering-project-tabs, 2026-06-16). Passed as `projectId={data.name}` where `data` is the Projects doc -- no transform.

**Tendering tabbed-view conventions (feat: tendering-project-tabs, 2026-06-16) -- `projects.tsx` + `tendering/TenderingProjectView.tsx` + `tendering/TenderingOverviewTab.tsx` + `data/root/useProjectRootApi.ts`:**
- **Admin Options -> Project Options tab rename + counts (`projects.tsx`):** the two shadcn `<Tabs>` triggers are now **"Won Projects"** (was "Projects") and **"Tendering Projects"** (was "Tendering"), each with a `bg-primary/10 text-primary` count chip. Won count reuses `useAllProjectsCount()` (`tendering_status="Won"`); tendering count is the NEW `useTenderingProjectsCount()` (`tendering_status="Tendering"` ONLY -- Lost excluded; it has its own sub-tab). Both are static `useFrappeGetDocCount` queries (NOT the table `totalCount`, which moves with in-table search) so the badges reflect the universe, not the current view. Chips show the number always (incl. `0`).
- **`TenderingProjectView` is now a tabbed shell** (rendered by `project.tsx` whenever `tendering_status !== "Won"`). It mirrors the won-project detail page: a custom button tab-bar (active `bg-[#D03B45] text-white`, identical to `project.tsx`) synced to the `?page=` URL param via `urlStateManager` + `getUrlStringParam` (same global-store pattern as `project.tsx`, NOT `useSearchParams`). Two tabs: `overview` / `boq`. Shell header = back button + project name + mono ID (the status badge/banner/actions live INSIDE the Overview tab -- owner decision -- so the BOQs tab still has identity context). `?page=boq` deep-links behave identically to the won page.
- **`TenderingOverviewTab` = the stub Overview body** (NEW). Styled to match `ProjectOverviewTab`'s "Project Details" card (shadcn Card + label/value grid using `CardDescription`), capped at `max-w-4xl mx-auto` so the sparse stub doesn't stretch thin. Shows only stub fields (Customer, Location=city+state, Created) in a 3-col grid that fills exactly one row; the tendering_status badge + Edit/Delete sit in the card header; the gradient banner (slate=Tendering / rose=Lost) sits above the card and EXPLAINS the minimalism; the Convert-to-Won (indigo) + Mark-as-Lost (rose-outline) action block + the inline `TenderingProjectForm` edit mode + the two confirm `AlertDialog`s all moved here verbatim from the old single-scroll `TenderingProjectView`. Lost stubs are read-only (Delete only). All tendering actions stay gated by `canManageTendering`.

**Hub route (Module 2b, feat 81568df9):** `/upload-boq/hub/:boqId` -- reads boqId
from URL param (survives refresh; not from the transient store). Module export:
`export { BoqHubPage as Component }` for React Router v6 lazy().

**Back-navigation convention (hub/spoke, Part 2 feat 2f8bf533):** All back-navigation buttons in the BoQ wizard route by entity ID -- never `navigate(-1)` or `window.history.back()`. Both the hub (`/upload-boq/hub/:boqId`) and spoke (`/upload-boq/hub/:boqId/sheet/:sheetName`) are accessible via direct URL with no guaranteed history stack, so history-based back misfires on hard refresh or deep link. Hub's "Back to project" uses `navigate(\`/projects/${boq.project}?page=boq\`)` -- routes to the project's BoQ tab by the BoQ doc's `project` field. Spoke's back button uses `navigate(\`/upload-boq/hub/${boqId}\`)` -- same principle. Apply this pattern to any future back-button added to a wizard route.

**Hub components in `src/pages/boq-wizard/`:**
- `boqTypes.ts` -- shared types: `BOQsDoc` + `BoQSheetDraft` + `WizardStatus` +
  `BoQSheetWorkPackage` + `BoQGeneralSpecsSheetRow` (Slice 2c). Both `BoqUploadScreen`
  and `BoqHubPage` import from here -- do not duplicate the type.
  Current `BoQSheetDraft` shape (feat ba4fb738 + Slice 2b-backend):
  `{ name, sheet_name, sheet_order, wizard_status, work_packages?: BoQSheetWorkPackage[], sheet_label?, sheet_config?, has_prior_parse?: 0 | 1, last_parsed_at?: string | null }`.
  `BoQSheetWorkPackage = { name: string; work_header: string }` (mirrors the backend child
  doctype "BoQ Sheet Work Package", field `work_header` Link -> "Work Headers").
  NOTE: `work_package` (singular string) is GONE -- it was the pre-3a legacy field. The
  array `work_packages` replaced it (feat b14e9015 backend, ba4fb738 frontend).
  `BoQGeneralSpecsSheetRow = { name: string; source_sheet_name: string; preamble_text?: string }`.
  `BOQsDoc.general_specs_sheet?: string` is GONE (Slice 2c). Replaced by
  `BOQsDoc.general_specs_sheets?: BoQGeneralSpecsSheetRow[]`. This is a FIRST-LEVEL child
  table on BOQs (not a grandchild like work_packages), so it SERIALIZES directly on the
  parent via `useFrappeGetDoc("BOQs", ...)` -- no focused read endpoint needed.
- `BoqHubPage.tsx` -- hub page with wired interactions (2b-ii). Four regions: header
  strip, general-specs selector, sheet-card list, parse-gate footer.
- `SheetCard.tsx` -- sheet card with status pill, summary line, per-card saving state,
  inline error, and status-dependent action buttons (2b-ii). Summary-line priority:
  `sheet_label > work_packages (comma-joined work_header values) > keyword hint`.
  `isKeywordHint` tests `!(work_packages?.length)` (feat ba4fb738).

**Mutation pattern (first wizard use of useFrappePostCall, feat 459f85ae):**
```typescript
const { call, loading } = useFrappePostCall("nirmaan_stack.api.boq.wizard.update_sheet_draft.<fn>");
await call({ boq_name, sheet_name, ... });  // throws on error
void mutate();  // SWR re-fetch from useFrappeGetDoc -- server is authoritative
```
`useFrappePostCall` is now the standard for JSON endpoint mutations in the wizard.
Raw `fetch` is kept ONLY for file upload (multipart FormData). Do NOT use raw fetch
for JSON endpoints; use `useFrappePostCall` + `mutate()`.

**Per-card saving convention:**
- `isSaving = statusLoading || labelLoading` from the card's own `useFrappePostCall` hooks.
- While saving: spinner + ALL buttons on that card disabled. Other cards stay interactive.
- On failure: inline `<p className="text-xs text-destructive">...</p>` on the card.
  No toasts -- inline error is the wizard convention throughout.

**Hub button set (per effective status):**
- Pending: [Review -- stub M3] [Skip] [Mark reviewed -- interim until M3]
- Reviewed: [Edit -- stub M3] [Set pending]
- Skip: [Edit label] [Include]
- Hidden: [Include]
- Parse failed: [Review -- stub M3] [Mark reviewed -- interim] [Skip]
- Parsed: [Edit -- navigates to per-sheet spoke] (fix 24312cab; single button only; no re-parse button -- deferred to Slice 2b)
- General specs: hint text only (checklist governs designation, no per-card status buttons)
- "Review" / "Edit" stubs: `onClick` no-op, Tooltip "Per-sheet configuration opens
  in Module 3 (coming next)". DO NOT navigate from these buttons.
- "Mark reviewed" + "Set pending": deliberately wired so parse gate is testable
  without the Module 3 spoke. Clearly labeled; they call `set_sheet_status` directly.
- Discard BoQ (header menu): still disabled/stubbed -- destructive, separate slice.
- Parse workbook (footer): WIRED (Slice 2b-frontend-i, feat c9fc37fd) to the run_parse endpoint via ParseRunDialog confirm; triggers the parse-run (assemble_mapping_config -> parse_boq() -> per-sheet BoQ Review Rows). NOT the Module-5 DB-commit / deliberate-parse-to-BOQ-Nodes pass, which is still not built.

**General-specs derivation rule (M2.16) -- CRITICAL (Slice 2c updated):**
The "General specs" display badge on a card is DERIVED from set membership in
`BOQs.general_specs_sheets` child array, NOT from `BoQSheetDraft.wizard_status`.
The backend NEVER writes "General specs" to `wizard_status` (see backend CLAUDE.md).
Do NOT write "General specs" to `wizard_status` in frontend code either.
The derivation logic (Slice 2c): build `generalSpecsSheetNames = new Set(boq.general_specs_sheets
.map(r => r.source_sheet_name))`; return "General specs" if `generalSpecsSheetNames.has(draft.sheet_name)`.
EXACT match -- sheet_name verbatim, no trimming. The old scalar `BOQs.general_specs_sheet`
was removed in Slice 2c; do NOT reference it. `general_specs_sheets` serializes on the
BOQs parent (first-level child) -- no focused read endpoint needed.
Multi-select CHECKLIST hub control (Slice 2b-frontend-ii, feat d1672c6f): candidate set = `nonHiddenDrafts` (backend rejects Hidden sheets server-side; never offer them). Ticked set seeded from `generalSpecsSheetNames`; re-synced on `boq` change via `useEffect([boq])`. Save sends the full ticked set as `sheet_names: string[]` to `set_general_specs_sheet` (list API, Slice 2b-backend-3, feat e996d097). The old `Select` + `NONE_SENTINEL` + `generalSpecsValue` single-select code is REMOVED. Set-membership derivation (above) is UNCHANGED.

**EXACT sheet_name constraint (verified 2026-05-31):**
`sheet_name` is stored and matched VERBATIM by the backend -- Frappe does NOT strip
whitespace from BoQ Sheet Draft Data fields. "  Electrical (Rev-2) " is stored as-is.
Rules: (1) use `draft.sheet_name` as-is for React keys and in every endpoint call;
(2) trim ONLY for visual display (e.g. card label text); (3) each call site in hub
code has a comment noting the exact-match requirement.

**M2.23 general-specs confirm flow (Slice 2b-frontend-ii -- combined multi-warning):**
ONE combined AlertDialog fires on Save when the ticked set NEWLY designates one or more Reviewed sheets. Names the affected sheets (1 sheet -> names it directly; 2+ -> lists them). Continue -> commits the full ticked list via `set_general_specs_sheet({ sheet_names: string[] })`; Cancel -> no write, checklist stays at current local ticks (not auto-reverted -- unlike the old controlled Select). Un-designating never warns; non-Reviewed new designations never warn. Designation NEVER calls `set_sheet_status` (M2.23 UNCHANGED: released sheets revert to their TRUE prior `wizard_status`).

**Hub parse-gate (M2.11/M2.12):** Enabled when `blockingCount === 0 && reviewedCount >= 1`.
Blocking = effective status is "Pending" or "Parse failed" on data sheets (non-hidden,
non-skip, non-general-specs). Parse workbook button is WIRED (Slice 2b-frontend-i) -- opens `ParseRunDialog` on click.

**ParseRunDialog.tsx (Slice 2b-frontend-i) -- the hub's parse confirm UX:** A FOUR-LIST summary Dialog: (1) "Will parse" -- Reviewed sheets, each a `Checkbox`, all ticked by default; (2) Skipped/Hidden -- informational; (3) Pending/parse-failed -- informational; (4) Already Parsed -- informational with `last_parsed_at`. The ticked subset is passed to `run_parse` as `sheet_names`. A two-step warn-before-reparse fires (within the same Dialog, `step` state 1 -> 2) when the ticked set includes any sheet with `has_prior_parse === 1`. This is the REFERENCE checklist component -- mirror its `useState<Set<string>>` + `toggleSheet` + Checkbox-per-row pattern for any future wizard multi-select UI. **Background note (Bucket-2 follow-up, feat 295e3881):** Both Step 1 and Step 2 show a bold-amber "runs in background ~10 min" note (`text-sm font-semibold text-amber-600 dark:text-amber-400`) -- Step 1 below the DialogDescription, Step 2 below the sheet list before the footer buttons. Reuses the existing wizard amber token (same as Section-3 unmapped-column warning). Copy: "This runs in the background and can take up to ~10 minutes. You can keep working; you'll see a summary here when it's done."

**Checkbox-checklist pattern (wizard convention, Slice 2b-frontend-i + 2b-frontend-ii):** `useState<Set<string>>` for the ticked set + a `toggleX` functional updater (`next = new Set(prev); has? delete : add`) + `Checkbox` from `@/components/ui/checkbox` (`checked` + `onCheckedChange`) + `<label htmlFor>` per row. Seed/reset in a `useEffect` keyed on the relevant trigger (`[open]` for a dialog, `[boq]` for the hub checklist). ParseRunDialog seeds = all Reviewed drafts, resets on `open` change; general-specs checklist seeds = `generalSpecsSheetNames`, resets on `boq` change so `mutate()` re-syncs after Save.

**Dirty-marker / parse-history fields (Slice 2b-backend + 2b-frontend-i):** `has_prior_parse: 0 | 1` and `last_parsed_at?: string | null` live on `BoQSheetDraft` (typed in `boqTypes.ts`). A Reviewed sheet with `has_prior_parse === 1` is DIRTY -- config changed since last parse, so re-parsing discards prior `BoQ Review Row` output. Frontend dirty test: `effectiveStatus === "Reviewed" && draft.has_prior_parse === 1`. `SheetCard` shows an amber "needs re-parse" badge next to the status pill on dirty Reviewed cards; Parsed cards display `last_parsed_at` via `formatDate`. The backend owns the dirty-drop (set_sheet_config drops Parsed -> Reviewed on a config change -- see backend CLAUDE.md); the frontend reads these fields but never writes them.

**Hub visual conventions (Module 2b-iii, feat 57152c52):**
- **Card list layout:** `grid grid-cols-1 sm:grid-cols-2 gap-3` for both the main card list
  and the hidden-sheets reveal section. Use the same grid if adding more card lists.
- **Status pills:** Solid saturated backgrounds with white text, `text-sm font-medium`,
  rounded-full, dark: variants for all 7 wizard_status values (incl. "Parsed", fix 24312cab).
  ONE central `STATUS_PILL` map in `SheetCard.tsx` -- do not scatter pill colors. Template:
  `bg-<color>-500 text-white dark:bg-<color>-600 dark:text-white` (most entries);
  "Parsed" uses `bg-green-600` / `dark:bg-green-700` (one shade darker, distinct from
  "Reviewed" emerald). "Parsed" entry must NOT fall back to the Pending pill.
- **Likely-skip keyword hint:** `isKeywordHint` flag (no label, no work_packages + keyword match).
  Rendered with `AlertTriangle` (lucide-react, `h-3 w-3`, amber) + amber text
  (`text-amber-600 dark:text-amber-400 font-medium`). Presentation-only; never changes data.
- **Footer breakdown pattern:** Lead with data-sheet progress (`N of M data sheets reviewed`),
  then append only non-zero counts: `· N parsed` (Bucket-1, feat f5dcfdd6), `· K general specs`,
  `· S skipped`, `· H hidden`. Each is a conditional fragment (`count > 0 && " · N label"`).
  Derive all counts from `getEffectiveStatus` -- same source as the gate. Do not change gate math.
  `parsedCount` filters `dataSheets` (not `allDrafts`) because Parsed sheets are data sheets;
  `generalSpecsCount`/`skippedCount` filter `allDrafts` (they are set-aside from the data pool).
- **General-specs checklist layout:** `grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2`
  (Bucket-1, feat f5dcfdd6). Matches the hub card-grid responsive pattern.

**Spoke section-grouping convention (Bucket-1 Option B, feat f5dcfdd6; boxed zones follow-up feat 1ec901e7; config-screen redesign "Option A" -- unified zones + coverage lifted above Section 4 + footer panel):**

SheetConfigPanel's four sections are grouped into two visually distinct boxed zones inside the outer `space-y-5` card div. The spoke page-root is `max-w-6xl mx-auto pt-6 pb-10` with NO extra `px-4` -- the parent `<main>` already applies `px-4 sm:px-6`, so the redundant inner padding (which produced the white side-gutters) was removed.
- **Zone A -- "Parsing configuration":** wraps Sections 1 (Rows), 2 (Areas / Zones), 3 (Column Roles). Caption: `<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Parsing configuration -- changes here require re-parsing</p>`. Container: `<div className="rounded-md border border-border p-3">` (untinted primary zone). Within-zone section dividers (`pt-3 border-t border-border` on Sections 2 and 3) are kept as within-group separators inside the box. **Sections 2 & 3 now carry a titled header block** -- the `<h3>` ("Section 2 -- Areas / Zones", "Section 3 -- Column Roles") plus a rendered `<p className="text-xs text-muted-foreground mt-1">` one-line purpose description directly above the inputs (Section 3's description was previously a non-rendered JSX comment).
- **Column coverage summary (LIFTED, config-screen redesign):** the `contentBearingColumns` "Column coverage (preview rows):" block now renders as a DIRECT `<fieldset>` child BETWEEN Zone A and Zone B -- i.e. ABOVE Section 4 -- NOT inside the review gate where it used to live. Container unchanged: `<div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">`. It is a sibling in the fieldset's `space-y-5` flow; all referenced vars (`contentBearingColumns`, `columnRoleMap`, `ROLE_LABELS`) stay in the same render scope, so no prop threading was needed.
- **Zone B -- "Sheet details":** wraps Section 4 (Work Packages). Caption same typography as Zone A. Container: `<div className="rounded-md border border-border p-3">` -- the former `bg-muted/30` tint is REMOVED so Zone B matches Zone A exactly (the config-screen redesign killed the asymmetric tint). Section 4 `space-y-4` preserved.
- **Footer panel -- review gate + save bar:** the bulk-accept + attestation review-gate wrapper and the save-action wrapper are now wrapped together in ONE matching bordered container `<div className="rounded-md border border-border p-3 space-y-4">`, a `<fieldset>` sibling AFTER Zone B (applies to the whole sheet, not to either zone). The two inner wrappers dropped their now-redundant `pt-3 border-t border-border` (the panel border + `space-y-4` provide the separation); their `space-y-*` classes are kept. **The "I've reviewed this" attestation checkbox STAYS here (below Section 4) by owner choice** -- it did NOT move with the coverage summary.
- **Zone caption typography:** `text-xs font-medium uppercase tracking-wide text-muted-foreground` -- visually lighter than the section `<h3>` (`text-sm font-semibold text-foreground`), establishing "zone caption > section heading" hierarchy.
- **Design tokens used:** `border-border`, `bg-muted/30` (coverage summary only), `rounded-md`, `p-3` -- all existing tokens, no new values introduced.
- **Gate logic is state-driven, not DOM-coupled:** all `confirmedFields.has("section:...")`, `allSectionsConfirmed`, `parserRequiredSatisfied`, `hasWorkPackage`, attestation `disabled` expression are purely state checks. Wrapping or reordering sections (including lifting the coverage summary above Section 4) does not affect the gate.


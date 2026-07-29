## §9 #164 Slice A3-frontend — parse-lock UI + check_parse_status wiring + SheetConfigPanel getFrappeError migration (FRONTEND ONLY, feat 6be90efd, 2026-06-13)

**Goal.** The frontend half of the parse-lifecycle lock (backend floor = A3-backend, feat 004f80a8). While a
sheet is under active parse/re-parse it must not be edited; the user must see WHY. This slice disables the
hub card, locks the spoke config panel, and makes the review screen read-only for a parsing sheet, wires the
unwired `check_parse_status` self-heal on hub mount, and migrates SheetConfigPanel to the `getFrappeError`
house pattern (§9 #161). No backend/Python; `ReviewTree.tsx` untouched (its `readOnly` gating already freezes
the tree).

**Recon basis.** A3-frontend recon (2026-06-13): `parse_in_progress` flows automatically via
`useFrappeGetDoc("BOQs")` (Recon #2 Q3); SheetCard receives the full `draft`; SheetReviewPage/SheetSpokePage
both have an existing draft lookup; the hub already derives `parseInFlight` from `boq.parse_in_progress` on
mount; SheetConfigPanel is the lone wizard writer still on the inline `.message` ladder.

**CHANGE 1 — boqTypes.ts.** `BoQSheetDraft` gains `parse_in_progress?: 0 | 1` (rides the BOQs payload).
`BOQsDoc.parse_in_progress` already present. `parse_job_id`/`parse_enqueued_at` NOT added (frontend never
reads them; `check_parse_status` returns derived state).

**CHANGE 2 — SheetCard.tsx.** `isParsing = draft.parse_in_progress === 1`. The four parse-admissible branches
— Reviewed, Parsed, Parsed Check Done, and **Parse failed** (v5.46 amendment: Parse-failed IS force-re-parse
eligible -> can be superset-marked at enqueue) — get `disabled={isSaving || isParsing}` on every action; a
compact amber `Loader2 + "Parsing..."` chip renders by the status pill. Pending/Skip/Hidden/General-specs are
never parse-marked -> untouched.

**CHANGE 3 — SheetReviewPage.tsx.** The existing `boq.sheet_drafts.find(...)` lookup now captures the whole
draft -> `sheetStatus` + `isParsing`. `readOnly={isChecked || isParsing}` on `ReviewTree`. An AMBER parsing
banner (Loader2, one "Go to hub" button) renders when `isParsing` and TAKES PRECEDENCE; the teal D1 checked
banner is gated to `isChecked && !isParsing`.

**CHANGE 4 — SheetSpokePage.tsx.** Derives `isSheetParsing` from the `:58` draft lookup; passes `isParsing`
to SheetConfigPanel.

**CHANGE 5 — SheetConfigPanel.tsx.** (5a) new `isParsing?: boolean`; an amber lock banner + the whole form
wrapped in a native `<fieldset disabled={isParsing}>` (cascades to every shadcn button/input/Radix-select
trigger -> one flag locks Sections 1-4 + Save + Mark-as-reviewed); `dropIfReviewed` early-returns when
`isParsing`. (5b §9 #161) import `getFrappeError`; `handleSave` + `handleMarkReviewed` outer catches use
`getFrappeError(e) || "<fallback>"`; the two inner work-package/status catches append `${getFrappeError(e)}`
to their static strings; `dropIfReviewed`'s `callSetStatus` gains a `.catch` routing into `setSaveError` (no
longer swallowed). A stale-tab mid-parse config write now surfaces the REAL backend message.

**CHANGE 6 — BoqHubPage.tsx.** A one-shot imperative `check_parse_status` call via `useFrappePostCall` (the
wizard's imperative GET-capable form, chosen over `useFrappeGetCall` to avoid SWR re-fetch loops re-hitting a
self-healing endpoint) in a `useEffect([boqId])` mount effect. On `cleared`/`cleared_stale` -> `void mutate()`
so the existing `useEffect([boq])` recovery re-reads the healed flags; `running`/`idle` -> no-op. Non-fatal:
failures are `console.error`-only; the hub renders regardless. The `cancelled` unmount guard prevents a
post-unmount `mutate`.

**Verification.** In-container `tsc --noEmit`: 0 new wizard-file errors (filtered `boq-wizard|boqTypes` ->
empty). In-container `yarn build`: exit 0, `✓ built in 3m 46s`, PWA 168 entries. No Frappe tests (frontend-
only). Manual live-cert LC1-LC7 pending Nitesh (card disable+chip / spoke lock+banner / review read-only+amber
beats teal / post-parse socket unlock / stale-tab getFrappeError proof / idle hub normal / stuck-flag self-heal).

**Files changed (feat 6be90efd):** `pages/boq-wizard/boqTypes.ts`, `SheetCard.tsx`, `SheetReviewPage.tsx`,
`SheetSpokePage.tsx`, `SheetConfigPanel.tsx`, `BoqHubPage.tsx`. No backend file touched. STALE-PATH NOTE: the
build brief listed `frontend/src/types/boqTypes.ts`; the real file is `frontend/src/pages/boq-wizard/boqTypes.ts`.

**The #164 arc (backend A3 feat 004f80a8 + frontend A3 feat 6be90efd) is now COMPLETE pending live-cert.**

---


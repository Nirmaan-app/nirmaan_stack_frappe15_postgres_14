# BoQ Frontend — Upload Wizard & Parse Lifecycle

> Entry points, project picker, upload screen, drop zone, uploadStatus lifecycle, socket listeners, parse-completion modal, on-mount recovery, reconnect self-heal.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- BoQ Upload Wizard -- Frontend Conventions (Module 1b onward)
- Docs discipline -- DOCS-UPDATE RULE (all three, every commit)
- Project picker (M1.64)
- Global entry (M1.59)
- In-project tab (M1.5)
- Sidebar nav (M1.57)
- Color tokens (M1.66)
- UI library (M1.62)
- Tendering create-modal (M1.56)
- useBoqWizardStore (M1.60)
- Upload screen layout (M1.4, M1.7)
- Drop zone (M1.65)
- Blank-until-parsed + confirm-reset (§4.1 clarification, 1b-ii-b)
- Upload trigger flow (1b-ii-b)
- uploadStatus lifecycle (1b-ii-b)
- Socket listener pattern (1b-ii-b)
- Socket listener pattern (2b-frontend-i) -- hub `boq:parse_run_done` listener
- Parse completion modal pattern (Bucket-2 Slice 2, feat 21e56963)
- On-mount parse_in_progress recovery convention (Bucket-2 Slice 2, feat 21e56963)
- Parse button in-progress convention (Bucket-2 Slice 2)
- Hub reconnect self-heal convention (#147 option-4, feat 193327b1)
- ParseRunDialog dismiss convention (#147 option-4, feat 193327b1)
- Continue gate (M1.33-M1.36)
- Pre-fill-unconfirmed pattern (S4.1, M1.34)

---

# BoQ — Frontend Reference (on-demand)

> **Relocated from `frontend/CLAUDE.md`** in the 2026-06-25 context-hygiene split (the old lines 178–1490:
> the BoQ Upload Wizard + Pricing Editor + Review-screen conventions, with full per-slice as-built detail).
> **Load this before working on BoQ frontend code.** Live status = `frontend/.claude/plans/boq-upload-plan.md`.
> Backend = `.claude/context/domain/boq-backend.md`.
>
> NOTE: any "DOCS-UPDATE RULE (all three, every commit)" text reproduced BELOW is **SUPERSEDED** — the
> revised rule (per-slice detail → these reference docs + the plan, not the always-loaded `CLAUDE.md`)
> lives in `frontend/CLAUDE.md`.

---

## BoQ Upload Wizard -- Frontend Conventions (Module 1b onward)

**Docs discipline -- DOCS-UPDATE RULE (all three, every commit):** Every docs or feat+docs commit updates ALL THREE docs -- `frontend/.claude/plans/boq-upload-plan.md`, root `CLAUDE.md`, and `frontend/CLAUDE.md` (this file) -- with NO exceptions. A doc not substantively affected still gets a MINIMAL TOUCH (bump its last-updated/status line + a one-line note of what landed), never a skip. Rationale: "update CLAUDE.md" without naming which one let this file silently fall a full module behind (stale through all of Module 2b). Naming all three by full path removes the routing ambiguity. **This file's path: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

All wizard-frontend code lives in `src/pages/boq-wizard/`. Do not scatter
wizard components into other page folders.

**Project picker (M1.64):** The picker uses an inline `useFrappeGetDocList`
dropdown -- no shared `ProjectSelector` component. Mirror the query shape
from `NewMilestones.tsx` (fields: `["name", "project_name"]`, filter
`status != Tendering`, limit 1000). Do NOT build a reusable ProjectSelector.

**Global entry (M1.59):** Route is `/upload-boq` with optional `?project=<id>`
query param for pre-selection. Defined as a React Router v6 `lazy()` route
in `routesConfig.tsx`. The module must export `Component` (named) for lazy().

**In-project tab (M1.5):** Tab key is `PROJECT_PAGE_TABS.BOQ = 'boq'`, accessed
via `?page=boq` on `/projects/:projectId`. Tab component is `BoqProjectTab`
(lazy via `React.lazy()`). New tab sets must be typed as
`useMemo<Set<ProjectPageTabValue>>` to avoid TS narrowing failures.

**Sidebar nav (M1.57):** Role-gated to Admin + PMO + Procurement Executive +
Estimates Executive + Project Lead (identical to Item Price Search gating).
Add label to the leaf-item discriminator Set in `NewSidebar.tsx`, to `allKeys`,
and to `groupMappings`.

**Color tokens (M1.66):** Use Tailwind token classes only -- `text-muted-foreground`,
`bg-background`, `border-border`, `text-foreground`, `text-primary`, etc.
Never hardcode hex values. All tokens defined in `src/index.css` :root.

**UI library (M1.62):** shadcn/ui primitives only for wizard UI (Button, Card,
Select, Dialog, etc.). No Ant Design in wizard components.

**Tendering create-modal (M1.56):** The picker's 'Create new Tendering project'
button opens `TenderingProjectForm` inside a shadcn `Dialog`. The form is
rendered in embedded mode via two additive optional props:
- `embedded?: boolean` -- suppresses the standalone page chrome (back button,
  Card wrapper) so the form body sits cleanly inside the Dialog.
- `onCreated?: (newProjectId: string) => void` -- called with the new project's
  docname (`response.message.project_name`) on successful CREATE, replacing the
  default navigate-to-tendering-tab behavior.
- `onCancel` is extended to work in embedded CREATE mode (previously EDIT only).

The standalone route `/projects/new-project/tendering` is byte-for-byte
unchanged when these props are absent. This change is owner-approved (M1.56,
Nitesh briefed Abhishek). Do NOT widen these props further without owner sign-off.

In embedded mode all three react-select menus (State, City, Customer) render
inline (`menuPortalTarget={undefined}`) rather than portalling to `document.body`.
This prevents Radix Dialog's DismissableLayer from intercepting clicks on portalled
elements and swallowing option selections. On the standalone route (embedded
absent) the menus continue to portal to `document.body` as before.

**useBoqWizardStore (M1.60):** Transient Zustand store at `src/zustand/useBoqWizardStore.ts`
(no `persist` middleware -- wizard state is session-only). Mirrors `useProjectDraftStore`
structure. Key state: `selectedProjectId`, `droppedFile` ({name,size}|null),
`uploadStatus` ('idle' -- expanded in 1b-ii-b), `panelValues` (boqName/version/gst/notes),
`confirmedFields` (boqName/version/gst booleans). Key actions: `setDroppedFile`,
`clearFile`, `setPanelValue`, `confirmField`, `reset`. Call `reset()` when projectId
changes to flush stale state; pre-fill `boqName` from the fetched project name
afterwards (unconfirmed).

**Upload screen layout (M1.4, M1.7):** `BoqUploadScreen.tsx` owns the two-pane
layout (Card grid, 1-col mobile / 2-col md+). Renders in-place inside `BoqPickerPage`
when `?project=<id>` is present -- no new route. `BoqDropZone.tsx` is the left pane;
`BoqMasterPanel.tsx` is the right pane. Footer: Back-to-project (navigates to
`/projects/<id>`) + Continue (disabled until 1b-ii-b gates it on file + confirmed fields).

**Drop zone (M1.65):** `BoqDropZone.tsx` -- custom file-input pattern, no react-dropzone.
Hidden `<input type="file" accept=".xlsx,.xlsm">` triggered by click/drag. Client-side
validation only: wrong extension = Error D; >25 MB = Error H. Errors E (corrupted) and
F (zero sheets) require the parser -- deferred to 1b-ii-b. On valid drop: collapses to
file tile (filename + size + Replace link); file stored in `useBoqWizardStore.droppedFile`.

**Blank-until-parsed + confirm-reset (§4.1 clarification, 1b-ii-b):** Required fields
(BoQ Name, Version, GST) start BLANK (empty string, no radio selection) before parse.
`DEFAULT_PANEL` in the store has all-empty values; `GstChoice` includes `""`. After
parse success, `fillFromParse({boqName, version, gst, notes})` populates the fields
AND resets `confirmedFields` to all-false, so the user sees the sparkle + opacity-50
treatment on the REAL detected values. The sparkle/opacity condition checks BOTH
`!confirmed && value !== ""` -- empty fields never show sparkle pre-parse. The
1b-ii-a `useEffect` that pre-filled `boqName` from `project.project_name` is REMOVED.

**Upload trigger flow (1b-ii-b):** On valid drop, `BoqDropZone` immediately POSTs to
`/api/method/nirmaan_stack.api.boq.wizard.upload_file.upload_file` via native `fetch` with
`FormData` (fields: `project_id` from store, `file`). CSRF token from
`(window as any).frappe?.csrf_token`. Returns `{message: {job_id}}` synchronously;
`setUploadStatus("parsing")` + `setJobId(job_id)` on success. Upload HTTP failure
calls `resetUpload()` (not just `setUploadStatus("idle")`) so the drop zone
reappears for retry.

**uploadStatus lifecycle (1b-ii-b):** `idle` | `uploading` (POST in flight) |
`parsing` (job enqueued, waiting for socket) | `done` (parse success, BOQs row
created) | `error-E` (corrupted workbook, error_code="corrupted") | `error-F` (zero
sheets, error_code="zero_sheets") | `error-internal` (unexpected server error).
`BoqDropZone` renders spinner for uploading/parsing, error states for error-*, and
file tile for idle/done. The 30s "taking longer" message is a local `setTimeout`
in `BoqDropZone` that fires only during "parsing" -- not a timeout, parsing continues.

**Socket listener pattern (1b-ii-b):** `boq:wizard_parse_done` is registered
SCREEN-SCOPED in `BoqUploadScreen.tsx` via `useContext(FrappeContext)` -- NOT added
to `socketListeners.ts` or `SocketInitializer.tsx`. Pattern: `socket.on(event, handler)`
in a `useEffect([socket])` cleanup, `socket.off(event, handler)` in the cleanup
return. Handler guards on `useBoqWizardStore.getState().uploadStatus === "parsing"` to
filter events from concurrent uploads by other users (frappe.publish_realtime
broadcasts to ALL connected clients without user targeting). Success path sets
`boqDocName` + `uploadStatus("done")`; error path sets the appropriate error-* status.
`useFrappeGetDoc("BOQs", boqDocName, boqDocName ? undefined : null)` then fetches the
doc (third arg null disables SWR until boqDocName is set per sdk gotcha). A separate
`useEffect([boqDoc, uploadStatus])` calls `fillFromParse` when the doc arrives.

**Socket listener pattern (2b-frontend-i) -- hub `boq:parse_run_done` listener:** `boq:parse_run_done` is registered SCREEN-SCOPED in `BoqHubPage.tsx` via `useContext(FrappeContext)` -- NOT added to `socketListeners.ts` or `SocketInitializer.tsx` (same screen-scoped convention as the 1b-ii-b upload listener). `socket.on(event, handler)` in `useEffect([socket])`, `socket.off` in cleanup. KEY DIFFERENCE from the 1b-ii-b upload listener: guards on `payload.boq_name === boqId` (hub always knows its BoQ; no store-state check needed) rather than a store `uploadStatus` flag. On success: calls `mutate()` + sets `parseResult({parsed, notParsed, failed})` to open the completion modal (Bucket-2 Slice 2); on error: uses `PARSE_ERROR_MSGS` module-level const to set `parseError({message, severity})`. `boq:wizard_parse_done` (upload flow, 1b-ii-b, in `BoqUploadScreen`) and `boq:parse_run_done` (parse-run flow, 2b-frontend-i, in `BoqHubPage`) are DISTINCT events for DISTINCT flows -- do NOT conflate them.

**Parse completion modal pattern (Bucket-2 Slice 2, feat 21e56963):** `BoqHubPage` shows parse results in an acknowledge-only `AlertDialog` (single OK action, no Cancel). Open-state is derived from `parseResult || parseError` -- the modal opens automatically when either is set; OK action (and Escape key via `onOpenChange`) clears both. HUB-SCOPED only; never make this app-global. Per-case message convention:
- SUCCESS: up to 3 independent sub-lines, each shown only if the list is non-empty: (1) `Parsed: {names}` -- `font-medium text-foreground`; (2) `Not parsed (skipped, hidden, or general-specs): {names}` -- `text-muted-foreground` (NEUTRAL); (3) `Failed to parse: {names}` -- `text-destructive`. If all lists empty, show "Parse complete." fallback.
- ERROR: one message per error code. `no_eligible_sheets` is NEUTRAL (`text-muted-foreground`) -- it is advisory, not a failure; all other codes are `text-destructive`. Exact messages in `PARSE_ERROR_MSGS` const in `BoqHubPage.tsx` (module-level, not re-defined per event).
- `parseError` state shape: `{ message: string; severity: "destructive" | "neutral" } | null` -- preserving the error code semantics for styling. Do NOT flatten to a pre-baked string that loses the code.

**On-mount parse_in_progress recovery convention (Bucket-2 Slice 2, feat 21e56963):** `parseInFlight` must be initialized from the server flag on every hub mount so it survives navigation and missed socket events. Pattern: a `useEffect([boq])` (mirrors the specs-checklist `useEffect([boq])` pattern) that calls `setParseInFlight(boq.parse_in_progress === 1)`. The live socket event still clears `parseInFlight` on done -- the on-mount read is the fallback only. Do NOT poll; a single read on doc-load is sufficient. Apply this pattern to any future hub-scoped "job is running" indicator that must survive navigation.

**Parse button in-progress convention (Bucket-2 Slice 2):** When `parseInFlight=true`, the Parse workbook button should be `disabled` AND show a spinner (e.g. `<Loader2 className="mr-2 h-4 w-4 animate-spin" /> Parsing...`). This makes the recovered `parseInFlight=true` state visible without re-opening the confirm dialog. Pattern: `disabled={!canParse || parseInFlight}`.

**Hub reconnect self-heal convention (#147 option-4, feat 193327b1):** The hub socket `useEffect([socket])` registers both the `boq:parse_run_done` done-handler AND a `socket.on("connect", onReconnect)` reconnect handler in the same effect body. `onReconnect = () => { void mutate(); }` re-fetches the BoQ doc on socket reconnect (and initial connect -- harmless, SWR deduplicates). The existing `useEffect([boq])` on-mount recovery then re-syncs `parseInFlight` from the fresh `parse_in_progress` server value, self-healing a missed done-event without a manual refresh. Cleanup: `socket.off("connect", onReconnect)` in the same return alongside `socket.off("boq:parse_run_done", handler)`. Reuses the existing `mutate` from `useFrappeGetDoc`; no new fetch mechanism. Apply this pattern to any future hub-scoped long-running job that uses a socket done-event + on-mount recovery.

**ParseRunDialog dismiss convention (#147 option-4, feat 193327b1):** `ParseRunDialog`'s `onOpenChange` must allow dismiss even when `isLoading` (a parse is in flight) -- closing the dialog does NOT cancel the server parse job. The parse keeps running; the hub's Parse button continues showing Parsing... spinner (driven by `parseInFlight`). Pattern: `onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}` -- no `isLoading` guard. The **Cancel button stays disabled** while loading because "Cancel" implies aborting the job, which is not supported (no cancel API exists). Three dismiss affordances are always available: X button (built-in via `disableCloseIcon=true` default in `DialogContent`), Escape key, and overlay-click. This pattern enables navigate-away-during-parse: user closes dialog mid-parse, hub body becomes interactive, user navigates away. On return, on-mount recovery restores `parseInFlight=true` from `parse_in_progress`.

**Continue gate (M1.33-M1.36):** Enabled when `droppedFile !== null && uploadStatus
=== "done" && confirmedFields.boqName && confirmedFields.version && confirmedFields.gst`.
Disabled-state tooltip dynamically lists still-missing items. On click:
`navigate(\`/upload-boq/hub/${boqDocName}\`)` -- navigates to the BoQ Hub screen
(Module 2b-i, feat 81568df9). The old `handedOff` stub (CheckCircle2 placeholder,
local useState) has been removed.

**Pre-fill-unconfirmed pattern (S4.1, M1.34):** Required fields (BoQ Name, Version, GST)
start blank (see blank-until-parsed above). After `fillFromParse`, they carry real
detected values and show ~50% opacity with a ✨ sparkle until the user explicitly
interacts (click, focus, or value change calls `confirmField`). Read-only (Project,
Customer) and optional (Notes) fields are excluded from this treatment (M1.19, M1.32).
GST's `onClick` on the `RadioGroup` catches clicks on the pre-selected option,
satisfying M1.30 ("clicking even the default confirms"). Confirmed flags live in the
store.

### BoQ Pricing Editor -- Frontend Conventions (live component contracts)

These are the current, component-keyed contracts for the pricing editor (`PricingGrid.tsx` / `SheetPricingPage.tsx`).
Full per-slice as-built detail (Slices 2 -> 4a.2) lives in `boq-upload-plan.md` under "## Phase 5 Pricing Editor --
slice detail".


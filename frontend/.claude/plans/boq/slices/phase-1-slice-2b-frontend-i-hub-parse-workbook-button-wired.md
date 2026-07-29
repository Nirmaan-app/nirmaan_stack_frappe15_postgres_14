### Phase-1 Slice 2b-frontend-i -- hub "Parse workbook" button wired

**Status:** COMPLETE (feat c9fc37fd; frontend-only; tsc 0 errors on wizard files; Vite build exit 0, 10m 40s).

**Files changed:**
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- `ParseRunDonePayload` interface
- `frontend/src/pages/boq-wizard/ParseRunDialog.tsx` -- NEW component
- `frontend/src/pages/boq-wizard/SheetCard.tsx` -- dirty badge + last_parsed_at display
- `frontend/src/pages/boq-wizard/BoqHubPage.tsx` -- full parse-run wiring

**What this slice does**

Wires the hub "Parse workbook" button (previously a no-op stub) to the `run_parse` endpoint:

1. **ParseRunDialog** (new component): four-list confirm summary shown before any parse:
   - WILL PARSE: all Reviewed sheets, each with a checkbox (all ticked by default). Dirty sheets (has_prior_parse=1) show amber "was parsed -- config changed, will re-parse" sub-line.
   - General specs (preamble only): informational, no checkboxes.
   - Already parsed: read-only with last_parsed_at date.
   - Pending / not configured: read-only.
   - Skipped / hidden: read-only.
   Two-step flow: step 1 = summary, step 2 = warn-before-reparse fires when any ticked sheet has has_prior_parse=1 ("Re-parse anyway" vs "Go back"). Parse button disabled + spinner while in-flight.

2. **BoqHubPage wiring**:
   - `useFrappePostCall(run_parse)` hook
   - `useContext(FrappeContext)` + `socket.on("boq:parse_run_done", handler)` in a `useEffect([socket])` (mirrors BoqUploadScreen pattern exactly; guard: `payload.boq_name !== boqId`)
   - Success: calls `mutate()`, sets `parseResult` state (parsed/notParsed/failed lists)
   - Error: maps `error_code` to readable message, sets `parseError` state
   - Inline result panel below footer (green for success, red for error)
   - `ParseRunDialog` rendered with effective-status-derived props (same gate source as canParse)
   - Button onClick wired to `handleParseClick`; gate unchanged

3. **SheetCard dirty surfacing**:
   - Reviewed + has_prior_parse=1: amber rounded-pill badge "needs re-parse" next to the emerald pill
   - Reviewed + has_prior_parse=1 + last_parsed_at: "last parsed <date>" as optional nicety text
   - Parsed + last_parsed_at: "Parsed <date>" inline text in action area

**Engineering calls:**
- Dialog extraction to `ParseRunDialog.tsx` (same wizard dir) to keep BoqHubPage manageable.
- Two-step warn-before-reparse within the same Dialog (not nested dialogs) for simplicity.
- Result surfacing as inline panel (wizard convention: no toasts; inline errors/results).
- Dialog cannot be dismissed while parse is in-flight (onOpenChange guarded by isLoading).
- Explicit ticked list always passed to run_parse (never omit the arg) for clarity.
- General-specs sheets: shown in their own informational section, no checkboxes.

**Wizard test count:** 157 (unchanged -- no Frappe tests for frontend slices; tsc + Vite build are the verification).

---


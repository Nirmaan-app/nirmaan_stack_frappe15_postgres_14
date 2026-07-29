## Slice F3/F4 -- completion modals highlight failures with reasons (FRONTEND, feat bfa71098, 2026-06-18)

**What & why.** The TRANSIENT counterpart to F2's persistent hub card: at the MOMENT a parse or commit finishes,
the completion modal highlights each FAILED sheet WITH its reason -- so the user sees the why right then, not only
later on the card. This completes the F-arc (F1 persist commit-failure -> F2 persistent "needs attention" card ->
F3/F4 transient modals). FRONTEND ONLY -- no backend, NO new fetch, NO payload change.

**F4 (the COMMIT results modal, `CommitResultsModal.tsx`) = ALREADY SATISFIED at Slice 5 -- VERIFY-ONLY.** The recon
found, and a re-read confirmed, that it already renders a dedicated "Failed (N)" section with, per sheet, a
destructive `<li>` + `AlertTriangle` + `{sheet_name} -- {reason}` (the `{committed, failed}` envelope carries the
reason directly). No concrete gap -> NO code change to F4.

**F3 (the PARSE completion modal -- the inline `AlertDialog` in `BoqHubPage.tsx`) = the real work.** Today's failed
line was `parseResult.failed.join(", ")` -- bare sheet NAMES, no reason. Now it is a per-sheet `<ul>/<li>` list
mirroring the CommitResultsModal failed-section visual shape: each `<li>` is `text-destructive` with an
`AlertTriangle` + `{name} -- (category) reason`.

**The data source (recon-confirmed, implemented exactly).** The `boq:parse_run_done` socket payload carries NAMES
ONLY -- `ParseRunDonePayload` is `{status, boq_name, parsed_sheets?: string[], not_parsed_sheets?: string[],
failed_sheets?: string[], error_code?}`, and the worker publish site `parse_run._publish_parse_event` (success kwargs
`parsed_sheets=parsed_sheets, not_parsed_sheets=not_eligible, failed_sheets=failed_sheets`, all `list[str]`) adds no
per-sheet reasons. The REASON lives in the persisted `parse_failure_*` (Slice 1a) on the draft, which rides the
`useFrappeGetDoc("BOQs")` doc the hub ALREADY fetches and ALREADY `mutate()`s on parse-done. So F3 reads each failed
sheet's reason at render time: `boq.sheet_drafts?.find(sd => sd.sheet_name === name)` (VERBATIM #152, the same lookup
F2 / the hub use) -> `parse_failure_reason` (trimmed) + `parse_failure_category` (in parens). NO new fetch.

**The freshness fallback (a correctness requirement).** `applyParseOutcome` calls `mutate()` (async refetch) AND
`setParseResult()` (opens the modal immediately). The worker COMMITS the `parse_failure_*` stamps BEFORE publishing
the socket event, so once the refetch lands the reasons are present and the open (acknowledge-only) modal re-renders
fresh -- but the FIRST render can be pre-mutate, so the draft lookup returns undefined. F3 guards with `reason &&
(...)` -> renders the sheet NAME ALONE in that window (never blank / "undefined" / crash); the next render shows
name + reason. The modal stays open, so the user sees the reason by the time they read it. No fetch is added to force
freshness; the modal is not blocked on the refetch.

**Unchanged (deliberate).** The `parsed` (foreground) and `notParsed` (NEUTRAL `text-muted-foreground`, names-only)
success sub-lines are untouched -- `notParsed` stays a neutral advisory list (skipped / hidden / general-specs /
pending). Although stale-config drops land in `not_eligible` WITH a "Config stale" stamp, their reason is shown
PERSISTENTLY on the F2 card and is NOT duplicated in this transient modal -- `notParsed` is NOT dragged into
destructive styling. The whole-run `parseError` block (`PARSE_ERROR_MSGS`; `no_eligible_sheets` NEUTRAL) is a
DIFFERENT axis (whole-run failure, not per-sheet) and is untouched. `AlertTriangle` was added to BoqHubPage's lucide
import. NO timestamp is shown in the modal (just-happened/transient; the F2 card persists `parse_failure_at`). NO
shared failed-list component was extracted (two call sites with different data sources -- commit reads the envelope
object, parse looks up `sheet_drafts` -- abstracting both is over-engineering for two sites). Language matches the F2
card expand (same reason + category strings), so the transient modal and the persistent card describe an identical
failure identically.

**Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|SheetCard|BoqHubPage|boqTypes|CommitResultsModal`
-> empty; 3177 baseline unchanged) + in-container Vite build exit 0 (`Done in 251.50s`). DATA-SIDE cert on
BOQ-26-00145 (restore-first-safe capture-and-restore; workbook RESTORED to baseline -- non-negotiable for the cert
workbook): captured the "FAS" draft's baseline `parse_failure_*` (all None), called
`parse_run._record_parse_failure(boq, "FAS", "Parser error", <reason>)` + commit, then confirmed the EXACT data F3's
render reads -- a `find` by verbatim sheet_name resolves `parse_failure_reason` + category "Parser error"
(`lookup_resolves` / `reason_present` / `category_present` all True); the freshness-fallback case (`find` over a
non-existent name -> undefined -> the `reason && (...)` guard renders name-only) is code-inspected
(`fallback_undefined_safe` True); RESTORED by writing the captured baseline values back verbatim (these are scalar
Select / Small Text / Datetime fields -- NOT JSON, so no dict round-trip gotcha) -> the three fields equal the
captured baseline (`RESTORED_clean` True). **The VISUAL modal render (the failed list paints with reasons, neutral
line stays neutral) is an OWNER-OWNED later manual pass -- not headlessly confirmable; the data + build are certed.**

**Scope.** FRONTEND ONLY -- no backend, no boqTypes change (`ParseRunDonePayload` stays names-only by design;
`parse_failure_*` already on `BoQSheetDraft` from F2), no `get_stale_sheets`/publish-payload change, no SheetCard
change, no CommitResultsModal change (F4 already done). Pure-frontend -> this plan + frontend/CLAUDE.md substantive;
root CLAUDE.md deliberately NOT touched (build-prompt scope: a frontend slice updates frontend/CLAUDE.md, not root).
The F-arc (F1 -> F2 -> F3/F4) is now COMPLETE.


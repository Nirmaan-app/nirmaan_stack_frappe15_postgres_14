## Pricing editor -- Build slice HV-10b (completion summary = COMBINED EFFECTIVE outcome) COMPLETE

**Owner ruling (2026-07-22), from the browser E2E:** after a multi-engine classify, the completion
message ("xx classified, yy flagged for review") reported a PER-ENGINE denominator (the
last-completing engine's `boq:classify_sheet_done` payload -- last-engine-wins), so a concurrent
2-engine whole-sheet run showed one engine's 13/12 instead of the combined 7 categorised / 9 review
the grid actually rendered. **The summary must agree with the grid.**

**The fix (frontend-only).** When ALL running disciplines terminate, `applyClassifyDone`
(`SheetPricingPage.tsx`) composes the completion summary from the FRESH resolved read (the SAME
`get_sheet_categories_resolved` source the grid renders, awaited off `mutateCategories`) via the new
pure `summariseResolvedOutcome(resolvedRows, rangeUnion)` (`sheetCategoryResolve.ts`):
`categorised` = effective non-blank (an auto-accept OR a human verdict -- a pre-existing human
verdict counts as categorised), `review` = effective blank (the blank-review law). It is scoped to
the run set's `rangeUnion` (`unionScopes`): each `onStarted` REPLACES the union with just that run
set's scopes (reset-between-run-sets); multiple engines fold together and **whole-sheet DOMINATES a
mixed union**; a poll-recovered run (unknown scope) or an empty scope degrades to whole-sheet. Only
the NUMBERS' source changed -- the wording, skip rollup, ai_status note, and the error path are
untouched; a mid-run (not-all-done) engine only refetches, never composes a summary.

**Owner-ruled scope addition (A12).** `ClassifySheetDialog.onStarted` now passes
`Array<{discipline, scope}>` instead of `string[]` (prop type + the `onStarted(...)` call payload) so
the page can build the range union. This is a SIGNATURE-ONLY change -- the dialog's launch behaviour
(engine select, range validate, `start_classify`) is byte-identical.

**Tests (bench-verified in-container).** vitest **547 -> 560 (+13)** in
`sheetCategoryResolve.test.ts`: `unionScopes` (empty/whole-sheet/single-range/disjoint/overlapping
dedup/**mixed whole-sheet-dominates**/**reset-between-run-sets**) + `summariseResolvedOutcome`
(**equality-by-construction** single-engine whole-sheet == the engine's own numbers; the **concurrent
2-engine E2E shape** 16 rows -> 7/9; **range-scoped** union only; **human verdict counts as
categorised**; whitespace-blank; empty). `tsc` net-zero (3235, 0 in touched files). `ClassifySheetDialog`/
`ClassifyProgressModal` pure tests unchanged (the modal's props are unchanged; only the numbers' source moved page-side).

**Live proof.** Concurrent Electrical+HVAC whole-sheet run on `BOQ-26-00050 | MEP Combined` (AI
`claude-opus-4-8` verified ON): the modal line, the post-close toast, and the resolved effective
split matched three ways (no single-engine 16/13 or 16/12 denominator). See
`_classification_review/hv10b_report/HV10B_REPORT.md`.

**Note (stranding constraint):** a whole-sheet re-classify supersedes row categories and human
verdicts do NOT carry forward (intentional), so a whole-sheet run's completion summary cannot itself
hold a pre-existing human verdict on a row it re-ran; the human-counts rule is proven by the vitest
grid + the same `summariseResolvedOutcome` helper over the post-pick live resolved read.


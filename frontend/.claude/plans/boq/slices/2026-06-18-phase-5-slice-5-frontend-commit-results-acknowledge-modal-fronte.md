## Phase 5 Slice 5 (frontend) — commit-results acknowledge modal (FRONTEND, feat ab4a390b, 2026-06-18)

**Goal.** Consume the Slice-5 backend envelope (`commit_boq` → `{boq_name, committed:[{sheet_name, commit_version,
...}], failed:[{sheet_name, reason}]}`, which NO LONGER throws on a per-sheet failure). After a commit the user now
sees an explicit RESULTS acknowledgement — a hub-scoped OK-dismiss modal that enumerates, SEPARATELY, the sheets
that committed (with version) and the sheets that failed (with reason). MIXED outcomes are normal. FRONTEND-ONLY.

**Pattern (no new scaffolding).** Mirrors the hub's parse-completion modal: an acknowledge-only `AlertDialog`, open
driven from result state, single `AlertDialogAction` "OK" + escape dismiss. The result flows up via OPTION (i) —
`CommitDialog` keeps its "pick + fire" job and hands the resolved envelope to the hub; the hub owns the results
modal (consistent with the hub owning the parse-completion modal).

**Files.**
- `boqTypes.ts` — ADD `CommittedSheetResult` (reads `sheet_name` + `commit_version`; other envelope keys optional)
  + `FailedSheetResult` (`sheet_name` + `reason`) + `CommitBoqResponse` (`{boq_name, committed[], failed[]}`).
  DISTINCT from `CommittedSheetState` (the get_committed_state read) — this is the commit RESULT.
- `CommitDialog.tsx` — `fireCommit` now captures `res.message as CommitBoqResponse` and calls
  `onCommitted(result)` (prop widened `() => void` → `(result: CommitBoqResponse) => void`) then closes. The catch
  stays for WHOLE-CALL precondition throws (gate re-check / missing boq / empty subset / file fetch); per-sheet
  failures arrive in `result.failed`, not the catch. Picker behavior (opens nothing-ticked, the step-1/2 re-commit
  warning) UNCHANGED.
- `CommitResultsModal.tsx` (NEW) — props `{open, onOpenChange, result: CommitBoqResponse | null}`; renders nothing
  when `result` is null. Summary header reads all three cases ("Committed N sheet(s)." / "Commit failed for N
  sheet(s)." / "Committed N sheet(s); M failed."). COMMITTED list (emerald + CheckCircle2, "{sheet} — committed
  v{n}") and FAILED list (text-destructive + AlertTriangle, "{sheet} — {reason}"), each shown only when non-empty.
  Single OK + escape dismiss.
- `BoqHubPage.tsx` — new `commitResult` + `commitResultsOpen` state; `handleCommitted(result)` stores the result,
  fires the existing mutates (`mutate` / `mutateCommittedState` / `mutateCommittable` — unconditional, harmless on an
  all-failed commit), and opens the results modal; `<CommitResultsModal>` mounted alongside the other hub modals.
  The Slice-4b badge/count/committed-state wiring is untouched.

**Verification.** tsc 0 new wizard-file errors (filtered) + in-container Vite build exit 0. HAPPY-PATH live-cert is
OWNER-OWNED (on BOQ-26-00145: Commit → tick a sheet → results modal shows the committed list + new version; OK
dismisses; badge/count/version refresh). FAILURE-path render is covered by the Slice-5 backend tests (T1/T4/T5/T6
populate `failed[]`) + code inspection — NOT exercised live (no real-data mutation, no browser-driving). All three
docs updated (frontend/CLAUDE.md substantive, root CLAUDE.md cross-ref, this plan).

---


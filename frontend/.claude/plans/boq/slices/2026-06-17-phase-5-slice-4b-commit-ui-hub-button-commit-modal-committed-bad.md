## Phase 5 Slice 4b — commit UI: hub button + commit modal + committed badge + count (FRONTEND, feat 53645ab7, 2026-06-17)

**Goal.** The user-facing commit entry point on the BoQ hub, wiring a UI onto the proven engine (`commit_boq`,
already whitelisted) + the Slice-4a read (`get_committed_state`). Four deliverables: a global "Commit" footer
button → a checklist modal of commit-eligible sheets; a one-step re-commit warning naming already-committed sheets
+ their last-committed date/time; a per-sheet "Committed" badge + timestamp on committed cards (a SEPARATE marker
alongside the status pill, NOT a wizard_status); and a "Committed: N" footer tally. FRONTEND-ONLY — no backend
Python, no doctype JSON.

**Wiring onto proven patterns (no new scaffolding).** The modal mirrors `ExportWorkbookDialog` (the
`useState<Set<string>>` checklist + not-dismissible-mid-flight + inline `getFrappeError`) and `ParseRunDialog` (the
`const [step,setStep]=useState<1|2>(1)` two-step warning). The committed timestamp reuses the wizard's
`slice(0,16)` "date HH:MM" pattern (ReviewTree's `formatEditAt`) via a tiny local `fmtCommittedAt` in each consuming
file — app-shared `formatDate` is NOT mutated and NO new shared helper file was added.

**Files.**
- `boqTypes.ts` — ADD `CommittableSheet` / `GetCommittableSheetsResponse` (gate) + `CommittedSheetState` /
  `GetCommittedStateResponse` (Slice 4a). NO committed field on `BoQSheetDraft`; NO "Committed" in `WizardStatus`.
- `CommitDialog.tsx` (NEW) — props `{open, onOpenChange, boqName, eligibleSheets, committedState, onCommitted}`.
  Ticked `Set<string>` initialized EMPTY (opens with nothing ticked, reset on open). Each row: name + disposition
  hint + a muted "committed {date HH:MM} · v{n}" sub-label (or "not yet committed"). `handleConfirmClick` computes
  the ticked sheets that ALSO appear in `committedState` (the re-commits); NON-EMPTY → `setStep(2)`, else fire
  directly. Step 2 = destructive `AlertTriangle` callout NAMING each re-commit sheet WITH its last-committed
  date/time + "the prior version is frozen, not lost", "Go back" / destructive "Commit anyway". `fireCommit` calls
  `commit_boq` via `useFrappePostCall` with `{boq_name, sheet_subset: tickedList}` (ordered ticked list, VERBATIM
  #152; backend re-checks the gate). running/error/not-dismissible-mid-flight copied from Export. On success →
  `onCommitted()` then close.
- `BoqHubPage.tsx` — TWO new `useFrappeGetCall` reads (`get_committable_sheets` + `get_committed_state`, same
  null-key family as the work-package map, each with `mutate`); a `committedMap` (sheet_name VERBATIM → state); the
  Commit button as the **4th footer sibling** (disabled when `committableSheets.length === 0`, from the GATE not
  committed-state); the `CommitDialog` mount with `onCommitted = () => { mutate(); mutateCommittedState();
  mutateCommittable(); }`; the "Committed: N" count (`allDrafts.filter(d => committedMap.has(d.sheet_name))`, in the
  existing `count>0 && ...` chain — derived from committed-state, NOT `getEffectiveStatus`); `committedState` passed
  to each `SheetCard` at both render sites.
- `SheetCard.tsx` — new optional `committedState?: CommittedSheetState`; when present an indigo "Committed" badge
  renders in the badge cluster ALONGSIDE the status pill (distinct from every STATUS_PILL color; NOT added to
  STATUS_PILL/WizardStatus) + a muted "· Committed {date HH:MM} · v{n}" sub-line. Same treatment for finalized AND
  general-specs.

**Verification.** tsc 0 new wizard-file errors; in-container Vite build exit 0. De-stale (pkill -f vite, restart,
clear site data, unregister SW, reopen, :8080) then live-cert on a real committed BoQ (badge + timestamp, footer
count, modal nothing-ticked, re-commit warning naming the sheet + date/time). Pure-frontend → all three docs
(frontend/CLAUDE.md substantive, root CLAUDE.md cross-ref, this plan). The owner drives any live re-commit.


# 36. S5 defect fixes: exact-name check selection, "not checked", Subtotal, revert history, commit pre-selection, and an evaluation exclusion list

Date: 2026-10-15

## Status

**Accepted** (owner rulings V1-V4 and the Part A answers Q-a to Q-j, 2026-10-14). Built in slice S6 on
`feature/boq-jev-integration`. It fixes what the S5 end-to-end trial found (S5 report, `s5\data\defects.csv`) on top
of [ADR-0035](0035-check-banners-hub-summary-soft-suggestion.md) (S4b),
[ADR-0034](0034-review-screen-check-flags-no-ai-ui.md) (S4a), [ADR-0033](0033-review-flags-and-finalize-block.md)
(S3) and [ADR-0032](0032-automatic-claude-check-after-parse.md) (S1-S2). The flag rules, thresholds, counts, the
finalize block, Claude's prompt, the parser and the commit pipeline are NOT changed.

## Context

S5 ran the review workflow end to end on 10 real BoQs. It worked, and it found 12 defects:
- **DEF-01 (wrong result):** a sheet whose name starts or ends with a space was never checked.
- **DEF-02:** flag noise. Deferred by the owner (V1).
- **DEF-03 to DEF-12:** confusing or cosmetic screens.

S5 also measured Claude with a leak: the test copies' originals were among Claude's examples. A test copy is a new
BoQ with no `source_boq`, so `revision_family` does not reach its original. The S5 test projects were already
excluded, because "Test Project N" matches the testproject rule.

## Owner rulings

- **V1:** *"all defects except def 2 needs to fixed. Flag noise is a concern, as the user would also have mistakes.
  we will review this  after a few weeks of production deployment"*
- **V2:** *"yes  do the clean re-run. but no browser cert. we can do from backend"*
- **V3:** *"1. ok, a short broswer check 2. ok with your recommendation"*. (1) A short browser check of the screen
  fixes only, one screenshot each, on test projects, with no uploads. (2) DEF-06: the user may choose "Subtotal" on
  the review screen; the parser is not changed.
- **V4:** *"we will merge with main dev after s6 is succesful and then deply to prodcution along with piping work,
  once piping work is also done"*. S7 is the merge into the main dev environment only; the production deploy comes
  later, together with the Piping work.
- **R4, R16, R20, R31** (from ADR-0035) stand unchanged.
- **Part A answers (quoted):**
  - **Q-a** *"Yes: site-config key boq_ai_evaluation_exclude_boqs, empty in production; fill with the 25 names for the re-run, then empty and remove it."*
  - **Q-b** *"Yes: re-parse the existing test sheets through run_parse(..., force_reparse=True)."*
  - **Q-b2** *"Yes: 28 sheets (26 first-upload + "FPS " + the 2 revision sheets); " Rodent" stays out as the not-checked sheet for cert step 4."*
  - **Q-c** *"Yes: close DEF-11 as not a defect (wrong-case name in the S5 script); no repair; the line for Abhishek as written."*
  - **Q-d** *"Yes: allow "subtotal_marker" in save_review_edit and save_review_restructure through a review-only set at those two checks only; nothing else in either function changes. Invert test_reject_subtotal_marker_target; header_repeat stays refused."*
  - **Q-e** *"Yes: fix in RoleRoute (loading state for every route it guards)."*
  - **Q-f** *"Yes: accept the gap (re-finalized without re-parse is listed but not pre-ticked)."*
  - **Q-g** *"Yes: the CSV "edited" column follows the same rule as the pill."*
  - **Q-h** *"Yes: fix the parent revert history wording with F7."*
  - **Q-i** *"Show "not checked" (card, banner, summary line, footer count) ONLY for a not_run sheet that has never been committed, or was re-parsed after its last commit (the same "changed since last commit" rule as F12). Committed sheets unchanged since their commit show nothing."*
  - **Q-j** *"Wording in A6 approved as written, with Q-i's reach."*

## Decision

| Item | Defect | Decision |
|---|---|---|
| F1 | DEF-01 | `ai_run_log._enqueue_after_parse` reads the drafts by parent and keeps the parsed sheets by EXACT name in Python. A Frappe `["in", ...]` filter strips values (#152). The sweep of `api/` and `services/` found no other list filter on sheet names. |
| F1 / U1 | DEF-01 | "not checked" for a `not_run` sheet that changed since its last commit (Q-i). Shown on the card, as a review banner, as the summary line "Parsed, not checked: X" and as the footer " · N not checked". `cardCheck` is unchanged. |
| F2 | measurement | Site-config `boq_ai_evaluation_exclude_boqs`, added to the look-up exclusion in `build_guidance`. Absent or empty, the guidance is identical (hash-pinned). Filled for the S6 re-run only, then emptied and removed. |
| F3 / U2 | DEF-03 | The reason Mark Finalized is off shows as text beside it, with the open Excel rows: up to 20, then "and N more", as the backend refusal words it. |
| F4 / U3 | DEF-04 | `RoleRoute` shows "Checking access…" while the role is "Loading", on every route it guards (Q-e). |
| F5 / U4 | DEF-05 | Hub subtitle: Map sheets before parsing / Review parsed sheets / Ready to commit / Committed. Footer "{a} of {n} data sheets set up", and the Finalized count labelled "finalized". |
| F6 / U5 | DEF-06 | Review Change list + `save_review_edit` / `save_review_restructure` accept `subtotal_marker` (a review-only set). Shared set, template paths, `header_repeat` and the parser unchanged. |
| F7 / U6 | DEF-07 | A fully reverted row reads "Original"; `isReviewRowEdited` now uses `has_override` and value / text history, and the CSV follows it (Q-g). A revert entry reads "Reverted: Note → Preamble" / "Reverted parent: → row 8" (Q-h). The stored reason "reverted to parser" is unchanged. |
| F8 / U7 | DEF-08 | Enter in the review search scrolls to the match, then steps; Shift+Enter steps back. |
| F9 / U8 | DEF-09 | Column-map rows keep their place while the user picks columns (`stableOrder.ts`). |
| F10 / U9 | DEF-10 | The upload-status poll keeps running while the tab is hidden (`refreshWhenHidden`). |
| F11 | DEF-11 | Not a defect: the doctype is `BOQ Upload Review AI Settings`; the S5 script used a wrong-case name. No repair. |
| F12 / U10 | DEF-12 | "Changed since last commit" = never committed, or `last_parsed_at` later than `committed_at`, decided in the browser (`hubState.ts`). The commit dialog pre-selects only those sheets; the card reads "Re-parsed after vN — tendering still uses vN. Finalize and commit to update it."; the sub-label reads "re-parsed after vN". The gate, validation and writes are unchanged. Gap accepted (Q-f): a re-finalize without a re-parse is not detected. |
| F13 / U11 | queued | History reasons are shown with the Excel row. Stored reasons keep the internal index, because the revert cascade reads it back. |

## Approved wording (U1-U11)

- **U1:**
  - card: `not checked`
  - banner: `This sheet's rows were not checked automatically. Look over every row yourself before finalizing.`
  - summary: `Parsed, not checked: FPS`
  - footer: ` · 1 not checked`
- **U2:** `Check the 2 flagged rows before finalizing: rows 26, 44.`
- **U3:** spinner + `Checking access…`
- **U4:**
  - subtitle: `Map sheets before parsing` / `Review parsed sheets` / `Ready to commit` / `Committed`
  - footer: `{a} of {n} data sheets set up · {p} parsed · {f} finalized · {c} committed`
- **U5:** `Subtotal`
- **U6:**
  - pill: `Original`
  - history: `Reverted: Note → Preamble — {by} · {at} · reason: reverted to parser`
- **U7 / U8 / U9:** no text.
- **U10:**
  - card: `Re-parsed after v1 — tendering still uses v1. Finalize and commit to update it.`
  - dialog: `Sheets never committed, or re-parsed since their last commit, are selected. Tick any other sheet to commit it again.`
  - sub-label: `re-parsed after v1`
- **U11:** `parent moved: row 9 reclassified to note` (the Excel row).

## Consequences

- Every sheet named with a leading or trailing space now gets the automatic check on its next parse; dev2 had 279
  such drafts in 154 BoQs.
- Old sheets parsed before the automatic check existed show "not checked" only once they are re-parsed or were
  never committed (Q-i).
- The evaluation list must stay empty in production. It is read on every check, so a forgotten list would quietly
  thin Claude's examples.
- Protected entries changed, each named by an F-item:
  - `ai_run_log.py` (F1)
  - `boq_ai_guidance.py` (F2)
  - `save_review_edit` and `save_review_restructure` (F6, the target check only)
  - `ReviewTree.tsx` (F6, F7, F8, F13)
  `revert_to_parser`, `_apply_and_save_row_edit`, the commit gate / validation / pipeline, `parse_run.py` and
  `RestructureModal.tsx` are unchanged.
- DEF-02 (flag noise) is deferred to a review after a few weeks in production (V1). S7 merges into the main dev
  environment (V4).

# 38. A Tendering project's BoQs can be merged into a Won project, and the merge can be undone

Date: 2026-10-21

## Status

**Accepted** (owner, 2026-10-21: "okay go head"). Builds on [ADR-0037](0037-boq-selected-status-at-won.md)
(Selected BoQs). Adds the bid outcome **Merged** to the dual-field project model of
[ADR-0001](0001-project-tendering-status.md) v3.

## Context

Some tenders are won as part of a job that already exists as a Won project, for example an extra trade on a running
site. Converting the Tendering project would create a second Won project for the same job. The owner wants the
Tendering project's BoQs moved into the existing Won project instead, with a record of where they went and a way to
take the move back.

Two facts make an exact undo cheap:

- **A BoQ's project is stored in two places:** `BOQs.project`, and the `project` of its uploaded workbook's
  `Nirmaan Attachments` row. Every other BoQ table (sheets, rows, pricing, locks, AI runs) links by `boq`, and no other
  Dynamic-Link doctype holds a BoQ row (checked 2026-10-21). So moving a BoQ means changing those two and nothing else.
  *(Corrected after code review: the first version of this record said only `BOQs` stored a project.)*
- **A Tendering project's BoQs are Draft in every code path.** `before_insert` makes a BoQ on a non-Won project Draft,
  Selected is set only on Won projects (ADR-0037), and no code sets Approved or Superseded. Desk can still set a status
  by hand, so a merge refuses any BoQ that is not Draft (D2). That keeps "Undo restores Draft" exact without storing
  the old status.

## Owner rulings (2026-10-21)

- **Q1:** Merge and Undo are **Admin only**. Merging adds BoQs to a Won project, which ADR-0037 D3 already limits to
  Admin.
- **Q2:** **All** of the Tendering project's BoQs move. With a partial pick, the rest would be stranded on a project
  nobody works on.
- **Q3:** Three schema changes approved: the `Merged` option, `Projects.merged_into` and `BOQs.merged_from`.
- **Q4:** Keep version numbers as they are. A merged "Electrical BOQ v1" can sit beside the Won project's own
  "Electrical BOQ v1", and the "from …" note tells them apart.
- **Q5:** The target is any Won project **except Completed**.

## Decision

| # | Decision |
|---|---|
| D1 | **Schema.** `Projects.tendering_status` gains the option `Merged`. `Projects.merged_into` (read-only Link to Projects) names the Won project a Merged project went into. `BOQs.merged_from` (read-only Link to Projects) names the Tendering project a merged BoQ came from. |
| D2 | **Merge.** Admin only; only from a `Tendering` project with at least one BoQ, **every one of them Draft** (any other status is refused by name); only into a Won project (`tendering_status = Won`) whose execution `status` is not Completed, and never into itself. In one transaction, every BoQ of the project gets `project` = target, `merged_from` = the Tendering project and status **Selected**, and its attachment rows' `project` = target. The Tendering project gets `tendering_status = Merged` and `merged_into` = target. |
| D3 | **Undo.** Admin only; only from `Merged`. It finds the BoQs with `merged_from` = this project, which is exactly the set the merge moved, however many other BoQs the Won project has or receives from other merges. Each must be Selected or Draft (any other status is refused by name); each gets `project` back, `merged_from` cleared and status **Draft**, and its attachment rows go back too. The project returns to `Tendering` with `merged_into` cleared. Edits made on the Won project travel back with the BoQs. |
| D4 | **Undo is refused** when a revision link (`source_boq`) crosses between the merged BoQs and the BoQs that stay in the Won project, in either direction: a staying BoQ revising a merged one, or a merged BoQ revising a staying one. Undoing would split the pair across two projects. The refusal names the BoQs. A deleted source does not block. |
| D5 | **One target at a time.** A Tendering project merges into exactly one Won project. Moving it elsewhere means Undo, then Merge again. A Won project can receive any number of merges, each undone independently. |
| D6 | **A Merged project is closed until undone.** Edit, Convert to Won, Mark as Lost and Delete are refused (they already require Tendering, or Tendering/Lost for Delete), and no BoQ can be added to it. It stays out of every operational picker and endpoint, because those already require `tendering_status = Won`. |
| D7 | **Screens.** The Tendering overview gains a "Merge BoQs" button (Admin; disabled without BoQs) and a dialog that picks the Won project and lists the BoQs that will move. A Merged project shows "Merged into X" with **Undo merge**, and its BoQs tab says where they went. The Tendering list gains a **Merged** sub-tab with a "Merged into" column. On the Won project's BoQs tab, a merged BoQ carries "from X" under its name. |
| D9 | **No merge (and no undo) while a BoQ is being edited** (owner 2026-10-21: "while someone edit mean we not allow to merged"). Busy means a FRESH single-editor lock on any of the BoQs' sheets -- someone in Configure / Review (draft tier) or Pricing who has changed something and not left, renewed every ~30 s and released on leave, stale after 2 min -- or `parse_in_progress`. Just viewing a page holds no lock and does not block (Q1 a). The dialog lists who, which sheet, which screen, how long ago, re-checks every 30 s with a "Check again" button and keeps the button disabled; the server refuses the same way (`pricing_lock.fresh_locks_for_boqs`, `tendering_merge.get_merge_blockers`). The Merge dialog also says, in small text, that merging does not change the target's packages. |
| D8 | **Project writes use `set_value`**, the same as Mark as Lost. A pre-Won project's Projects hooks concern operational projects and have nothing to do here. Each BoQ is moved through `doc.save()`, so the BoQ's own Version row records who moved it. |

## Considered options

- **Find the merged BoQs without a field** (by name, date or the change history). Rejected: names and dates can match
  the Won project's own BoQs, and history is not a query.
- **Renumber versions on merge.** Rejected (Q4): the BoQ would look like a revision of the Won project's own BoQ, and
  Undo would need a fourth field to restore the old number.
- **Let the user pick which BoQs to merge.** Rejected (Q2).

## Consequences

- The Selected option of ADR-0037 must be live first, because a merge sets Selected.
- The new fields' links protect the trail: neither the Merged project nor its target can be deleted while a merged BoQ
  points at it.
- Who merged is visible on each moved BoQ's history; the Projects row records no Version (D8).

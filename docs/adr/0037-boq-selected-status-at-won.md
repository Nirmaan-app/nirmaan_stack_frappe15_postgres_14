# 37. A Won project's BoQs are split into Selected and Other; only Admin moves a BoQ between them

Date: 2026-10-21

## Status

**Accepted** (owner, 2026-10-21: "update and starting implemented our plan"). The design was settled in a grilling
session on 2026-10-21. It builds on the uncommitted convert-wizard BoQ step (`BoqSelectionStep`, `convert_boq_options`,
`controllers/boqs.award_project_boqs`). Before this decision, that step set picked BoQs to `Approved` and the rest to
`Superseded`. It amends one fact recorded in [ADR-0014](0014-boq-revised-upload-and-carry.md): `BOQs.status` now
leaves `Draft`.

## Context

Converting a Tendering project to Won used to carry every BoQ across unchanged. No BoQ ever left `Draft`: on
localhost, restored from production, all 266 project BoQs are `Draft`, including the 6 on the 105 Won projects. Many
tendering projects hold several BoQs, either one per trade or several versions of one BoQ (Bangalore-PROJ-00182 has v1
to v4). Once the job is won, the team should work only on the BoQs the job was won on.

"Won project" here means `Projects.tendering_status = "Won"`, which is permanent. It does not mean the execution
`status`, which moves on from *Won* to *WIP* and beyond.

## Owner rulings (2026-10-21)

- Use a new status, **Selected**, for the picked BoQs. Keep `Approved` and `Superseded`: *"just we adding this new
  status ... maybe in future they can use approved superseded"*.
- **At Convert:** pick one or more BoQs, and every pick becomes Selected. A pick is required whenever the project has
  BoQs. The picker keeps its current list (every version, newest first, "Latest" tag).
- **After Won:** only an Admin adds a BoQ, and it is Selected at once: *"after win admin only added they upload BOQ
  while happening like this BOQ already in Selected status"*.
- **Revisions:** when an Admin uploads v2 of a Selected v1, v1 stays Selected until an Admin moves it to Draft.
- **Admin moves BoQs between the two tables:** "Mark as Selected" and "Move to Draft", several at a time. Only an
  Admin sees the checkboxes. Emptying the Selected table needs a warning dialog.
- **Who sees what:** non-Admins see the Other table without a pencil, but a row still opens the read-only viewer. Show
  no status badge or column; the split into two tables says it all.
- **Enforcement:** *"keep screen only for now"*.
- **Old Won projects:** a patch is decided after the build: *"after they completed they current workflow -> we check
  about they patches for old things"*.

## Decision

| # | Decision |
|---|---|
| D1 | `BOQs.status` options become `Draft \| Approved \| Superseded \| Selected`, with Selected appended. `Approved` and `Superseded` stay in the schema with nothing setting them, and their existing rules stay as they are: Superseded cannot be set by hand or reopened, an Approved BoQ's nodes cannot be deleted, and Approved cannot go back to Draft. |
| D2 | **Convert to Won.** The wizard's BoQ step lists every non-Superseded BoQ of the project, grouped by name with the newest version first and tagged "Latest". It is multi-select and pre-ticks nothing. When the project has BoQs, at least one must be picked; with none, the step says so and lets the user continue. Continue changes no status. On Create, inside the conversion's own transaction, every picked BoQ becomes **Selected** and every unpicked BoQ **stays Draft**. Nothing becomes Superseded. |
| D3 | **Adding a BoQ after Won** (upload, revision or create-from-template) stays Admin-only (`assert_can_add_boq`, server-side). The new BoQ is created **Selected**, not Draft. |
| D4 | **Only two things change a BoQ's status:** Convert (Draft → Selected) and an Admin action, "Mark as Selected" (Draft → Selected) or "Move to Draft" (Selected → Draft). Editing never changes status: parse, review, commit, pricing and AI write no status. A revision does not demote its source. |
| D5 | **Won project BoQ tab.** Two tables with today's columns: **Selected BoQs** and **Other BoQs**. The existing Status column keeps showing wizard progress, and there is no BoQ-status badge. Other BoQs appears only when it has rows. When the project has BoQs but none Selected, the Selected table shows "No BOQ selected"; when the project has no BoQs at all, today's empty card stays. The Tendering page is unchanged: one table. |
| D6 | **Access on the Won tab.** Selected BoQs: the pencil follows today's rule (`canOpenBoqWizard`). Other BoQs: only an Admin gets the pencil; for everyone else, a row opens the read-only viewer. Admin means `Administrator` or the `Nirmaan Admin Profile`. |
| D7 | **Admin bulk action.** Only an Admin sees a checkbox column and, while boxes are ticked, a bar under the table: "N checked · Mark as Selected" (Other) or "N checked · Move to Draft" (Selected). The header box ticks the whole table, and there are no extra per-row buttons. A confirm dialog lists the BoQ names. If the move would leave no Selected BoQ, the dialog becomes a warning. Moving the last Selected BoQ is allowed. |
| D8 | **Enforcement is screen-only for now.** The Selected rule is not checked on the server. |

## Considered options

- **Reuse `Approved` for the pick** (the earlier build). Rejected: the owner wants `Approved` and `Superseded` kept free
  for a possible future approval and versioning flow.
- **Supersede the unpicked BoQs and hide them from non-Admins.** Rejected: unpicked BoQs stay Draft and visible to
  everyone; only editing them is Admin's.
- **Auto-demote v1 when a revision v2 becomes Selected.** Rejected in favour of explicit Admin action, at the cost of
  two Selected versions sitting side by side until an Admin tidies up.
- **Server enforcement.** It was mapped and deferred, not rejected. No single choke point covers every BoQ write:
  - The editing lock (`pricing_lock.acquire_or_refresh`, placed above its break-glass return) covers 26 row and cell
    write endpoints.
  - The BOQs `validate` / `on_trash` doc events cover Desk, REST and the revision saves. The award flow would need a
    flag, because the project is already Won when its BoQs are saved.
  - About 12 endpoints write without taking any lock (parse, commit, classify, sheet status and label, BCS toggle,
    rate suggestion, mark sheet done) and would each need an explicit call.

## Consequences

- **Known gaps of D8:**
  - A non-Admin can still write to an Other BoQ through the API or a bookmarked wizard URL.
  - Six roles with write permission on BOQs (System Manager, Procurement Executive, Project Lead, Project Manager,
    Estimates Executive, Design Lead) can change `status` by hand in Desk.
- **Old Won projects:** their BoQs are all Draft, so they show under Other BoQs, and only an Admin can edit them until
  the follow-up patch (to be decided) marks them Selected.
- **Version is not the same as Selected.** `BOQs.version` still counts per `(project, boq_name)`. Revisions still point
  at the BoQ they were made from, not at the previous version. "Selected" means live scope, not "latest version".
- **Migrate needed:** adding the `Selected` option is a doctype schema change, so it needs a migrate on each site.

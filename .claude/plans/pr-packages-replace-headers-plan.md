# PR Packages — replace PR Headers with packages taken from the items

Status: **built 2026-10-13/14 on branch `pr/header-remove`, staged, not committed. Patches P3 + P2 written and
run on localhost 2026-10-14. Section 0 overrides anything below it that disagrees.**
Shared copy: https://claude.ai/code/artifact/cd0bfe39-cf1a-4dd9-a6db-1ad3f6c6e3e0 ("PR Packages Plan").

## 0. As built (2026-10-13/14) -- what changed from the plan below

- **PR Tracker is computed LIVE, not stored.** A two-connection test showed a stored `Critical PR Tags`
  record cannot be updated safely: Frappe runs PostgreSQL at REPEATABLE READ, so the second of two
  concurrent saves never sees the first one's commit, even after waiting on a lock -- it hit a duplicate
  name (and would otherwise drop a PR). So `get_projects_with_pr_stats.py` now groups `pr_tag_list` rows in
  SQL (`get_projects_with_critical_pr_stats`, new `get_project_pr_packages`), and `Critical PR Tags` is
  neither read nor written. Consequences: **P1 is dropped**; no tracker naming change; no PR
  `after_insert` / `on_update` / `after_delete` tracker hooks. Live vs old stored stats on localhost: 98 = 98
  projects, 5,419 = 5,419 PRs once the 240 deleted-PR references are left out; every other per-project
  difference explained (3 PRs the old tracker missed, 3 it listed under the wrong project).
- The store's sessionStorage version was NOT bumped: only fields were removed, so an old draft rehydrates
  fine (the stray `selectedWP` key is ignored).
- Built: `services/pr_packages.py` (+23 tests), `integrations/controllers/procurement_request_packages.py`
  (+19 lifecycle tests, rolled back, notifications mocked), the PR `validate` wiring, PR summary API returns
  packages only (de-duplicated, chunked), the frontend in section 7 (+ `utils/prPackages.ts` parity test),
  domain doc `procurement.md`.
- Data-table code (`api/data_table/*`, `useServerDataTable.ts`, `components/data-table/*`) is NOT changed (owner,
  2026-10-14): the PR tables only swap the header column for a Packages column. The "Packages" search option
  is `pr_tag_list` with `is_json: true`, i.e. the existing child-table search in `CHILD_TABLE_ITEM_SEARCH_MAP`;
  the package filter and its counts use the existing child-table JOIN (a PR carrying two selected packages
  shows twice, as before).
- **Only the PR's own items count (owner, 2026-10-14).** Rule 4 (keep packages a live PO's items carry) is
  removed: PO items are never read. Develop never read them either. A merged PO shows under the packages of
  the one PR it points to; an old header-only package is dropped if its PR is ever rebuilt (Critical PO links
  stay -- they live on the PO).
- **Patches** (section 8): `v3_0.pr_tags_one_row_per_package` (P3) then `v3_0.pr_tags_add_item_packages`
  (P2, add-only), registered in that order. Both ran on localhost 2026-10-14 (Patch Log 11:11 / 11:33):
  9,382 → 5,441 rows, then +1,034 rows on 948 PRs. Their dry runs now plan 0 (idempotent).
- PR Tracker: PRs with no project are skipped (as before). The detail endpoint limits PM / PL / procurement
  to their projects; other roles can read any project, like the list (owner: fine).
- Critical PO "Select Package" = the project's enabled packages + every package its PRs carry
  (`buildPackageOptions`), and the Edit Task blank space is fixed: `critical-po-package-picker-plan.md`.
- One package-chip renderer for every PR table: `components/procurement-request/PRPackageChips.tsx`.
- Approve page / Custom PR live chips are NOT given the category + valid-package lookups (owner: the server
  saves the right package; a misspelt item package shows as typed until saved).
- NOT done, owner-declined: dropping an old `PR Tag Child Table.tag_header` URL filter (section 7, edge
  case 14, browser check 8) -- it would need a shared data-table change. An old saved link with a Header
  filter shows an empty list until the filter is cleared.
- Superseded by the live tracker: section 7 "Backend: PR Tracker", edge cases 1-5, tests 17-21, P1.
- Still to do: the saving steps of the browser checklist (create / approve / Critical PO save -- the
  non-saving checks passed 2026-10-14 as a Procurement Lead and an Admin), commit, then the schema clean-up
  (`pr-tag-table-cleanup-plan.md`, needs approval).

## 1. The change

1. **No header step.** New PR (normal and custom) opens straight on the item list. Edit and resolve too.
2. **Packages come from the items.** A server hook on every PR save writes the PR's packages from its items.
   Nobody picks or edits a package by hand.
3. **One row per package, no header.** `pr_tag_list` holds each package once, `tag_header` empty. Old PRs
   are cleaned the same way (P3).
4. **Screens show packages.** PR lists, approval lists, the project PR summary, hover cards, the Approve page
   header and the PR Tracker show and filter by package.
5. **PR Tracker groups by package.** The "PR Header Packages" settings tab is removed.

## 2. The package rule (exact)

A PR's packages are built like this, then written as one `pr_tag_list` row per package (sorted, header empty):

1. Read **every** `order_list` row, whatever its status (Pending, Approved, Delayed, Sent Back, Deleted…).
   Why: 9 PRs whose items are all `Deleted` still have 10 live POs. Dropping Deleted items would push those
   POs out of their package in the Critical PO picker.
2. The row's package is its `procurement_package` if that is a real Procurement Package; otherwise its
   category's package (`Category.work_package`); otherwise the row adds nothing. (Today: 8 items have a blank
   package but a mapped category; 1 has the typo `Electrial Work`.) An unknown name is skipped, never saved:
   it would fail the Link check and block the save.
3. `Additional Charges` never counts.
4. ~~When rebuilding, also keep any package a live PO of this PR still carries.~~ **Removed (owner, 2026-10-14):**
   only the PR's own items count; a PO's items never add or keep a package.

When the hook acts:

| Save | Action |
|---|---|
| Create (any path) | Rebuild from items. Whatever the client sent is replaced. |
| Update where the item-package set changed, or the request changed the tag rows | Rebuild from items |
| Any other update where rows repeat a package or carry a header | Collapse: same packages, one row each, header empty |
| Any other update | Nothing |

Status-only changes never change the set (rule 1). So approval, vendor quotes, sent back and SB delete
never rebuild. Packages cannot be set by hand: tag rows sent by a client or edited in Desk are rebuilt.

## 3. Every way a PR changes, and what happens

No code writes PR items with raw SQL (checked), so every path below runs the hook.

| Path | Where | Packages | PR Tracker |
|---|---|---|---|
| Create normal PR | `useSubmitProcurementRequest.ts` → `createDoc` | built from items | PR added under each package |
| Create custom PR | `custom_pr_api.new_custom_pr` | built from items (`tags` ignored) | added |
| Auto-approval right after create (second save) | `integrations/controllers/procurement_requests.after_insert` | no change | no change |
| Edit draft / resolve rejected PR | `useSubmitProcurementRequest.ts` → `updateDoc` | rebuilt if item packages changed | follows |
| Resolve custom PR | `custom_pr_api.resolve_custom_pr` | rebuilt if item packages changed | follows |
| Approve page: add item | `useApprovePRLogic.ts` → `updateDoc` | package added if new to the PR | added |
| Approve page: delete item (row removed) | `useApprovePRLogic.ts` | package removed if it was the last item with it | removed |
| Approve page: edit item (qty, make, comment only) | `useApprovePRLogic.ts` | no change | no change |
| Approve / reject PR (final save) | `useApprovePRLogic.ts` | as the edits above | as above |
| Send vendor quotes (items → Delayed) | `api/send_vendor_quotes.py` | no change | no change |
| Reject vendor quotes (→ Sent Back; Additional Charges rows removed) | `api/reject_vendor_quotes.py` | no change | no change |
| Approve vendor quotes (→ Approved, POs made) | `api/approve_vendor_quotes.py` | no change | no change |
| Sent Back request deleted (PR items → Deleted) | `sent_back_category.py:181` | no change (Deleted still counts) | no change |
| PO cancelled (items to a new Sent Back) | `api/handle_cancel_po.py` | PR not saved | no change |
| Desk: edit items | Desk | rebuilt from the items only | follows |
| Desk: edit tag rows | Desk | rebuilt from items | follows |
| Desk: duplicate a PR | Desk | built on create | added |
| PR deleted (incl. `delete_custom_po_and_pr`) | PR `after_delete` | — | **removed (new; today it stays)** |
| Old cached frontend sends header rows | any | rebuilt from items | follows |

## 4. Critical PO linking

- **It reads the package, never the header.** "Link New POs" and "Edit Task" (`LinkPODialog.tsx`,
  `EditTaskDialog.tsx`) call `filterPOsByPackage` (`CriticalPOTasks/utils.tsx:194`), which reads each PO's PR
  and that PR's `tag_package` rows (`useCriticalPOQueries.ts:41`). Linking from the PO page
  (`useCriticalPOTaskLinking.ts`) uses task categories only.
- **No code change needed there.** `tag_package` stays filled.
- **Existing links stay.** Links live on the PO (`Critical PO Task Child Table`). A package change only
  changes which POs the picker lists.
- What users see: a new PR's POs appear under every package its items have. If an approver adds a package,
  the PR's POs appear under it too. After P2 (add-only), old POs also appear under packages their PR was
  missing; no PO disappears from a package.
- Known limit (unchanged): a PO is matched by its PR's packages, not by its own items.

## 5. Today (localhost DB, 2026-10-13)

| What | Count |
|---|---|
| PRs | 5,422 (5,211 Normal, 209 Custom, 2 Electrical Work); all docstatus 0 |
| PR tag rows | 9,380, all with a header. Distinct PR + package pairs: 5,439 |
| PRs with a package repeated | 1,329, all HVAC System (3,941 extra rows) |
| PR Tag Headers | 15; 14 map 1:1 to a package, HVAC System has 4 |
| PRs whose item packages (rule above) differ from their tags | 955: 948 miss a package their items have; 393 carry a package their items don't (377 of those have POs, 458 POs) |
| PRs with no package under the rule | 2 |
| PRs with every item Deleted | 187; 9 of them have 10 live POs |
| PR Tracker docs | 572, named project number + **header**; 388 project + package groups |
| Tracker drift | 240 references to deleted PRs; 3 tagged PRs missing; 3 listed PRs not tagged |

## 6. Decisions to confirm (recommended default first)

| # | Question | Recommended |
|---|---|---|
| D1 | Which table holds packages? | Keep `pr_tag_list`; fill only `tag_package`; header empty; one row per package. No new doctype, no field change. |
| D2 | Which items count? | The rule in section 2. |
| D3 | When does the hook act? | The table in section 2. |
| D4 | PR Tracker | One record per project + package; Headers column and filter removed. |
| D5 | Old PRs whose tags differ from items | **P2 add-only**: add the item packages old PRs are missing (948 PRs gain), never remove (0 lose, no PO leaves a package). A full re-derive is not recommended: 458 POs would leave a package. |
| D6 | "PR Header Packages" settings tab | Remove the tab. Keep the 15 header records: an old cached frontend may still send header names, and the Link must validate. |
| D7 | Header values on old rows | P3 clears them (HVAC sub-type history goes; no screen shows it after this change). |

## 7. Changes by part

### Backend: the rule

- New module `nirmaan_stack/services/pr_packages.py` owns the rule (ADR-0010 residence: one owner):
  `derive_pr_packages(doc)`, `sync_pr_packages(doc)`, `refresh_pr_tracker(project, package)`.
- `integrations/controllers/procurement_requests.validate`: call `sync_pr_packages(doc)` last. The rows save
  in the same write: no second save, no loop.
- The hook never throws. It only reads, and skips unknown packages. This matters because
  `sent_back_category.py` saves the PR inside `try/except Exception`: on Postgres a swallowed DB error
  rolls the transaction back silently.
- `custom_pr_api.new_custom_pr` / `resolve_custom_pr`: stop writing `tags`; the argument stays, ignored.

### Backend: PR Tracker

- `Critical PR Tags.autoname` (controller only): `{project number}-{package}` instead of
  `{project number}-{header}`. **Without this, two packages in one project get the same name, the insert
  fails, and the PR save fails with it.**
- PR doctype controller `after_insert` / `on_update`: for each package added or removed, call
  `refresh_pr_tracker`.
- `refresh_pr_tracker(project, package)`:
  1. Take a Postgres advisory lock for (project, package): `pg_advisory_xact_lock(hashtext(...))`.
  2. Recompute the PR list from the tag rows (never +1/−1).
  3. Find every tracker record for (project, package), keep one and delete the extras. Old HVAC header
     records merge on first touch, so saves between deploy and P1 are safe.
  4. Write the list with header empty; create the record if missing; delete it when the list is empty.
  - The lock stops two PRs saved at once from creating two records or overwriting each other. Today the
    second save can fail with "Document has been modified".
- PR `after_delete` (already wired in `hooks.py`, body is `pass`): refresh the deleted PR's packages.
  `after_delete`, not `on_trash`: `on_trash` runs before Frappe's link check, so a refused delete would
  still have changed the tracker.
- `api/critical_pr_tasks/get_projects_with_pr_stats.py`: stop reading PR Tag Headers. Used = distinct
  packages; total = the project's enabled packages plus any used package not enabled, so used ≤ total.

### Creation screens

| Screen | File | Change |
|---|---|---|
| New / edit / resolve PR | `NewPR/NewProcurementRequestPage.tsx` | Remove the header page; open on items. Makes = all project packages + Tool & Equipments. |
| PR form state | `NewPR/store/useProcurementRequestStore.ts`, `hooks/useProcurementRequestForm.ts`, `types/index.ts` | Remove `selectedHeaderTags`, `setSelectedHeaders`, `selectedWP`, `SelectedHeaderTag`. sessionStorage version 4 → 5 with a migrate that keeps the items and drops the header fields, so a tab open during deploy keeps its draft. |
| Submit | `NewPR/hooks/useSubmitProcurementRequest.ts` | Stop sending `pr_tag_list`. Remove the `selectedWP` guard (it would block every submit). |
| Item picker | `NewPR/components/ItemSelectorControls.tsx` | Live Packages chips from the item list; remove the Reset dialog. |
| New item dialog | `NewPR/components/NewItemDialog.tsx` | Remove header chips. |
| Header picker | `NewPR/components/WorkPackageSelector.tsx` | Delete. |
| Custom PR | `NewPR/NewCustomPR.tsx`, `helpers/ProcurementHeaderCard.tsx` | Start on items; remove "Back to Header"; stop sending `tags`; card shows packages from the rows. |
| Shared helper | new `src/utils/prPackages.ts` | Mirrors the rule for live chips (the server decides what is saved). |

### Approve page

- `ApprovePRHeader` chips come from the live `order_list` (the helper), not `pr_tag_list`. The page keeps
  the PR in local state and does not refetch after each save, so tags there would be stale.
- `ApprovePRContainer` makes list: no change (already adds all project packages).

### Display screens

| Screen | File | Change |
|---|---|---|
| PR list | `ProcurementRequests/procurement-requests.tsx` | "Headers" column → "Packages"; filter on `tag_package` |
| Approve PR list | `ApproveNewPR/approve-pr.tsx` | same |
| Approve vendor quotes list | `ApproveVendorQuotes/approve-select-vendor.tsx` | same |
| PR search options | `config/prTable.config.ts` | search option `pr_tag_list` (`is_json: true`) |
| Project → PR summary | `projects/components/ProjectPRSummaryTable.tsx` | column, filter, search |
| PR cards | `procurement-request/list-pr.tsx` | packages |
| Hover card + badge | `helpers/HeaderHoverCard.tsx` | packages |
| PR Tracker | `PRTracker/components/*`, `pr-tracker-detail.tsx` | no header column/filter; sort by package; card counts packages |
| Packages Settings | `PackagesSettings/config/packageSettingsTabs.constants.ts` | remove tab; delete `PRHeaderTagMaster.tsx` |

- Every display de-duplicates packages until P3 has run.
- ~~On the 4 PR tables, drop a URL filter on `PR Tag Child Table.tag_header`.~~ Not done (owner: no
  shared data-table change); see section 0.

No change: vendor-quote selection (`ProcurementProgressContainer.tsx`), `api/projects/pr_summary.py`,
`api/data_table/constants.py`, Critical PO.

### Docs

`.claude/context/domain/procurement.md`: packages come from items via `services/pr_packages.py`;
`tag_header` is legacy and blank; tracker keyed by package.

## 8. Data patches (I write and dry-run; you run them)

Run order after deploy: **P3 → P2**. (P1 is dropped: the tracker is computed live, see section 0.)

| Patch | Does | Expected (localhost) | Dry-run proof |
|---|---|---|---|
| P3 | One row per package on every PR; clear `tag_header`. Does not read items. | 9,380 rows → 5,439; 1,329 PRs touched | Package set per PR before = after (DIFF 0); 0 repeats; 0 headers |
| P2 (add-only, D5) | Add item packages each old PR is missing | 948 PRs gain a package; 0 lose | Full list of PR → added packages; 0 removals |
| ~~P1~~ | Dropped: the tracker is computed live | — | — |

P3 and P2 write with SQL, so no hooks fire. That is safe because the tracker is computed live from the rows
and nothing stores anything derived from them. PR `modified` is not touched. Ran on localhost 2026-10-14:
P3 9,382 → 5,441 rows; P2 +1,034 rows on 948 PRs.

## 9. Bugs and edge cases this plan closes

| # | Risk | Handled by |
|---|---|---|
| 1 | Tracker name built from header → same name for every package → PR save fails | Tracker named by package |
| 2 | Two PRs for one project + package saved at once → duplicate record, lost PR, or "Document has been modified" | Advisory lock + recompute from rows |
| 3 | Old header records and new package records side by side before P1 | Merge on first touch |
| 4 | Deleted PRs stay in the tracker (240 today) | `after_delete` refresh; P1 cleans the old ones |
| 5 | Refused delete still changes the tracker | `after_delete`, not `on_trash` |
| 6 | All-Deleted PR with live POs loses its package → POs leave the Critical PO package | Deleted items still count |
| 7 | Desk edit after POs removes a package POs rely on | Not guarded: owner ruled PO items are never read (section 0) |
| 8 | Blank, typo or unknown item package blocks the save | Skipped; category fallback |
| 9 | Additional Charges counted as a package | Excluded |
| 10 | Old cached frontend sends headers or a package twice | Rebuilt from items |
| 11 | Hook error swallowed inside the SB-delete `try/except` → silent rollback | Hook only reads and never throws |
| 12 | Approve page chips stale after add/remove | Chips from live items |
| 13 | Draft from the old bundle in sessionStorage | Store version 5 + migrate |
| 14 | Old link with a Header filter shows an empty list | Not handled (owner: no shared data-table change) |
| 15 | HVAC PRs counted several times in package filters before P3 | Displays de-dupe; P3 |
| 16 | Tracker card shows used > total | Total = enabled ∪ used |
| 17 | P2 removes packages from PRs with POs (458 POs) | P2 is add-only |
| 18 | Auto-approval second save rebuilds rows | No item change → nothing |
| 19 | Old frontend posts header names after the tab is gone | Header records kept |
| 20 | Procurement Package renamed: item field (Data) keeps the old name | Category fallback (its Link follows the rename) |

## 10. Not changing, and known limits

- `work_package` stays the PR type (Normal / Custom). No new doctype, no field change, no DB unique index.
- `Critical PR Tags.header` stays in the schema, blank.
- A PO is matched by its PR's packages, not its own items (for example a merged PO).
- PO and PR notifications still say "for the Normal work package" (`procurement_orders.after_insert`,
  `procurement_requests` notifications): existing text, not changed here.

## 11. Testing

### Backend tests

New module `services/test_pr_packages.py`: own fixtures, rolled back. Also run the affected modules only
(`api/test_delete_custom_po_and_pr.py`, any test naming Procurement Requests or Critical PR Tags), never a
broad sweep.

| # | Case | Expect |
|---|---|---|
| 1 | Create with items from 2 packages | 2 rows, header empty |
| 2 | 3 items, same package | 1 row |
| 3 | Only Additional Charges; then mixed | no row; then the real package only |
| 4 | Blank package with mapped category; typo package; no category package | category package; category package; skipped; save succeeds |
| 5 | Items Deleted / Delayed / Sent Back | still counted |
| 6 | Create with client-sent header rows or a package twice | rebuilt from items, each once |
| 7 | Update: add item of a new package; remove the last item of a package | added; removed |
| 8 | Status-only save | no change |
| 9 | Old PR, header rows, no item change | collapsed, same packages, headers cleared |
| 10 | Old PR with 4 HVAC rows + 1 Electrical, no item change | 1 HVAC + 1 Electrical |
| 11 | Update that sends tag rows | rebuilt from items |
| 12 | Desk: remove the item whose package a live PO carries | package dropped (PO items are never read) |
| 13 | Auto-approval second save | nothing changes |
| 14 | `new_custom_pr` / `resolve_custom_pr` with `tags` | tags ignored |
| 15 | Sent Back request deleted → PR items Deleted | packages unchanged; save succeeds |
| 16 | Reject vendor quotes removing Additional Charges; send vendor quotes with delayed items | no change |
| 17 | Tracker: create PR | in each package record; name = number-package |
| 18 | Tracker: package dropped; last PR leaves | PR removed; record deleted when empty |
| 19 | Tracker: PR deleted; delete refused by a linked PO | removed; untouched |
| 20 | Tracker: old header records for one package, then a save | merged into one record |
| 21 | Two connections create the first PR for one project + package at once | one record, both PRs, no save error |
| 22 | Tracker stats | used ≤ total |

### Frontend

- Type-check the changed files (host `tsc`, scoped tsconfig).
- `yarn test`: `prPackages.ts` (same cases as backend 1–5) and the store migrate v4 → v5.

### Browser checklist (incognito; test login given for this test only)

1. New PR opens on items; add items from 2 packages → both chips; submit → PR view and list show both.
2. Edit a Draft PR, resolve a Rejected PR: no header screen; packages follow item changes.
3. Custom PR create and resolve: no header step; packages from the rows.
4. Approve page: add an item of a new package → chip appears without reload; delete it → chip goes; approve
   → list shows the final packages.
5. Makes dropdown lists the project's makes for each item's category.
6. Old HVAC PR shows one chip and counts once in the package filter.
7. Approve PR list, Approve vendor quotes list, Project → PR summary: Packages column, filter, search.
8. ~~An old link with a Header filter opens unfiltered~~ (not done, see section 0).
9. PR Tracker: one row per package; card numbers; a new PR appears under its package; a deleted PR leaves.
10. Critical PO "Link New POs": a new PR's PO under each of its packages; an already-linked PO stays linked.
11. Packages Settings: PR Header tab gone, other tabs load.
12. CEO Hold still blocks PR create.

### Data checks before commit

- P3: DIFF 0 per PR; 9,382 → 5,441 rows on the day it ran; 0 repeats; 0 headers. Package filter counts unchanged.
- P2: 948 PRs gain (1,034 rows), 0 lose.
- ~~P1~~: dropped.

## 12. Order of work and deploy

1. `services/pr_packages.py` + validate wiring + backend tests 1–16.
2. Tracker: naming, refresh, `after_delete`, stats + tests 17–22.
3. Creation screens + store migrate.
4. Approve page, display screens, tracker UI, settings tab.
5. Patches P3, P2 written and dry-run (P1 dropped); domain doc updated.

Deploy: backend and frontend together → `bench migrate` runs P3 → P2 (registered in `patches.txt`) → browser pass.

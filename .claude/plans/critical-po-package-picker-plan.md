# Critical PO "Link POs" package picker — before vs current vs fix

Status: **built 2026-10-14, staged on `pr/header-remove`.** Fix items 1, 3, 4, 5 are built; item 2 ("All
packages") was not built. Also fixed: the blank space under "Save Changes" in Edit Task (the PO list's
scroll box is `relative`, so Radix's hidden checkbox inputs stay inside it). Browser-checked 2026-10-14:
Paytm Bangalore lists Data & Networking and Tool & Equipments (65 POs), no blank space. Measured on the
localhost DB. Related: the staged PR-packages work
(`pr-packages-replace-headers-plan.md`) and `pr-tag-table-cleanup-plan.md`.

## How the dialog works (unchanged by the staged work)

Project → Critical PO tracker → **Link New POs** (`LinkPODialog.tsx`) or **Edit Task** (`EditTaskDialog.tsx`):

1. **Package dropdown** = the project's enabled packages (`project_wp_category_makes`) + "Custom".
2. **PO list** = the project's POs (status not Merged / Inactive) whose **PR's `pr_tag_list` packages**
   contain the chosen package (`filterPOsByPackage` in `CriticalPOTasks/utils.tsx`). A PO has no package
   of its own; it borrows its PR's. "Custom" lists POs whose PR has no package, or is a Custom PR.
3. Ticked POs are linked (stored on the PO). Already-linked POs are listed apart, never filtered.

The other way to link — **from the PO page** (`useCriticalPOTaskLinking`) — groups tasks by category and
never looks at packages. It is how hidden POs got linked anyway.

## The three states

| | BEFORE (committed, prod today) | CURRENT (staged code) | FIX (option A) |
|---|---|---|---|
| Where a PR's packages come from | Headers the user picked (a tools PR could be tagged "Electrical") | The PR's items (a tools-only PR gets only "Tool & Equipments") | same as CURRENT |
| Dropdown | Enabled packages + Custom | same | Enabled packages **+ every package the project's PRs carry** + Custom |
| Tool & Equipments in dropdown | Only if the project enabled it (14 of 105 projects) | same | Whenever a PO of the project carries it |
| POs NOT findable in the project dialog (of 5,332) | **138** (131 Tool & Equipments) | **370** if PRs are raised under the new rule (340 Tool & Equipments); 117 with P2 on old PRs | **0** |
| …of those linked anyway via the PO page | 56 | 187 | — |

Notes on CURRENT:
- Old PRs keep their stored tags until their items change, so on deploy day the count is still 138.
  It grows as new tools-only PRs are raised: under the new rule ~7% of POs would be unfindable, against
  ~2.6% before.
- P2 (add-only) helps old PRs a little (138 → 117) but cannot fix Tool & Equipments, because the
  dropdown still hides that package in most projects.

## Why it happened

The header picker always offered "Tool & Equipments" and let users tag tools PRs with the work they were
for (308 tools-only PRs were tagged with a work package; 201 with "Tool & Equipments", 146 of them in
projects without that package — the 138 hidden POs). The Critical PO dropdown never had that special case.
Taking packages from items removes the user's "this is for Electrical" choice, so every tools-only PR now
lands in the hidden case.

## The fix (option A)

| # | Change | File |
|---|---|---|
| 1 | One helper `buildPackageOptions(enabledPackages, prRows)` → sorted enabled ∪ packages carried by the project's PRs, then "Custom" ("All packages" not built). Both dialogs use it (the rule keeps ONE home, as `procurement.md` requires) | `CriticalPOTasks/utils.tsx` |
| 2 | ~~`filterPOsByPackage` returns every PO for `ALL_PACKAGES_OPTION`~~ Not built | `CriticalPOTasks/utils.tsx` |
| 3 | Fetch the project's PR packages when the dialog opens, not only after a package is picked (today `useCriticalPOProcurementRequests` waits for `selectedPackage`, so the options could not be built) | `data/critical-po/useCriticalPOQueries.ts` |
| 4 | Both dialogs: options from the helper | `LinkPODialog.tsx`, `EditTaskDialog.tsx` |
| 5 | Domain doc: the dropdown rule | `.claude/context/domain/procurement.md` |

Optional: mark packages the project has not enabled, e.g. "Tool & Equipments (not enabled)".

What it adds on localhost: 64 projects gain at least one dropdown option, mostly Tool & Equipments
(1,056 POs), then HVAC System (49), Electrical Work (23), Data & Networking (16), Fire Fighting (15).

Not changed: existing links, the PO-page linking, how a PO's package is resolved, the backend.

## Testing

- vitest on the helpers: options = enabled ∪ PR packages, sorted, Custom last; a package carried by a PR
  but not enabled appears; every added option finds its PO in `filterPOsByPackage` (`utils.test.ts`, 4 tests).
- Data check: with the new options, 0 of 5,332 POs unfindable (script used for the table above).
- Browser: a project without Tool & Equipments enabled and a tools-only PO → it shows under "Tool &
  Equipments"; link it; Edit Task shows it as linked; unlink still works.

## Order

Ship with the staged PR-packages work (it is what makes the gap grow), before any data patch.

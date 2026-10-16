# PR packages picked by the user — today's behaviour, without headers

Status: **REJECTED by the owner (2026-10-13): no package picker on PRs; packages stay derived from the
items (the staged work). Kept only as a record — do not build.**

## Goal

Keep exactly what prod does today, minus headers:

- On New PR / Custom PR the user still chooses what the PR is for, but picks **packages**, not headers.
  A tools PR for electrical work can still be tagged "Electrical Work".
- `pr_tag_list` holds **only packages, each once**, no header.
- Critical PO linking, PR lists and the PR Tracker work as today, reading those packages.

## Before vs this plan

| | BEFORE (prod today) | THIS PLAN |
|---|---|---|
| PR creation step | "Select PR Headers" (15 headers, HVAC split in 4) | "Select Packages": the project's enabled packages + Tool & Equipments (the same packages the header picker offered) |
| Saved rows | One per header: header + package (HVAC can repeat) | One per package, no header, never repeated |
| Edit draft / resolve | Re-opens the header picker with the saved headers | Re-opens the package picker with the saved packages |
| Approver adds an item of another package | Tags unchanged | Tags unchanged (same as today) |
| Critical PO dialog | Dropdown = enabled packages + Custom; PO under its PR's tagged packages | **Unchanged** |
| PR lists, filters, search | Header chips; Header filter; search broken | Package chips, Package filter, search fixed (from the staged work) |
| PR Tracker | Stored `Critical PR Tags` by header (drifts) | Live from `pr_tag_list` by package (from the staged work) |

## What changes in the staged work

**Kept as built:** package columns, filters and search on the four PR tables and the PR cards; the
child-table search/filter fix (`data_table/*`); the live PR Tracker; `Critical PR Tags` no longer written;
the "PR Header Packages" settings tab removed; the hover card and header card showing packages; the
old-link Header filter guard; `uniqueTagPackages`.

**Replaced:**

| Area | Staged (from items) | This plan (user picks) |
|---|---|---|
| New PR page | No selection step; live chips from items | A "Select Packages" step (cards, multi-select, at least one), then items as today. Chips show the picked packages; "Change" goes back to the picker (create mode clears the list, as today) |
| Store / form / types | Header fields removed | `selectedPackages: string[]` (+ setter); makes loaded for the picked packages, as today |
| Submit | Sends no `pr_tag_list` | Sends `pr_tag_list: [{tag_package}]`, one per picked package |
| Custom PR | No step; packages from rows | The same "Select Packages" step; sends the picked packages as `tags` |
| Approve page header | Packages from the live items | Packages from the PR's saved `pr_tag_list` |
| Server hook (`validate`) | Rebuilds rows from items; live-PO guard | **Normalises only**: drops blank or unknown packages, keeps one row per package, clears `tag_header`. Never reads items |
| `services/pr_packages.py` | Item rule + rebuild/collapse decision | Just the normalise rule (pure) + its tests |
| `utils/prPackages.ts` | `derivePRPackages` from items | Removed; `uniqueTagPackages` stays |
| Patch P2 (add item packages) | Optional | **Dropped**: tags are the user's choice |
| Patch P3 (one row per package, clear header) | Needed | **Still needed** |

The package picker is the old `WorkPackageSelector.tsx` turned from headers into packages (no
`PR Tag Headers` fetch).

## Edge cases

| Case | Behaviour |
|---|---|
| Project with no enabled packages | Picker shows Tool & Equipments only (today the header picker showed only its Tool & Equipments header) |
| Old PR with 4 HVAC header rows opened for edit | Picker shows "HVAC System" once; saving writes one row |
| Client still sends `tag_header` (old cached frontend) | Hook clears it; one row per package kept |
| Same package sent twice | Saved once |
| Desk / API save with no package | Allowed, as today (PR shows under "Custom" in Critical PO linking); the UI requires at least one |
| Package later disabled on the project | PR keeps it; still listed in lists and the Tracker |

## Testing

- Backend: normalise rule (blank, unknown, duplicate, header cleared, order); save paths: create, edit,
  custom PR, a request with headers and duplicates, a status-only save leaves rows untouched.
- Frontend: picker shows enabled packages + Tool & Equipments; at least one required; edit/resolve
  preloads; submit payload; type-check the changed files.
- Browser: create a tools PR tagged "Electrical Work" → its PO shows under Electrical Work in Critical PO
  linking (today's behaviour); lists, filters, search, PR Tracker as staged.

## Order

1. Rework the staged work as above (frontend picker + normalise-only hook + tests).
2. Ship it; then patch P3 (one row per package, clear header).
3. Later, with approval: drop the `tag_header` field/column, the `PR Tag Headers` and `Critical PR Tags`
   doctypes (`pr-tag-table-cleanup-plan.md`).

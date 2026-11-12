# BOQ Estimates — browser walk

The Estimates tab on a project page (after **BoQ**) has three sub-tabs: **BOQ View**, **Line Item View** and
**Estimate Items**. A line item's materials are saved as one *BOQ Line Estimate*. This script lists what has been
walked, and what is still to check.

IDs (FT-, EC-, REG-) match the Results tab of the plan page:
https://claude.ai/artifact/QdDuSnyHvvdgRgnSfuqH8L

How Normal and Custom items work, with the 9-step test results:
https://claude.ai/artifact/4yeSvnnYSbtjYpFNbCDXGF

Real project, user and BOQ names are left out of this file (the repo is public). Below, **Project A** is a Won
project on the dev site with 4 Selected BOQs; **BOQ A1** is its HVAC BOQ with sheets *HVAC LOW SIDE* (71 line
items), *VAV* (30) and *VRF & CHW units-Critical rooms* (63). **Project B** and **Project C** are a Project Manager's
own projects, whose Selected BOQs have no committed sheet yet.

## How to walk

- Dev site: `http://localhost:8080`. Log in through the login form, one browser profile per user.
- Get to the tab like a user: **Projects → (project) → Estimates**. Don't type deep URLs, except in the one test
  that checks a shared link.
- Who may edit: **Admin, PMO and Estimates** role profiles only, and only on projects their User Permissions allow.
  Everyone else with access sees the estimates but can't change them.
- Clean up after each session: on every line you used, **Edit → Remove** each item **→ Save**. Then sign out.

**Status on 2026-11-11:** none of the walks' estimates is left; all test users signed out. (One estimate on another
BOQ of Project A, created by Administrator outside these walks, was left alone.)

---

## Done — first walk, 2026-11-11, as an Estimates user

| ID | Check | Result |
|---|---|---|
| — | Estimates tab shows right after BoQ | Pass |
| FT-14 | BOQ list shows only the project's Selected BOQs, with per-sheet counts | Pass (4 BOQs) |
| — | BOQ View grid: Materials column right after Row type; **+ Add** only on Item rows | Pass |
| FT-01 | **+ Add** opens the form with the line's sheet, row, Sl.No, description and BOQ qty | Pass |
| FT-03 | Add normal items; pick a make; edit qty; Save. Name, unit and category filled in. Count goes 0/71 → 1/71 | Pass |
| FT-04 | Add a custom item; it shows "Custom · not in Items list" | Pass |
| FT-05 | Typing a custom name lists similar items; **Use this** switches it to a normal item | Pass |
| FT-06 | **Match** on a custom row turns it into a normal item and keeps its qty | Pass |
| EC-08 | Same item + same make twice is refused on Save | Pass |
| EC-14 | Qty 0 and 1.5 on a NOS item are refused with a clear message | Pass |
| FT-07 | BOQ View: **▸ 4 items** expands the items under the row; clicking again collapses | Pass |
| FT-10 | Reload keeps the sub-tab, BOQ, sheet and open row | Pass |
| EC-17 | Same line edited in two tabs: the second Save gets "Someone else changed this estimate… Reload"; the first tab's value is kept | Pass |
| — | **Open in Line Item View** (BOQ View) lands on the same row, expanded | Pass |
| FT-08 | Line Item View: switch BOQ, ▸ expand, **Expand all** (71 open), **Collapse all** (0 open) | Pass |
| — | Filters: **Estimated** shows 1 line, **Not estimated** 70 | Pass |
| EC-21 | Search "VCD" shows only rows 83 and 84 under their heading; clearing it brings all 71 back | Pass |
| EC-25 | Sheet named "VAV " (trailing space) opens and shows all 30 lines | Pass |
| — | **Open line** (Estimate Items) jumps to the line in Line Item View, expanded | Pass |
| EC-15 | Remove every item, then Save: "Material estimate removed", count back to 0/71 | Pass |
| — | Fixed and re-checked: an error in the form clears as soon as a row changes | Pass |
| — | Fixed and re-checked: after Save the line opens and scrolls into view | Pass |

Note: the browser **Back** button skips the Estimates sub-tabs. Every project-page tab works this way, so it is
not a bug.

## Done — second and third walks, 2026-11-11

### 1. Who can edit (FT-12, EC-19)

| # | Log in as | Result |
|---|---|---|
| 1a | Project Manager (view-only) | **Partly checked.** The Estimates tab shows on their own Project B and lists its Selected BOQ. Project B's and Project C's Selected BOQs have no committed sheet, so no line was there to show that **+ Add** and **Edit** are hidden. |
| 1b | Project Lead profile | **Blocked**: no enabled user has this profile on dev |
| 1c | PMO profile | **Pass.** Project A → BOQ A1 → HVAC LOW SIDE row 15 → custom item, 4 NOS → Save: "Saved 1 material on row 15", 0/71 → 1/71. Edit → Remove → Save: "Material estimate removed", back to 0/71. |
| 1d | Admin profile | Pass: add, Save, remove all work |
| 1e | Accountant | Pass: no BoQ and no Estimates tab |

### 2–9. Feature and edge checks

| ID | Check | Result |
|---|---|---|
| EC-20 | Completed and Handover projects: read-only banner, no **+ Add** or **Edit** | Pass |
| FT-14 | Won project with no Selected BOQ: card plus **Open the BoQ tab** button | Pass |
| FT-09, EC-16 | Same item + make on two lines (10 + 5): Material totals 15, Used in lines 2 | Pass |
| EC-16 | Different make, or different unit: separate total rows, never added together | Pass |
| EC-07 | Line with no BOQ qty (row 58, "—"): form opens, Save works | Pass |
| EC-06 | Sheets with only headings or preambles are not listed at all; no error | Pass |
| FT-02 | Two tabs, same empty line, **+ Add** in both: tab 2's Save is refused; only one estimate exists | Pass |
| EC-24 | Link with `estRow=9999`: sheet opens, nothing expands, no error | Pass |
| EC-22, EC-23, EC-26 | Largest sheet (460 lines; the 816 figure counted draft BOQs): opens fast, **Expand all** scrolls smoothly, Materials column on the first screen | Pass |
| FT-11 | Re-commit (v2, v3) a sheet that has an estimate: commit works as before; older-version notice with the count | Pass |
| FT-13 | **Re-attach**: "Re-attached 1 estimate" | Pass |
| EC-18 | Form open while the sheet is re-committed in another tab: Save refused, line no longer current | Pass |
| EC-01 | Estimates follow their BOQ through re-commit | Pass |
| EC-05 | Delete a BOQ that has estimates | **Blocked**: no BOQ can be deleted today (Desk refuses because of the BOQ's line rows; the app's "Discard BoQ" is disabled). Existing rule, unrelated to estimates. |

### Normal and Custom items (background test, 9 steps)

All 9 steps pass. Full workflow, rules and messages:
https://claude.ai/artifact/4yeSvnnYSbtjYpFNbCDXGF

### Regression, walked so far

| ID | Check | Result |
|---|---|---|
| REG-01 | Upload a BOQ: parse, review, commit | Pass: no new step or prompt |
| REG-08 | Pricing page | Pass (11-06) |
| REG-10 | Delete a BOQ that has estimates | Pass: estimates add no new block (the delete is refused by the existing BOQ Nodes rule) |

## Done — full check of the staged files, 2026-11-11

### Tests

| Check | Result |
|---|---|
| Backend: `api.estimations.test_estimations_api`, `services.estimations.test_rules`, `doctype.boq_line_estimate`, `services.test_index_manifest`, `services.test_role_mirrors` | All pass |
| Key table counts (payments, expenses, projects, BOQ tables, items, users, user permissions, roles) before and after every test run | No change |
| Frontend: vitest `src/utils/estimations` | 15 / 15 pass |
| Type check of the changed frontend files | 0 errors in the estimates files (older errors elsewhere unchanged) |

### Full workflow as PMO, Project A → BOQ A1 → HVAC LOW SIDE

| View | Walk | Result |
|---|---|---|
| BOQ View | Row 15: normal item (GI Sheet - 24G, Ductofab, 10 NOS) + custom item (2.5 KGS) → Save | Pass: 1/71, line opens with both rows; category filled from the Items list |
| BOQ View | Empty qty, empty custom name, 1.5 on a NOS item | Pass: each refused with its message; the error clears when the row changes |
| BOQ View | Row 37: same item + make, 5 NOS → Save | Pass: 2/71 |
| Line Item View | Open in Line Item View; **Estimated** filter; **Expand all**; search "Plenum" | Pass: lands on row 37 expanded; 2 lines; both open; only row 15 left |
| Line Item View | Edit row 37: 5 → 7 → Save | Pass |
| Estimate Items | By line item; **Custom** filter; **Material totals**; **All sheets**; **Open line** | Pass: totals 15, then 17 after the edit, used in 2 lines; custom kept separate; Open line lands on the row |
| Clean-up | Remove every item on rows 15 and 37 | Pass: 0/71, "No line items match" under Estimated |

### Code review fixes (each covered by a test that fails without the fix)

| # | Problem | Fix | Test |
|---|---|---|---|
| 1 | Reads, saves, deletes and Re-attach checked the role only, not the project: a project-limited user could read or change another project's estimates through the API | The controller checks the user's Projects User Permissions on every save and delete (REST too); the read endpoints and Re-attach check them first. A user with no Projects rules stays unrestricted, as everywhere else. | `test_project_access_limits_reads_and_writes` |
| 2 | A save could send another name, unit or category for a saved Normal row, and it was kept | The controller restores the saved row's name, unit and category | `test_a_saved_normal_row_keeps_its_name_unit_and_category` |
| 3 | After a Re-attach, the older-version notice kept the last result when you switched sheet | The notice is keyed by BOQ + sheet | Type check; not walked (needs a re-commit) |

### Re-walk after the fixes

| Log in as | Walk | Result |
|---|---|---|
| Project Manager (limited to 11 projects) | Project B → Estimates | Pass: tab loads with the new project check |
| PMO | Project A → BOQ A1 → row 19: add GI Sheet - 24G, 3 → Save; Edit: make Jsw, 4 → Save; Remove → Save | Pass: unit NOS and category kept through the edit; removed |

### Re-commit and Re-attach: old and new version, walked end to end

As Admin on the synthetic test BOQ (Sheet1, 3 line items), after the Re-attach fixes (newest estimate wins; Remove
for lines that changed; Estimate Items note; every view refreshes after a write).

| Excel row | Old version (v3) | New version (v4) | After Re-attach |
|---|---|---|---|
| 2 | "First item" · GI Sheet - 24G ×10 | same text, still a line item | Moved to the new line |
| 3 | "Second item" · GI Sheet - 22G ×6 | reclassified Item → Note in review | Listed with its materials; Remove → Yes deleted it |
| 5 | "Bold item" · GI Sheet - 26G ×4 | same text, still a line item | Moved to the new line |

- Right after the re-commit the count read 0/2; nothing was deleted. BOQ View's notice and Estimate Items both said
  3 estimates were on an older version and not counted yet.
- Re-attach: "Re-attached 2 estimates · 1 needs a person to check". Count 2/2.
- Row 2 edited 10 → 12 in BOQ View; Estimate Items showed 12 at once.
- Clean-up: both estimates removed, the test BOQ moved back to Draft. (Review cannot edit a description, only row
  type and parent, so a changed row was made by turning it into a note.)

### Changed rows: Add to a line, or Remove

Every older estimate in the notice now has two choices:

- **Add to a line…** → choose a current line → **Open form**. The form opens on that line with the older materials
  added as new rows (note: "N materials copied from the older version of row X"). Normal rules apply on Save. After
  the save the older estimate is removed; Cancel leaves it listed.
- **Remove** → "Delete this older estimate?" → **Yes, remove**.

Walked as Admin on the test BOQ, version 4 → 5 (rows 2 and 5 turned into notes, row 3 back to an item):
Re-attach moved 0 and listed both; row 2's GI Sheet - 24G ×10 was added to row 3 with **Add to a line…** → Save
("Saved 1 material on row 3"), and row 2's older estimate disappeared.

### Re-attach copies; Undo and Remove old (owner's design, 11 Nov)

Re-attach no longer moves an older estimate. It **copies** it onto the matching line of the new version and keeps the
older one as a backup. What each older estimate can do comes from the server, so every view shows the same thing:

| State | Meaning | Per-row buttons | Global button |
|---|---|---|---|
| Can be copied | Same Excel row and same text on the new version, line has no estimate | Remove | **Re-attach (N)** |
| Copied | The new line holds exactly the backup's materials | **Undo** (deletes the copy, keeps the backup), **Remove old** (deletes the backup, keeps the copy) | **Undo all (N)**, **Remove all old (N)** |
| Copied, then edited | The new line now holds other materials | **Remove old** only (Undo would lose the edits) | **Remove all old (N)** |
| Changed | The line's text or row changed, so it cannot be copied | **Add to a line…**, **Remove** | — |

Every delete asks "Delete this older estimate?" → **Yes, remove**. Backups stay until someone removes them. Estimate
Items counts the copies only, and says how many backups are kept.

Walked as Admin on the test BOQ, version 5 → 6 (no changes, so row 3 "Second item", GI Sheet - 24G ×10, became
"can be copied"):

| Step | Result |
|---|---|
| BOQ View → **Re-attach (1)** | "Copied 1 estimate to the new version. The older ones are kept as backups." Count 1/1. Notice shows **Undo all (1)**, **Remove all old (1)**, row 3 with **Undo** and **Remove old**; no Re-attach |
| Line Item View | Same notice and buttons (the state comes from the server) |
| Row 3 → **Undo** | "Undone: removed 1 copy from the new version." Back to "1 can be copied", **Re-attach (1)**; row 3 shows **+ Add** |
| **Re-attach (1)** again → Estimate Items | Row 3 counted (GI Sheet - 24G, 10 NOS); note "1 older backup is kept after Re-attach; its copy is counted here" |

Backend tests cover the rest: Undo never deletes an edited copy, Remove all old keeps the copies, and when two older
estimates want one line the newest is copied.

### Edge: the old line item was deleted

A re-commit never deletes old line items (they are frozen), but a BOQ line or sheet can still be deleted by hand, and
an estimate does not stop that (hooks.py `ignore_links_on_delete`, so estimates never block a BOQ delete). Before
this fix such an estimate vanished from every view, with no way to clear it. Now it is listed in the notice as
"Its line item no longer exists in the BOQ (it was deleted)", with its materials, **Add to a line…** and **Remove**.
Re-attach never copies it, and **Remove all old** leaves it. If its sheet is gone too, it is listed on every sheet of
its BOQ. Covered by `test_an_estimate_whose_line_was_deleted_is_listed_never_hidden` (fails with the old joins); not
walked in the browser (it needs a line deleted by hand).

**Left on purpose for the owner to try:** the test BOQ is Selected, Sheet1 is on version 6, and row 3's estimate is
in the **Copied** state, so **Undo**, **Remove old**, **Undo all** and **Remove all old** can all be tried.

### Rough edges (not fixed, no data loss)

- **Match** has no search box; it only lists about 10 look-alike items.
- **Match** changes the unit without warning (PACKS became NOS, qty 6 kept).
- Search menus filter with a short delay, so a fast click can pick the wrong item.
- After picking from a search menu, the first click on **Quantity** does not put the cursor there; a second click
  does (typing the quantity first avoids it).
- BOQ View search keeps every heading on screen, even headings with no matching line under them.
- From the code review, not yet fixed: Re-attach saves one estimate at a time (slow on big sheets). (Fixed since:
  Re-attach now copies the newest estimate; an older estimate that cannot be copied can be added to a line or
  removed; a ▸ click no longer re-centres the page; the server refuses saves on a BOQ that is not Selected.)

### Issues 3 and 5, fixed 11 Nov

| # | Fix | Proof |
|---|---|---|
| 3 | A ▸ click expands the line in place; only a shared link, Save or Open line scrolls to it (`useFocusedLines`) | Browser, Project A FIRE&ELV BOQ, sheet FA (26 lines), as Admin: ▸ on a row at the bottom of the screen, fix off → row moved 321 px to the middle; fix on → 0 px, in Line Item View and BOQ View. Reloading `estRow=15` still opens row 15 expanded and centred. |
| 5 | The controller refuses a save on a BOQ that is not Selected (`rules.boq_problem`); deleting stays allowed | `test_a_save_on_a_draft_boq_is_refused` (fails with the check removed) and `TestBoqProblem`. API 12/12, rules 28/28, table counts unchanged. |


## Code-review follow-ups, 2026-11-11 (after the 4 commits)

| # | Problem | Fix | Proof |
|---|---|---|---|
| 4 | One copy refused by a save rule rolled back the whole sheet's Re-attach | Each copy is saved on its own savepoint; a refused one is rolled back to it and listed in `failed` with the reason; the rest are copied | `test_one_refused_copy_does_not_stop_the_rest_of_reattach` (errors with the old single transaction) |
| 7 | The tab's own URL hook missed react-router navigations (stale `estTab` / `estBoq` / `estSheet` / `estRow` after a navigate()) | `useUrlParamState` now reads through the app's `useUrlParam` and writes through `urlStateManager` | Type check; same pattern as the app hook |
| 8 | `Infinity` / `NaN` quantities: a 500 (OverflowError) on NOS items, stored on others | `item_row_problem` refuses non-finite quantities | `test_infinite_and_nan_quantities_are_refused_not_a_crash` (errors without the check) |
| 9 | The edit gate was copied in `estimate_writes.py` | One gate, `assert_can_edit`, in the controller; the endpoints import it | API tests |
| 10 | Walk results in a `docs/` file, outside the BOQ reference docs | Owner kept this file here; `frontend/.claude/plans/boq-upload-plan.md` has a short pointer to it | — |
| 2 | Items / Category / Makelist / Procurement Packages records used in an estimate could be deleted (the ignore-links entry also skips child rows), and the estimate's next save then failed Link validation | Owner, 11 Nov: the material row keeps item, category, package and make as **text**, not links (DocType save, Link->Data, noted in CODING_STANDARDS). Deleting such a record is not blocked, and the estimate shows and saves with what was chosen. A rename no longer follows them (text only, for now) | `test_a_deleted_items_record_never_blocks_or_breaks_an_estimate` |
| 5 | A Re-attach copy refreshed name / unit / category from today's Items record (10 NOS could become 10 SQM), so it no longer matched its backup | A copy keeps the backup's saved values (`doc.flags.reattach_copy`); every save rule still runs | `test_a_reattach_copy_keeps_the_saved_name_and_unit` (fails without the flag) |
| 1 | "Remove all old" sends `"[]"`, which the server read as "a list was sent", then as "all": every older estimate went, copied or not | An empty list (or none) means backups only | `test_remove_old_deletes_backups_and_keeps_the_copies` now sends `"[]"` (fails with the old check) |
| 3 | Materials typed by hand on the new line made the older estimate look like a backup ("copied, then edited") | State `copied_edited` became `line_has_other`: the line holds different materials, so it is never a backup; it is offered like a changed line (Add to a line… / Remove); Undo and "Remove all old" skip it. Only an exact copy (`copied`) is a backup. Trade-off: a copy edited later loses its "Remove old" shortcut; the full fix (a "copied from" field) needs a schema change | `test_materials_typed_on_the_new_line_never_make_the_older_one_a_backup` (fails with the old rule) |
| 6 | "Add to a line…" removed the older estimate even when the save kept no rows | The form calls `carried.onKept` only after a save that kept materials | Type check (form wiring) |

All ten review findings are now fixed (10 kept by the owner's choice).

## Estimates are always copied to the new version; older ones are settled, never deleted (owner, 2026-11-12)

Every commit creates a new set of BOQ line items and freezes the old ones (the BOQ keeps every version: Version 1 …
N in the viewer). So each version keeps its own estimates as history, and the new version gets a copy:

- **After each commit, automatically.** A hook on `BoQ Sheet` (`after_insert`, current data sheets only, and only if
  the BOQ has any estimate) queues a background job once the commit has gone through (`enqueue_after_commit`). The
  BOQ commit code is unchanged and never waits on it; a commit that fails queues nothing. A BOQ that is not Selected
  is skipped.
- **Copied, old one settled.** Each estimate on an unchanged line (same Excel row and exact text) is copied onto the
  new line with its saved materials, name and unit, and the older one is marked **Settled** (new hidden read-only
  check on `BOQ Line Estimate`, option B). Each copy is saved on its own; one refused by a rule is logged and listed.
- **The notice lists only what needs a person** (not settled, and the newest for its line): a line whose text changed
  or is gone (**Add to a line…** / **Remove**), or one not copied yet (**Re-attach**). **Remove** and a kept
  **Add to a line…** save mark it settled -- it stays in its version's history and earlier versions' estimates for
  the same line never come back. Undo and "Remove all old" are gone. No version picker for now (owner).

### Browser walk, 12 Nov (Admin, test BOQ, v5 → v9)

| Step | Result |
|---|---|
| Add a custom material on row 5 in the BOQ View form; row 6 through the same save | "Saved 1 material on row 5" |
| Re-commit with no changes (v6) | Both copied within seconds; originals kept on v5; no notice; "HVAC 2/2" |
| Row 6 → Note in review, re-commit (v7) | Row 5 copied; notice lists only row 6 as changed (Add to a line… / Remove); Estimate Items: "1 … not counted here yet" |
| Found: resolving row 6 deleted its v6 estimate and the v5 one came back | Fixed with option B (settled), then re-walked: |
| Row 5 → Note, row 6 → Item, re-commit (v8) | Notice lists only row 5's v7 estimate; its v5 and v6 ones stay history |
| Add to a line… → row 6 → remove the material → Save | "Material estimate removed"; the older one stays listed |
| Remove → "Not carry it to the new version? It stays in the older version's history." → Yes | "Removed from the new version …"; notice gone; the estimate kept and settled; v5 / v6 did not come back |
| BOQ to Draft, re-commit (v9) | No copy (Draft skipped) |
| Mark Selected → notice "(1 not copied yet)", Re-attach (1) | "Copied 1 estimate to the new version"; source kept on v8, settled; "HVAC 1/1" |

Tests: estimates API 16, rules 30, frontend 15, all pass; mutation checks (settled ignored when finding the newest; nothing
ever settled) fail the right tests. Test estimates removed afterwards.

---

## To check

### Logins needed

| # | Walk | Expect |
|---|---|---|
| 1a | **Project Manager** on a project with a committed sheet, open Estimates on a line with an estimate | Counts and items show. No **+ Add**, no **Edit**. |
| 1b | **Project Lead** profile (needs an enabled user) | Read-only like 1a |

### BOQ regression walks, done 11 Nov (as Admin, on the test project "testProject1")

Owner's choice: run on the Tendering test project testProject1 (Convert to Won is one-way, accepted); the merge
used a second test project, testProject-2, and was undone. All data is made up (two small generated workbooks).

| ID | Walk | Result |
|---|---|---|
| REG-01 | Upload a new BOQ (v1 workbook) → configure → parse → review → finalize → Commit | Pass: BOQ-26-00434, "HVAC — committed v1" |
| REG-04 | Pricing: formula G = D × (E + F), Override the category check, supply 500 + install 100 on row 5 (qty 100) | Pass: amount 60,000; "1 of 3 priced"; autosaved |
| REG-05 | Edit rate 500 → 600; then formula → D × E | Pass: 70,000, then 60,000; saved each time |
| REG-07 | Sheet viewer | Pass: shows the saved prices; no Materials column; the only input is the description search |
| REG-03 | Un-mark (priced-cells warning) → change row 7 Item → Note → Mark Finalized → tick the sheet → Commit → "Re-commit anyway" | Pass: "committed v2"; no new prompt beyond the existing priced-cells warning |
| REG-02 | Revise existing with the v2 workbook → Map sheets → Confirm mapping | Pass: BOQ-26-00435 (V2), work package carried |
| REG-02 | Create from Template ("Untitled spreadsheet (1)", 11 sheets) | Pass: BOQ-26-00436, "Cloned from template" |
| REG-09 | Convert to Won (7 steps, test values), ticking only BOQ-26-00434 | Pass: project Won/Won; only 434 Selected, the other 11 Draft; Estimates tab lists 434 |
| REG-09 | Won BoQ tab: Mark as Selected, then Move to Draft (template BOQ) | Pass both ways |
| REG-09 | testProject-2 → Merge BoQs into testProject1 (one ticked → Selected) → Undo merge | Pass: "6 BoQs moved"; the Selected one showed in testProject1's Estimates (6 sheets, 124 lines); Undo returned all 6 as Draft and testProject-2 to Tendering, exactly as before |
| REG-14 | Every screen above on BOQs with no estimates | Pass |
| 1b | Project Lead (throwaway user `reg-walk-pl@example.com`, assigned testProject1) | Pass: sees BoQ and Estimates tabs; BOQ View shows "▾ 1 item" with the material, no + Add / Edit / Remove; the server refuses a direct save (403, "Only Admin, PMO and Estimates Executive…"); BoQ tab has no Upload / select / Draft; row click opens the read-only viewer |

Seen, not caused by this feature (BOQ code identical to develop): on the upload page the ✨-prefilled BoQ name and
version show in the boxes but Continue stays disabled until they are typed again.

Clean-up: the probe estimate was removed; the test user was removed with Delete User (Frappe user disabled, no roles
or permissions left). Left on testProject1 (no screen deletes a BOQ): BOQ-26-00434 (Selected), 00435, 00436.

### Not walked

| ID | Walk | Note |
|---|---|---|
| REG-11 | Each role opens the BoQ tab and Rate Master | Not in this round. The only change to that code is the added Estimates tab entry (`project.tsx`). |

### Cleanup decision

- The synthetic test BOQ used for the re-commit checks is **Selected** on Project A (so it shows in Estimates), with
  one copied estimate and its backup. When done: remove both, move it back to Draft. No screen can delete the BOQ
  itself; either leave it, or run a backend script (dry run first) that removes its line rows, sheets and the BOQ.

---

## Not browser steps

### Done 11 Nov: the BOQ workflow is unchanged

| ID | Check | Result |
|---|---|---|
| REG-12 | BOQ test modules `commit_pipeline` (64), `commit_validation` (55), `pricing` (262), `review_screen` (294) | All pass: 675 tests, 0 failures. Table counts (BOQ tables, pricing, estimates, users, payments, expenses) the same before and after. No pass/fail baseline was saved at step 0; the BOQ code is identical to develop, so these results are develop's. |
| REG-06 | Sheet totals of the 3 step 0 baseline BOQs (most priced, a revision, a Selected one; 5 sheets), read-only | Same on all 9 numbers per sheet: version, nodes, line items, qty sum, amount sum, nodes checksum, priced cells, rate sum, pricing checksum. 0 differences. |
| REG-13 | `git diff develop` of BOQ code (api/boq, boq* doctypes except the two new ones, boq-wizard frontend, boqs/boq_nodes controllers) | 0 lines |

### Still owed

- `bench migrate` (creates the two new doctypes on the site).

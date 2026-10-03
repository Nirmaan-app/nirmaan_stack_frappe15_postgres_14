# Billing Tracker — plan

Client-side billing tracker: the bills Nirmaan raises to the client, tracked per project and per
billing package, with a daily Supply DC log per package. Replaces the per-project billing Google
Sheet. Source mockups: `nirmaan-project-billing-tab.html` (project Billing tab) and
`nirmaan-bill-tracker.html` (Billing Trackers page).

Status (2026-10-03): **built, not migrated, not browser-tested.** Doctypes, APIs and screens are on
disk (uncommitted, `develop`). Needs `bench --site localhost migrate` before anything can run.

Live diagram: https://claude.ai/artifact/NXni9DidLpxRFMMKXWoNbZ

---

## 1. Doctypes and how they connect

```
Project Billing Packages (master list)              Projects
  Electrical · HVAC · FA · PA · Sprinkler               │ one project ── many trackers
  Access Control · CCTV · Networking · Others           ▼
        │                                     Project Billing Tracker
        │ package (Link)                        one per project + package (unique)
        └────────────────────────────────────►  name = {project}-{package}
                                                 │
                                                 ├── child table: Project Billing DC Log
                                                 │      dc_date · amount · entered_by
                                                 │ one tracker ── many bills
                                                 ▼
                                           Project Billing  (one per bill)
                                             project + package copied from the tracker
```

### Project Billing Packages (master)

| Field | Type | Note |
|---|---|---|
| package_name | Data, required, unique | also the record name |

Seeded with the 9 names by an idempotent patch (inserts only the missing ones).

### Project Billing Tracker — one per project + package

| Field | Type | Note |
|---|---|---|
| project | Link → Projects | required, set once |
| package | Link → Project Billing Packages | required, set once |
| billing_managers | Table MultiSelect → Project Billing Manager | one or more managers per package (decision 17) |
| po_value | Currency | typed at setup, editable from the Packages dialog |
| supply_dc | Currency, read-only | sum of this tracker's DC log rows |
| dc_updated_on | Date, read-only | latest DC log date; drives "Updated today / N days ago" |
| dc_log | Table → Project Billing DC Log | |
| remarks | Small Text | |

- Named `{project}-{package}` (e.g. `BENGALURU-PROJ-00080-Electrical`), so a project can have each
  package only once.
- `supply_dc` and `dc_updated_on` are recomputed from every log row on each save, never incremented.
- A new tracker is refused unless the project is **Won** (same `validate_won` guard as Project Inflows).

### Project Billing Manager — child table of the tracker

| Field | Type | Note |
|---|---|---|
| manager | Link → User, required | one row per manager, kept in the order picked |

- Field is `manager`, not `user`: `user` is a reserved word in PostgreSQL and needs quoting in raw SQL.
- The tracker's validate drops a person picked twice.
- Reads take the managers through one `GROUP BY parent` subquery (`_queries.MANAGERS_JOIN`) and
  `with_managers`, so a tracker row never multiplies; My Bills matches with `managed_by` (`EXISTS`).

### Project Billing DC Log — child table of the tracker

| Field | Type | Note |
|---|---|---|
| dc_date | Date, required, default today | |
| amount | Currency | value delivered (incl GST); 0 = no delivery; negative corrects an earlier row |
| entered_by | Link → User, read-only | stamped automatically |

- No package field: the tracker it sits in is the package.
- **Only Admin can change or delete a row once saved.** Everyone who can edit the tracker can add rows.
- Shown in Desk with `dc_date`, `amount`, `entered_by` as grid columns so the grid filter row can be used.

### Project Billing — one per bill

| Field | Type | Note |
|---|---|---|
| billing_tracker | Link → Project Billing Tracker | required, set once |
| project | Link → Projects, read-only | copied from the tracker |
| package | Link → Project Billing Packages, read-only | copied from the tracker |
| bill_type | Select | Supply 1 · Supply 2 · Supply 3 · RA 1 · RA 2 · RA 3 · Final · NA |
| status | Select, default Not Started | the 13 statuses below |
| bill_value | Currency | |
| payment_received | Currency | |
| invoice_requested | Check | yes / no |
| eta_date | Date | |
| first_submission_date | Date, read-only | stamped automatically, see rules |
| approval_date | Date | |
| bill_document_link | Data (URL) | |

- No DC field on a bill: Supply DC is package-level only.
- The same package may have two bills of the same type (e.g. two Electrical Supply 1). No uniqueness rule.

---

## 2. Statuses and rules

**13 statuses:** Not Started, Prepared, Submission Pending, Internally Approved, Revision Pending,
Submitted, Client Hold, Certification Pending, Client Approved, Invoice Sent, Payment Received,
Partial Payment Received, NA.

| Group | Statuses |
|---|---|
| **Pending (8)** | Not Started, Prepared, Submission Pending, Internally Approved, Revision Pending, Submitted, Client Hold, Certification Pending |
| **Approved (4)** | Client Approved, Invoice Sent, Payment Received, Partial Payment Received |
| **Neither** | NA — left out of every count **and** every money total |

- **Next bill** for a package = the pending bill with the **earliest ETA**; bills without an ETA come last.
  Bill-type order is not used.
- **First submission date** is stamped automatically, with today's date, the first time a bill is saved
  with one of these statuses (`SUBMITTED_OR_LATER` in `rules.py`):
  - Submitted
  - Client Hold
  - Certification Pending
  - Client Approved
  - Invoice Sent
  - Payment Received
  - Partial Payment Received

  Not Started, Prepared, Submission Pending, Internally Approved, Revision Pending and NA never set it.
  Once set it never moves (e.g. Submitted → Revision Pending → Submitted keeps the first date) and it
  cannot be edited. A bill saved straight into a later status (e.g. Client Approved) is stamped that day.
  The date is when the status was saved, not when the bill physically went out.
  Stamped in `ProjectBilling.validate` (`doctype/project_billing/project_billing.py`).
- **Invoiced** = bills with `invoice_requested` = Yes. **Inflow** = sum of `payment_received` on bills.
  Not linked to Project Invoices / Project Inflows for now (can be upgraded later).
- **PO value**: `po_value` on the tracker, typed at setup (accepts 45L / 1.2cr). Project PO total = sum over its
  trackers. Progress bars and "% of PO" use it; until it is entered they fall back to the billed total.

Owner of these rules: `nirmaan_stack/services/project_billing/rules.py` (pure module, unit-tested in
`services/project_billing/test_rules.py`).

---

## 3. Workflow

1. **Setup** (project Billing tab, Won projects only): tick the billing packages in scope and pick a
   billing manager for each → one Project Billing Tracker per package.
2. **Add a bill** (drawer):
   - **Project** is filled automatically from the page and cannot be changed.
   - **Package** lists only the packages already set up for this project (its trackers). If none are
     set up, the drawer asks to set up packages first.
   - The drawer resolves project + package to the tracker and saves it as `billing_tracker`; the
     server copies project and package from it.
   - Bill type, value, ETA, approval date, status, payment received, invoice requested, document link.
3. **Daily Supply DC** (My Bills → Update Supply DC): add one row to the package's tracker
   (date, amount; negative = correction; a 0 row only from "No delivery today", never typed, see
   decision 16). Saved through a server method that locks
   the tracker and appends the row, then recomputes `supply_dc` / `dc_updated_on`.
4. **Bill updates**: status, value, dates, payment, invoice requested, link — edited on the bill.
5. **Views**: project Billing tab; Billing Trackers page → Project Wise, Bill Wise, My Bills.

---

## 4. Decisions (owner, 2026-10-03)

| # | Question | Decision |
|---|---|---|
| 1 | First submission date: automatic only, or editable with pre-fill? | **Automatic only.** |
| 2 | Who can change past DC rows? | **Admin only, in Desk.** Give the child table filterable columns in Desk. |
| 3 | Two bills of the same type in one package? | **Allowed.** |
| 4 | Who sets up billing and edits bills? | **Admin, PMO and Billing users** (Billing Lead + Billing Executive). |
| 5 | Billing on Tendering projects? | **Billing tab shows only after the project is Won.** Tendering projects keep their separate Overview + BoQ view. |
| 6 | PO value per package? | **Typed by the user per package at setup**, beside the package and its manager; editable from the same Packages dialog (owner, 2026-10-03 — replaces the earlier "on hold, show 0"). |
| 7 | One tracker per project or per package? | **Per project + package**, unique pair, package from the master list. |
| 8 | DC on bills? | **No.** Supply DC is package-level only. |
| 9 | Next bill order? | **Earliest ETA** among pending bills. |
| 10 | Billing packages vs procurement packages? | **Separate list**; never mapped to Procurement Packages. |
| 11 | Invoiced / Inflow source? | **Per-bill fields** (yes/no check, payment received). Upgrade later. |
| 12 | Add Bill drawer | **Project automatic and fixed; package only from those set up for the project.** |
| 13 | `billing_manager` + `remarks` on the tracker? | **Keep both.** The single manager became several in decision 17. |
| 14 | Project Lead / Accountant / Accountant Lead read access? | **Removed.** Only Admin, PMO and Billing users see billing, read included. |
| 15 | How are the 9 packages created? | **Fixture** (`fixtures/project_billing_packages.json`), no patch. |
| 16 | A 0 typed in the Supply DC box? | **Not saved** (owner, 2026-10-03). The "No delivery today" button was later hidden too (owner, 2026-10-03: no empty DC log rows), so the screen logs no zero day at all. In Correct total, a total equal to the current one is refused too; a real correction down to 0 still saves, as a minus entry. Screen rule only (`dcEntryPlan`): the server still accepts an amount of 0. |
| 17 | Several billing managers per package? | **Yes** (owner, 2026-10-03). New child table `Project Billing Manager`, shown on the tracker as `billing_managers`; it replaces the single `billing_manager` field. My Bills and the Bill Wise manager filter match anyone among the managers. The Bill Wise manager grid counts a package's bills under each of its managers, so its rows can add up to more than the overall total. No patch: nothing was live, and the old column is left in the database unread. |
| 18 | Who may add / edit bills and log Supply DC? | **Admin for every package; everyone else only for packages where they are one of the billing managers** (owner, 2026-10-03; narrows decision 4 for bills and DC). Viewing is unchanged: every billing user still sees every bill. Setup (Packages dialog: managers, PO value) is unchanged. Enforced in the controller hooks (bill save / delete, a new DC row checked against the managers as saved) through the pure `rules.can_edit_package_bills`; the read APIs stamp `can_edit_bills` per package and the screens follow it: Update Supply DC lists only those packages, Add Bill offers only those, and other rows show a lock instead of the pencil. |

---

## 5. Permissions (Tracker and Project Billing)

| Role | Access |
|---|---|
| System Manager, Nirmaan Admin Profile | full |
| Nirmaan PMO Executive | create, edit, read |
| Nirmaan Billing Lead, Nirmaan Billing Executive | create, edit, read |

Only Admin, PMO and Billing users can read or write. The Project Lead profile also carries
`System Manager`, so the DocPerm alone cannot keep it out: a `has_permission` +
`permission_query_conditions` hook (same precedent as Non Project Inflows) and a profile check in
every API (`role_profiles.PROJECT_BILLING_WRITE_PROFILES`) do. Packages master: Admin + Billing Lead edit.

Inside that, bills and Supply DC are narrower (decision 18): Admin edits every package; anyone else only
the packages where they are one of the billing managers.

Frontend: the Billing tab is added for Admin, PMO and Billing profiles only (three tab lists in
`frontend/src/pages/projects/project.tsx`: privileged, Estimates/Billing Executive, general).

---

## 6. Build order

1. **Doctype changes** (this step, after open questions A/B): tracker per project + package,
   DC log without package, bill copies project + package, permissions, Admin-only past DC rows,
   Won guard, seed patch for the 9 packages.
2. **APIs** — `nirmaan_stack/api/project_billing/`:
   - `get_project_billing(project)` — trackers, bills, summary totals (Billing tab, tracker detail)
   - `setup_project_billing(project, packages=[{package, manager}])`
   - `add_dc_entry(tracker, amount, dc_date)` — locks the tracker, appends a row
   - `get_projects`, `get_manager_summary`, `get_bills`, `get_my_bills` — tracker page views
3. **Screens** — project Billing tab, Billing Trackers page (Project Wise / Bill Wise / My Bills),
   Add/Update bill drawer, Supply DC drawer, setup dialog, sidebar entry.
4. **PO value** — done: typed per package in the setup dialog.

---

## 7. As built (2026-10-03, uncommitted)

**Backend**
- Doctypes: `project_billing_packages` (master), `project_billing_tracker` (+ child
  `project_billing_dc_log`, `rows_threshold_for_grid_search: 1` so the Desk grid always shows its
  filter row), `project_billing`.
- `fixtures/project_billing_packages.json` + `"Project Billing Packages"` in `hooks.py` fixtures.
- `integrations/controllers/project_billing.py`: write-profile checks (validate/on_trash),
  Won guard on new trackers, Admin-only change/delete of saved DC rows, `has_permission` and
  `get_permission_query_conditions` hooks. Wired in `hooks.py`.
- `services/role_profiles.py`: `PROJECT_BILLING_WRITE_PROFILES`, `PROJECT_BILLING_PACKAGE_WRITE_PROFILES`,
  `can_write_project_billing`.
- `services/project_billing/rules.py`: status groups, `next_bill`, `SUMMARY_COLUMNS` (11 pure tests in `test_rules.py`).
- `api/project_billing/`: `project_view.get_project_billing`, `setup.setup_project_billing`,
  `bills.save_bill` / `delete_bill`, `supply_dc.add_dc_entry` (locks the tracker row), `tracker.get_billing_projects`
  / `get_manager_summary` / `get_bills` / `get_my_bills`; totals are SQL `GROUP BY ... FILTER`.

**Frontend** (`src/pages/ProjectBilling/`)
- `ProjectBillingTab.tsx` — project Billing tab (summary card, package table with next bill, bills table,
  package chips, Add Bill, Packages, Update Supply DC). Wired into `pages/projects/project.tsx` as `?page=billing`
  for Admin / PMO / Billing profiles only.
- `BillingTrackerPage.tsx` — `/billing-tracker` (sidebar "Billing Tracker"): Project Wise, Bill Wise
  (manager summary grid + filters + bills), My Bills (counts + Supply DC drawer).
- `components/`: `BillDrawer` (project fixed, package from the project's trackers), `SetupBillingDialog`,
  `SupplyDcSheet` (Add today's / Correct total / No delivery today; accepts 2.5L, 1.2cr; a typed 0 is refused via
  `dcEntryPlan`, decision 16), `BillsTable`, `BillingBits`.
- `constants/roles.ts`: `PROJECT_BILLING_PROFILES`, `canUseProjectBilling`.
- Tests: `utils/billingFormat.test.ts` (8), `src/utils/projectBillingStatusParity.test.ts` (2, pins the
  status lists to the doctype JSON).

**Not done yet:** Export button, browser walk-through.

### Layout decisions after browser review (owner, 2026-10-03)

- **Project Billing tab, package table:** no "Next bill" column; Approved till date shows the amount plus
  "X% of PO" under it, same as Billed till date (owner reversed "amount only", 2026-10-03);
  a **Progress vs PO** column shows the approved/awaiting bar against the package PO plus a note
  ("₹X awaiting approval" / "None approved yet" / "All billed value approved" / "Nothing billed yet").
- **Billing Tracker → Project Wise:** the original mockup layout — project row with the project's status
  chip (WIP, Handover, …), managers, PO total + approved/awaiting bar, Supply DC, "View Bills ↗";
  expanded package rows (└ connector, package, manager, Next bill + status, Deadline, PO + bar) and a
  NOTES row (each package's remarks, else "No notes recorded."). The old "Payable" column stays removed.
- **"View Bills" opens `/billing-tracker/:projectId`** (`BillingProjectPage.tsx`, owner 2026-10-03), no longer the
  project page's Billing tab: back to All projects, Owner / Deadline (earliest pending ETA) / Bills chips, an
  "approved & beyond" ring (`bill_count − pending_count` of `bill_count`), package chips that filter the table, and
  the shared `BillsDataTable`. It reads the cached `get_billing_projects` row, so no new API.
- **Package tabs (owner 2026-10-03):** "All | <each package of the project>" with bill counts (NA excluded) above the
  bills table, on BOTH the View Bills page and the project Billing tab (`PackageTabs`); a tab adds `package = X`.
- **Bill Wise filters live in the Billing Manager Summary card** and drive BOTH the grid and the bills table.
  `get_manager_summary(deadline)` counts only pending bills in the window (`rules.deadline_window`, mirrors
  `deadlineFilters`); every manager stays listed with zeros. The Manager dropdown gained "Unassigned".
- **"Managers" column renamed "Assigned"** with a header funnel (multi-select, + Unassigned, URL-synced). Assignees live
  on the tracker, so it is NOT a TanStack column filter (that reaches the server as `billing_managers in [...]`, a
  field bills lack): `AssignedHeader` feeds `BillsDataTable`, which adds `billing_tracker in [...]` to rows, facets and
  export. One rule for "whose packages": `trackersAssignedTo` / `assigneeOptions` (billingFormat, unit-tested).
- **No sideways scroll:** both tables fit the page width; below 1280px (xl) amounts switch to lakh/crore
  shorthand (full amount on hover) and headers/chips wrap. Checked at 1440 / 1280 / 1024 px.
- **Bill lists use the app's standard DataTable (owner, 2026-10-03):** project Billing tab, Bill Wise and My
  Bills all render `components/BillsDataTable.tsx` = `useServerDataTable` + `DataTable` on the `Project Billing`
  doctype, columns in `config/bills.config.tsx`. Self-fetching facets on Project / Package / Bill Type / Status,
  date filters on ETA / First Sub. / Approval, search, Export, pagination, URL-synced state. Manager and
  Deadline stay as toolbar dropdowns (managers live on the tracker, so it filters `billing_tracker in
  [trackers that person is one of the managers of]`). The package chips and the custom `get_bills` endpoint
  were removed.
- **Packages dialog, finance layout (owner, 2026-10-03):** `SetupBillingDialog` opens with a Summary strip
  (Packages in scope, Total PO value, Managers assigned, PO value entered; same tiles as the vendor page's PO
  Totals card, amber while something is missing), then a table with the app's pink header: tick box, package,
  a "Set up" tag on packages already set up (tick locked), a multi-name manager picker (react-select, as in the
  Design Tracker), and a right-aligned ₹ PO value with its read-back under it. A bold total row closes the
  table and the footer (sticky) names what is still missing; it never blocks saving. "Use these managers for
  all ticked packages" copies one package's managers to the rest. Saved PO values prefill in Indian grouping;
  the form fills only when the dialog opens, so a background refetch cannot wipe what is being typed. Figures
  come from the pure `poAmount` / `poInputOf` / `setupSummary` in `utils/billingFormat.ts`.
- **Known shared-API gap (not billing code):** `api/data_table/search.py` counts with `frappe.db.count`, so a
  user without billing access calling the DataTable API directly gets `total_count` (rows and facets stay empty).

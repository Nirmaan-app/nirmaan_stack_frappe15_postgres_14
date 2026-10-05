# Billing Tracker

Client-side billing tracker: the bills Nirmaan raises to the client, tracked per project and per
billing package, with a daily Supply DC log per package. Replaces the per-project billing Google
Sheet. Source mockups: `nirmaan-project-billing-tab.html` (project Billing tab) and
`nirmaan-bill-tracker.html` (Billing Trackers page).

This file is the single source of truth for the feature: what is built, the rules, who may do what,
and the owner's decisions. Synced with the code on 2026-10-05.

---

## 0. Status

- **Committed** on branch `billing-tracker`, from `61ab3654d` onwards (`git log 61ab3654d~1..`), **not pushed**.
- **Migrate:** a site without the billing doctypes needs `bench --site <site> migrate` once. It creates the
  five doctypes and imports the 9 packages from the fixture.
- **Tested:**
  - Server rules: rolled-back scripts as Admin, PMO, Billing Executive and a System Manager profile
    (Estimates Executive).
  - Browser: walked as Admin and PMO on 2026-10-03, before decisions 17–19; the later screens were checked
    on screen by the owner but not walked end to end.
  - **Never tested as Billing Lead:** localhost has no Billing Lead user. Billing Executive is tested on the
    server only.
- Automated tests: see §10.

---

## 1. Screens

| Screen | Where | Who sees it |
|---|---|---|
| **Billing tab** of a project | Project page → Billing (`?page=billing`). Won projects only: Tendering projects open a separate view with no Billing tab | Administrator, Admin, PMO, Billing Executive, Billing Lead |
| **Billing Tracker** | Sidebar → Billing Tracker (`/billing-tracker`): Project Wise · Bill Wise · My Bills | same |
| **View Bills** | `/billing-tracker/:projectId`, from "View Bills ↗" on Project Wise | same |
| **Billing Packages** | Admin Options → Packages Settings → Billing Packages (`?tab=billing-packages`) | everyone who opens Packages Settings sees the list; Add / Edit / Delete only for Administrator, Admin, Billing Lead |

**Project Billing tab**
- **Summary card:**
  - Total Invoiced and Total Inflow come from the Financials tab (decision 11): the project's Project Invoices
    and Project Inflows. Billing has no invoiced or inflow figure of its own.
  - Billed, approved, PO value and Supply DC come from the bills and packages.
- **Package table:**
  - One row per package: managers, PO value, billed and approved (each with "X% of PO"), Supply DC, and a
    Progress vs PO bar with a note ("₹X awaiting approval" / "None approved yet" / "All billed value
    approved" / "Nothing billed yet").
  - Admin also sees an ✏️ per package.
  - There is no "Next bill" column.
- **Bills table:** "Packages: All | each package" tabs with bill counts (NA excluded). Admin also sees a trash
  icon on each package tab to remove that package from the project (decision 27).
- **Buttons:** Setup Packages and Update Supply DC sit in the Billing summary header (owner, 2026-10-05); Add Bill is
  on the bills table. Update Supply DC is hidden here for Billing Executive and
  Billing Lead (owner, 2026-10-05): they log Supply DC from Billing Tracker → My Bills. Screen only.

**Billing Tracker page**
- **Project Wise:**
  - Above the table: search (project name or manager), "X of Y projects", a **billing-status filter**
    and a **Deadline sort**.
    - Billing-status filter: works on **what the screen shows**, at package level (owner, 2026-10-05). A
      project keeps only the package rows that show the picked status (the package's most urgent pending
      bill's status, else "All bills approved" / "No bills yet", via `shownBillStatus`); a project with none
      left drops out. Bills the rows do not show never match. The project row keeps its own totals; NOTES
      shows only the visible packages' remarks. Picking a status opens the matching projects (a project
      opened or closed by hand stays that way). Options are the statuses shown, in the standard order.
    - Deadline sort, **within each project only** (owner, 2026-10-05): ↑ / ↓ reorders the package rows inside
      a project by the deadline they show (earliest or latest first; no deadline last; ties A to Z).
      Projects never move: they stay A to Z. One pure function does the filter and the sort:
      `projectWiseRows` (`visiblePackages` + `sortPackagesByDeadline`).
    - Package rows have a divider line between the progress bar and the bill block.
    A project's deadline is the earliest ETA among its packages' next pending bills (`projectDeadline`,
    the same rule as the View Bills "Deadline" chip).
  - One row per project: status chip, managers, PO total with the approved/awaiting bar, Supply DC, and
    View Bills.
  - Expanding a project shows its package rows and a NOTES row with each package's remarks. A package row uses
    the project row's columns (owner, 2026-10-05): package · managers · PO with bar (under PROJECT TOTAL) · and,
    spanning the last two columns (SUPPLY DC and BILLS), one line as in the mockup: **Latest Bill** (its most urgent
    pending bill: earliest ETA) · its status · **Deadline** date with a small tag under it ("Today", "Tomorrow", "In 3d",
    "2d overdue"; `EtaCell`, the same as the bills table) · "+N more overdue" when the package has other bills past
    their ETA (`moreOverdue`; server `overdue_count`). The progress bar is capped at 260px so it does not stretch.
    With nothing pending it shows "All bills approved" / "No bills yet" and no deadline.
- **Bill Wise:**
  - The Billing Manager Summary grid counts bills per manager in 7 columns: Not Started · Submission
    (Prepared, Submission Pending) · Cert. Pending (Internally Approved, Submitted, Certification Pending) ·
    On Hold (Client Hold, Revision Pending) · Approved (Client Approved) · Invoiced (Invoice Sent) · Paid
    (Payment Received, Partial Payment Received). These are **bill counts by status**, not money: "Invoiced"
    means bills in status Invoice Sent. Defined once in `rules.SUMMARY_COLUMNS`.
  - Manager and Deadline filters drive both the grid and the bills table.
- **My Bills:** counts (my bills, pending, due in 7 days, overdue), the bills of the packages I manage, and
  Update Supply DC.

**View Bills page:** owner, deadline (earliest pending ETA), bill count and a **Setup Packages** button (billing
writers; the same Packages dialog) in the top card, an "approved & beyond" ring, package tabs, and the bills table.

**Bill tables everywhere:**
- All use the shared DataTable (`BillsDataTable`): self-fetching facets on Project, Package, Bill Type
  and Status, date filters on ETA, First Submission and Approval, search, Export, pagination, and the state
  kept in the URL.
- The "Assigned" column has its own header filter (multi-select, plus Unassigned). It filters
  `billing_tracker in [...]`, because managers live on the tracker.
- A row you may not edit shows a lock instead of the pencil.

**Layout:** neither table scrolls sideways. Below 1280 px, amounts switch to lakh/crore shorthand, with the
full amount on hover.

---

## 2. Data model

```
Project Billing Packages (master, fixture)            Projects
  Electrical · HVAC · FA · PA · Sprinkler                │ one project ── many trackers
  Access Control · CCTV · Networking · Others            ▼
        │ package (Link)                        Project Billing Tracker
        └─────────────────────────────────────►   one per project + package
                                                   name = {project}-{package}
                                                   ├── billing_managers → Project Billing Manager (child)
                                                   ├── dc_log           → Project Billing DC Log (child)
                                                   │ one tracker ── many bills
                                                   ▼
                                             Project Billing  (one per bill)
                                               project + package copied from the tracker
```

### Project Billing Packages (master)
| Field | Type | Note |
|---|---|---|
| package_name | Data, required, unique | also the record name |

- **The 9 starting names are a fixture** (`fixtures/project_billing_packages.json`, decision 15).
- **Names are unique ignoring case.** "electrical" is refused beside "Electrical".
- **Any package can be renamed;** the trackers follow. Any unused package can be deleted (decision 19).
- **A migrate brings back** any of the 9 that was deleted, or renamed away from its fixture name.

### Project Billing Tracker (one per project + package)
| Field | Type | Note |
|---|---|---|
| project | Link → Projects | required, set once |
| package | Link → Project Billing Packages | required, set once |
| billing_managers | Table MultiSelect → Project Billing Manager | one or more managers (decision 17) |
| po_value | Currency | typed in the Packages dialog; greater than 0, plain rupees (decision 22) |
| supply_dc | Currency, read-only | sum of the DC log |
| dc_updated_on | Date, read-only | latest DC log date; drives "Updated today / N days ago" |
| dc_log | Table → Project Billing DC Log | |
| remarks | Small Text | shown as the package's notes |

- **Name and uniqueness:** named `{project}-{package}` (e.g. `BENGALURU-PROJ-00080-Electrical`), so a
  project has each package only once.
- **Change history** is on (`track_changes`).
- **The tracker's own validate** (`project_billing_tracker.py`):
  - drops a manager picked twice;
  - stamps `entered_by` on new DC rows;
  - recomputes `supply_dc` and `dc_updated_on` from every row (never incremented);
  - refuses a PO value of 0 or less when it is set or changed (decision 22; an older package saved without
    one can still be edited);
  - refuses a new Supply DC amount while the PO value is not set; a ₹0 "no delivery" row is still allowed
    (decision 23);
  - refuses a Supply DC total below zero;
  - refuses a Supply DC total above the package's PO value (decision 21).
- **A new tracker is refused unless the project is Won** (`validate_won`, the same guard as Project Inflows).

### Project Billing Manager (child of the tracker)
| Field | Type | Note |
|---|---|---|
| manager | Link → User, required | one row per manager, in the order picked |

- **Field name:** it is `manager`, not `user`: `user` is reserved in PostgreSQL.
- **How reads see managers:**
  - They join managers through one `GROUP BY parent` subquery (`_queries.MANAGERS_JOIN`), so a tracker row
    never multiplies.
  - "Packages I manage" is an `EXISTS` (`managed_by`).
- **Old column:** the old single `billing_manager` column is still in the database, unread (decision 17).

### Project Billing DC Log (child of the tracker)
| Field | Type | Note |
|---|---|---|
| dc_date | Date, required, default today | |
| amount | Currency | value delivered (incl. GST); 0 = no delivery; negative corrects an earlier row |
| entered_by | Link → User, read-only | stamped on save |

- **No package field:** the tracker it sits in is the package.
- **Saved rows:** only Admin can change or delete one (in Desk). Everyone else only adds rows.
- **Desk:** `dc_date`, `amount` and `entered_by` are grid columns, and the grid always shows its filter row.

### Project Billing (one per bill)
| Field | Type | Note |
|---|---|---|
| billing_tracker | Link → Project Billing Tracker | required, set once |
| project | Link → Projects, read-only | copied from the tracker on every save |
| package | Link → Project Billing Packages, read-only | copied from the tracker on every save |
| bill_type | Select | Supply 1 · Supply 2 · Supply 3 · RA 1 · RA 2 · RA 3 · Final · NA |
| status | Select, default Not Started | the 13 statuses in §3 |
| bill_value | Currency | optional; greater than 0 when entered (decision 22) |
| payment_received | Currency | per-bill tracking only; feeds no total (inflow comes from Financials) |
| invoice_requested | Check | per-bill tracking only (yes / no); feeds no total |
| eta_date | Date | today or later when set or changed |
| first_submission_date | Date, read-only | stamped when saved as Submitted, never by another status (§3) |
| approval_date | Date | today or later when set or changed |
| bill_document_link | Data (URL) | a link **or** `bill_attachment`, never both |
| bill_attachment | Attach | uploaded before save, then linked to the bill by `bills._link_attachment` |

- **The bill's own validate** (`project_billing.py`):
  - copies project and package from the tracker;
  - refuses a negative bill value or payment received (decision 22);
  - refuses a bill missing what its status requires (`rules.missing_bill_fields`, decision 24);
  - stamps the first submission date, on Submitted only (decision 25);
  - refuses a link and an attachment together;
- **The bill hook** (`billing_validate` → `_guard_billed_within_po`) refuses a bill that takes the package's
  billed total (non-NA bills) above its PO value, naming the most this bill can be (decision 21).
- **Uniqueness:** the same package may have two bills of the same type (decision 3).
- **No DC on a bill:** Supply DC is package-level only (decision 8).
- **Change history** is on (`track_changes`).

---

## 3. Statuses and rules

**13 statuses:** Not Started, Prepared, Submission Pending, Internally Approved, Revision Pending,
Submitted, Client Hold, Certification Pending, Client Approved, Invoice Sent, Payment Received,
Partial Payment Received, NA.

| Group | Statuses |
|---|---|
| **Pending (8)** | Not Started, Prepared, Submission Pending, Internally Approved, Revision Pending, Submitted, Client Hold, Certification Pending |
| **Approved (4)** | Client Approved, Invoice Sent, Payment Received, Partial Payment Received |
| **Neither** | NA: left out of every count **and** every money total |

- **Next bill** of a package = the pending bill with the **earliest ETA**; bills without an ETA come last.
- **First submission date** is stamped with today's date the first time a bill is saved as **Submitted**,
  and by no other status (decision 25, `rules.first_submission_date`).
  - It never moves afterwards and cannot be edited.
  - A bill that skips Submitted (e.g. Prepared → Client Approved, or created straight as Certification
    Pending) keeps it **empty**; the drawer warns "You're skipping the Submitted status, so the first
    submission date will stay empty." If the bill is saved as Submitted later, it is stamped then.
  - It records when the status was saved, not when the bill physically went out.
  - `SUBMITTED_OR_LATER` no longer drives the date; it only tells the drawer when to show the skip
    warning. Skipping Submitted is never blocked.
- **Deadline filter** (Bill Wise grid and bills table): pending bills only.
  - "Due within 7 days" = ETA from today to today + 7.
  - "Overdue" = ETA before today.
  - "No ETA set" = no ETA.
  - Defined twice and kept identical: `rules.deadline_window` for the grid, `deadlineFilters` for the table.
- **Totals:**
  - Billed = bill value of non-NA bills.
  - Approved = bill value of approved bills.
  - The project tab's Total Invoiced and Total Inflow come from Financials (decision 11): the project's
    Project Invoices and Project Inflows. Billing computes no invoiced or inflow figure of its own; the
    per-bill "Invoice requested" and "Payment received" fields are tracking only and feed no total.
- **PO value:** typed per package; the project PO total is the sum over its trackers. Progress bars and
  "% of PO" fall back to the billed total until a PO value is entered.
- **PO value cap** (decision 21): a package's billed total (non-NA bills) and its Supply DC total may not go
  above its PO value. A save is refused only when the PO value is set, the save pushes the total above it, and the total goes up (`rules.raises_over_po`). So a package with no PO value is never capped, and one already over its PO can still be saved unchanged or corrected down. Lowering the PO value itself is
  always allowed, even below what is already billed or delivered.

The rules live in one pure module: `services/project_billing/rules.py` (`APPROVED_STATUSES`,
`PENDING_STATUSES`, `SUBMITTED_OR_LATER`, `SUBMITTED_STATUS`, `first_submission_date`, `next_bill`, `SUMMARY_COLUMNS`, `summary_column`,
`deadline_window`, `can_edit_package_bills`, `clean_package_name`). The frontend's status lists are pinned
to the doctype by `src/utils/projectBillingStatusParity.test.ts`.

---

## 4. Workflows

1. **Set up packages** (project Billing tab → "Set up billing packages" / "Packages"; Admin, PMO and
   Billing users):
   - ① Tick the packages in scope. A package already set up stays ticked and locked.
   - ② For each picked package, choose one or more managers and type the PO value: plain rupees, greater
     than 0 (decision 22).
     "Use these managers for all packages" copies one row to the rest.
   - A missing PO value blocks saving (red, named in the footer). A missing manager is outlined in amber and
     never blocks saving.
   - Save creates one tracker per new package and updates the managers and PO value of existing ones, in one
     transaction.
2. **Edit one package** (Admin; ✏️ on the package row): managers and PO value for that package, saved
   through the same setup endpoint.
3. **Add or edit a bill** (Add Bill on the project tab; the pencil on any bills table):
   - Project is fixed. Package offers only the packages you may edit (decision 18); with none set up, the
     drawer asks to set up packages first.
   - Fields: bill type, value, ETA, approval date, status, payment received, invoice requested, and the
     document as a **link or an uploaded file**.
   - Package, bill type and status are always required (marked *). Required by status (decision 24, marked * in the drawer):
     bill value > 0 always; ETA while pending; payment received > 0 for Partial Payment Received. The bill
     document (link or file) is optional at every status. An NA bill (NA status or NA type) needs none of these.
   - Save is never disabled for a gap (owner, 2026-10-05): a click with something missing saves nothing,
     flags each missing field (red border + message) and scrolls to the first. A wrong value (past date,
     "2.5L", 0) is flagged as it is typed. A refusal from the server (e.g. over the PO value) is a toast.
   - ETA and approval date cannot be before today when set or changed: the drawer and `save_bill` check it
     (`rules.changed_to_past`). Desk is not checked, so Admin can set any date there (decision 26).
   - A saved money field of 0 (the server stores an empty Currency as 0) opens as an empty box
     (`moneyInputOf`), so editing a bill never flags an untouched Payment received or Bill value.
   - The package's billed total cannot go above its PO value: the save is refused with a toast saying the
     most this bill can be (server check, decision 21).
4. **Log Supply DC** ("Update Supply DC" on My Bills, and on the project tab for Admin and PMO): lists only
   the packages you may edit.
   - **Add today's:** the value delivered today.
   - **Correct total:** type the corrected total and the difference is logged (a minus entry when lower).
     A total equal to the current one is refused.
   - **No delivery today:** saves a ₹0 row dated today, so the package counts as updated today.
   - A package with no PO value cannot log an amount: its card says to set the PO value first and offers
     only "No delivery today" (decision 23).
   - Plain rupee amounts greater than 0 only (e.g. 250000); "2.5L" / "1.2cr" are not accepted (decision 22).
     Add today's takes a positive amount; a lower total goes through Correct total, which itself must be
     greater than 0; a zero day goes through No delivery today.
   - A typed 0 is refused on screen (decision 16); the server refuses a total below zero, and a total above
     the package's PO value (decision 21). The sheet shows "More than the PO value" before saving.
   - Saved rows: Admin only, in Desk.
5. **Delete a bill:** in Desk only (no screen), same rule as editing.
6. **Manage billing packages** (Billing Packages tab; Administrator, Admin, Billing Lead):
   - Add.
   - Rename: every project's tracker and the bills follow, in one transaction.
   - Delete: only while no project uses the package.

---

## 5. Roles and permissions

Billing users = Admin, PMO, Billing Executive, Billing Lead (and Administrator).

| Action | Who | Enforced by |
|---|---|---|
| See billing (tab, page, lists, read endpoints) | billing users | `has_permission` + `permission_query_conditions` hooks on Tracker and Bill; `require_billing_access` in each read endpoint; screens use `canUseProjectBilling` |
| Set up packages, edit managers and PO value | billing users | `tracker_validate` (billing writer); Won check on a new tracker |
| ✏️ edit one package on the project tab | Admin, **on screen only** (`canEditBillingPackage`) | the server accepts every billing user (open question 1) |
| Add or edit a bill | Admin: every package; others: packages they manage | `billing_validate` → `can_edit_package_bills` |
| Delete a bill (Desk) | same as edit | `billing_on_trash` |
| Add a Supply DC row | Admin: every package; others: packages they manage, checked against the managers **as saved** (adding yourself and a DC row in one save is refused) | `tracker_validate` (`_guard_new_dc_rows`) |
| Change or delete a saved DC row | Admin only | `tracker_validate` (`_guard_saved_dc_rows`) |
| Remove a package from a project (bills, Supply DC, managers, PO value) | **Admin only**: trash icon on the package tab, typed confirmation | `setup.remove_project_package` (Admin check + typed name, one transaction) |
| Delete a tracker (Desk) | **Admin only**, and only while it has no bills (Frappe's link check) | `tracker_on_trash` (decision 27) |
| Add, rename, delete a billing package | Administrator, Admin, Billing Lead | package hooks (`_require_package_writer`); screen uses `canManageBillingPackages` |
| See the package list | billing users; also any profile carrying System Manager (names only) | doctype permission |

**Doctype permissions (the first layer):**

| Doctype | System Manager | Billing Lead | PMO | Billing Executive |
|---|---|---|---|---|
| Project Billing Packages | read, write, create, delete | read, write, create, delete | read | read |
| Project Billing Tracker | read, write, create, delete | same | same | same |
| Project Billing | read, write, create, delete | same | same | same |

**System Manager is not admin-only.** It also rides on the Project Lead, Design Lead, Estimates Executive
and HR Executive profiles, so the doctype permissions alone would let those in. The hooks in
`integrations/controllers/project_billing.py` keep them out, using the role-profile lists in
`services/role_profiles.py`:
- `PROJECT_BILLING_WRITE_PROFILES`
- `PROJECT_BILLING_PACKAGE_WRITE_PROFILES`
- `can_write_project_billing`

Screen checks only decide what renders; the hooks are the boundary.

**Billing Executive** is otherwise a view-only role (ADR-0015). This module is the exception: it may set
up packages, and add bills and Supply DC on the packages it manages.

---

## 6. Backend

**Endpoints** (`api/project_billing/`). An endpoint exists only for several documents in one transaction,
a SQL total or join, or a server-side lock:

| Endpoint | What | Why an endpoint |
|---|---|---|
| `project_view.get_project_billing(project)` | the project tab: trackers with managers, per-package and project totals (bill count, pending count, billed, approved), next bills, `can_write` | SQL totals and the managers join |
| `tracker.get_billing_projects()` | Project Wise rollup, with each package's next bill and `overdue_count` | SQL totals across projects |
| `tracker.get_manager_summary(deadline)` | Bill Wise grid: counts per manager × status, every manager listed | SQL `GROUP BY` |
| `tracker.get_my_bills()` | My Bills: counts, my packages | SQL with `managed_by` |
| `setup.setup_project_billing(project, packages)` | `packages = [{package, billing_managers: [user, …], po_value}]`; creates or updates trackers | several trackers, one transaction |
| `bills.save_bill(bill)` | create (needs `billing_tracker`) or update (needs `name`) a bill; refuses an ETA / approval date set or changed to before today (app only, decision 26); then links its uploaded file | the bill and its file row in one transaction; an update through the doc API would also add a raw `updateDoc` (residence rule F5) |
| `supply_dc.add_dc_entry(tracker, amount, dc_date)` | lock the tracker, append one DC row | the doc API replaces the whole DC log with the browser's copy, so two people logging at once would lose a row |
| `setup.get_package_removal_summary(tracker)` | Admin: what removing a package deletes (bills incl. NA, billed / approved, attachments, DC entries and total, managers, PO value) | the exact numbers for the warning, counted in SQL |
| `setup.remove_project_package(tracker, confirm_name)` | Admin: delete every bill of the package (with its file), then the package with its DC log and managers; the typed name must match | several documents, one transaction |
| `packages.rename_billing_package(name, new_name)` | rename the package and every tracker `{project}-{package}` | several documents, one transaction |

**Standard document API (frappe-react-sdk):**
- Bill rows: `useServerDataTable` on `Project Billing`.
- Package list: `useBillingPackages`.
- Add a package: `useFrappeCreateDoc`.
- Delete a package: `useFrappeDeleteDoc`.

**Shared read helpers:** `_queries.py`, holding `MANAGERS_JOIN`, `with_managers`, `managed_by`,
`bill_totals`, `totals_of`, `next_bills_by_tracker`, `stamp_can_edit_bills` and `require_billing_access`.

**Hooks** (`integrations/controllers/project_billing.py`, wired in `hooks.py`):

| Doctype | Hook | Does |
|---|---|---|
| Tracker, Bill | `has_permission`, `get_permission_query_conditions` | hide billing from non-billing users |
| Tracker | `tracker_validate` | billing writer; Won check on new; saved DC rows Admin-only; new DC rows by managers as saved |
| Tracker | `tracker_on_trash` | billing writer, and Admin only (decision 27) |
| Bill | `billing_validate` | billing writer + Admin or a manager of the bill's package; billed total within the PO value |
| Bill | `billing_on_trash` | billing writer + Admin or a manager of the bill's package |
| Packages | `package_validate` | Admin / Billing Lead; duplicate name ignoring case |
| Packages | `package_before_rename` | Admin / Billing Lead; no merge; no clash |
| Packages | `package_on_trash` | Admin / Billing Lead; refused while any tracker uses it |

---

## 7. Frontend map (`src/pages/ProjectBilling/`)

| File | Role |
|---|---|
| `ProjectBillingTab.tsx` | the project Billing tab (wired in `pages/projects/project.tsx` as `?page=billing`) |
| `BillingTrackerPage.tsx` | `/billing-tracker`: Project Wise, Bill Wise, My Bills |
| `BillingProjectPage.tsx` | `/billing-tracker/:projectId` (View Bills); reads the cached `get_billing_projects` row |
| `components/BillsDataTable.tsx` + `config/bills.config.tsx` | every bills table; columns, facets, lock vs pencil, Attach icons (blue link / violet file) |
| `components/AssignedFilter.tsx` | the "Assigned" header filter |
| `components/BillDrawer.tsx` | add / edit a bill |
| `components/SetupBillingDialog.tsx` | the two-step Packages dialog |
| `components/EditPackageDialog.tsx` | Admin ✏️: one package's managers and PO value |
| `components/RemovePackageDialog.tsx` | Admin: the "Remove <package> from <project>?" warning with exact counts and a typed confirmation |
| `components/SupplyDcSheet.tsx` | Update Supply DC |
| `components/BillingPackagesMaster.tsx` | the Billing Packages tab (via `src/components/billing-packages.tsx` and `pages/PackagesSettings/config/packageSettingsTabs.constants.ts`) |
| `components/BillingBits.tsx` | shared pieces: `StatusBadge`, `Money`, `PersonChips`, `PackageTabs`, `SegmentedTabs`, `EtaCell`, `ApprovalBar` |
| `data/useBillingQueries.ts` | every read and write; `useRefreshBilling` refreshes all `project-billing:` keys after a write |
| `utils/billingFormat.ts` | pure helpers: `dcEntryPlan`, `poAmount`, `setupSummary`, `cleanPackageName`, `clashingPackage`, `trackersAssignedTo`, `billDocMode`, `projectDeadline`, `shownBillStatus`, `billStatusOptions`, `visiblePackages`, `sortPackagesByDeadline`, `projectWiseRows`, … |
| `billing.constants.ts`, `types.ts` | endpoint names, cache keys, status lists, types |

The app shell also changed:
- `constants/roles.ts`: `PROJECT_BILLING_PROFILES`, `canUseProjectBilling`, `canEditBillingPackage`,
  `canManageBillingPackages`.
- `components/layout/NewSidebar.tsx`: the Billing Tracker entry.
- `components/helpers/routesConfig.tsx`: the two routes.
- `useSWRConfig` must come from `frappe-react-sdk`, never `swr`; otherwise the refresh does nothing.

---

## 8. Decisions (owner)

| # | Question | Decision |
|---|---|---|
| 1 | First submission date: automatic only, or editable with pre-fill? | **Automatic only.** *Which status stamps it: decision 25.* |
| 2 | Who can change past DC rows? | **Admin only, in Desk.** Give the child table filterable columns in Desk. |
| 3 | Two bills of the same type in one package? | **Allowed.** |
| 4 | Who sets up billing and edits bills? | **Admin, PMO and Billing users** (Billing Lead + Billing Executive). *Narrowed for bills and Supply DC by decision 18.* |
| 5 | Billing on Tendering projects? | **Billing tab shows only after the project is Won.** Tendering projects keep their separate Overview + BoQ view. |
| 6 | PO value per package? | **Typed by the user per package at setup**, beside the package and its manager; editable from the same Packages dialog (owner, 2026-10-03 — replaces the earlier "on hold, show 0"). |
| 7 | One tracker per project or per package? | **Per project + package**, unique pair, package from the master list. |
| 8 | DC on bills? | **No.** Supply DC is package-level only. |
| 9 | Next bill order? | **Earliest ETA** among pending bills. |
| 10 | Billing packages vs procurement packages? | **Separate list**; never mapped to Procurement Packages. |
| 11 | Invoiced / Inflow source? | **Project summary card: the Financials tab's figures** (owner, 2026-10-03; replaces "per-bill fields, upgrade later"). Total Invoiced = the project's Project Invoices, Total Inflow = its Project Inflows, read through the Financials tab's own hook and sums (`useProjectFinancialsTabData`, `getTotalProjectInvoiceAmount` / `getTotalInflowAmount`), so both screens always show the same numbers. Project level only: invoices and inflows carry no package. Shown to everyone with the Billing tab, PMO included, although the Financials tab hides them from PMO (owner: restrict later). The per-bill "Invoice requested" and "Payment received" fields stay, for tracking each bill; the old totals the server computed from them (`invoiced_count`, `invoiced`, `inflow`) were removed from the code (owner, 2026-10-05). |
| 12 | Add Bill drawer | **Project automatic and fixed; package only from those set up for the project.** |
| 13 | `billing_manager` + `remarks` on the tracker? | **Keep both.** The single manager became several in decision 17. |
| 14 | Project Lead / Accountant / Accountant Lead read access? | **Removed.** Only Admin, PMO and Billing users see billing, read included. |
| 15 | How are the 9 packages created? | **Fixture** (`fixtures/project_billing_packages.json`), no patch (owner, 2026-10-03; kept 2026-10-05 when a one-time seed patch was offered). |
| 16 | A 0 typed in the Supply DC box? | **Not saved** (owner, 2026-10-03). *Since decision 22 a corrected total must also be greater than 0, so a correction all the way down to 0 is no longer entered from the screen.* The **"No delivery today"** button is the one way to log a zero day: it saves a ₹0 DC log row dated today, so the package counts as updated today (owner, 2026-10-03, after briefly hiding it; no extra field). In Correct total, a total equal to the current one is refused too; a real correction down to 0 still saves, as a minus entry. Screen rule only (`dcEntryPlan`): the server still accepts an amount of 0. |
| 17 | Several billing managers per package? | **Yes** (owner, 2026-10-03). New child table `Project Billing Manager`, shown on the tracker as `billing_managers`; it replaces the single `billing_manager` field. My Bills and the Bill Wise manager filter match anyone among the managers. The Bill Wise manager grid counts a package's bills under each of its managers, so its rows can add up to more than the overall total. No patch: nothing was live, and the old column is left in the database unread. |
| 18 | Who may add / edit bills and log Supply DC? | **Admin for every package; everyone else only for packages where they are one of the billing managers** (owner, 2026-10-03; narrows decision 4 for bills and DC). Viewing is unchanged: every billing user still sees every bill. Setup (Packages dialog: managers, PO value) is unchanged. Enforced in the controller hooks (bill save / delete, a new DC row checked against the managers as saved) through the pure `rules.can_edit_package_bills`; the read APIs stamp `can_edit_bills` per package and the screens follow it: Update Supply DC lists only those packages, Add Bill offers only those, and other rows show a lock instead of the pencil. |
| 19 | Where are billing packages managed? | **Admin Options → Packages Settings → Billing Packages tab** (owner, 2026-10-05). Admin adds, renames and deletes (server rule: Admin + Billing Lead); PMO sees it read-only. Every package is ordinary (owner, 2026-10-05: "that not standard i can remove those also", which replaced the earlier option a with its locked standard 9): any package can be deleted while no project uses it, and renamed at any time. Because the fixture stays, a migrate re-creates any of the 9 that was deleted, or renamed away from its fixture name. Renaming or deleting: `rename_billing_package` renames the package AND each tracker named `{project}-{package}` (Frappe's rename then updates the bills' `billing_tracker` / `package` links, the managers + DC log child rows and the Version history), in one transaction (owner, 2026-10-05: option 1, no tracker ID keeps the old name). Names are unique ignoring case. |
| 20 | Endpoints for single-document calls? | **No** (owner, 2026-10-05). The package list, add and delete use the standard document API; the unused `delete_bill`, `get_billing_packages`, `add_billing_package` and `delete_billing_package` endpoints were removed. Endpoints only where §6 says why. |
| 21 | Can billing or Supply DC go above the PO value? | **No** (owner, 2026-10-05). A package's billed total (non-NA bills) and its Supply DC total stay within its PO value; a save that would go over is refused with a toast (bills: "… This bill can be at most ₹X"). The check is the total, not each bill alone; a package with no PO value set is not capped (for Supply DC, decision 23 now refuses it outright); only an increase past the PO is refused, so status changes and corrections down still save. Enforced on the server (`_guard_billed_within_po`, the tracker's validate) through `rules.raises_over_po`; the Supply DC sheet also shows it before saving. Supply DC takes plain rupee amounts only (no L / cr). |
| 22 | Amounts and the PO value? | **Plain rupees, greater than 0** (owner, 2026-10-05). Every billing money box takes a plain number (no 45L / 1.2cr shorthand). The PO value is required and greater than 0: the Packages and Edit dialogs block Save without it, the setup endpoint refuses it, and the tracker refuses a PO value of 0 or less whenever it is set or changed (older packages saved without one keep working). Bill value and payment received are optional but greater than 0 when filled in (screen); the server refuses negatives (an empty field is stored as 0). Supply DC: the typed amount or corrected total is greater than 0. |
| 23 | Supply DC on a package with no PO value? | **Not allowed** (owner, 2026-10-05): there is nothing to measure it against. The Supply DC sheet shows "Set this package's PO value before logging Supply DC" instead of the amount box, keeping only "No delivery today" (owner, same day: a zero day needs no PO value), and the tracker refuses any new non-zero DC row while the PO value is 0. Already-saved rows stay, and Admin can still correct them in Desk. Bills on such a package are still allowed (not decided). |
| 24 | Which bill fields are required? | (owner, 2026-10-05) Package, bill type and status as before, plus, by status: a **bill value greater than 0** on every bill; an **ETA date** while the bill is pending; **payment received greater than 0** for Partial Payment Received. An NA bill (NA status or NA bill type) needs none. *The bill document was required from Submitted on until the owner made it optional the same day (2026-10-05): it blocked a bill that skipped Submitted, which must only warn.* One rule, `rules.missing_bill_fields`, checked on every save (Desk and API too); the drawer mirrors it (`billMissingFields`), marks the fields * and, on a Save click with gaps, flags each missing field instead of saving (Save itself is never disabled for a gap). Saved bills are not changed; the rule applies on their next save. **Approval date is not required yet:** the "today or later" date rule would force today's date instead of the real approval date (open). |
| 25 | Which status fills the first submission date? | **Submitted only** (owner, 2026-10-05; was any Submitted-or-later status). Stamped once with that day, never moved. A bill that skips Submitted keeps it empty, and the drawer warns while the status is being changed: "You're skipping the Submitted status, so the first submission date will stay empty." A warning, not a block. Dates already stamped by a later status are kept. |
| 26 | Past ETA / approval dates in Desk? | **Allowed in Desk** (owner, 2026-10-05). The "today or later when set or changed" rule moved out of the bill's validate into `save_bill`, the app's endpoint, so the drawer still refuses a past date while Desk (Admin corrections) can set any date. Supply DC row dates have no date rule. |
| 27 | Removing a package from a project? | **Admin only, with a clear warning** (owner, 2026-10-05). A trash icon on each package tab (project Billing tab and View Bills page; Admin only) opens "Remove <package> from <project>?" listing exactly what goes: the bills (billed / approved, attachments, NA count), the Supply DC entries and total, the managers and the PO value. The package's name must be typed to confirm. `remove_project_package` deletes the bills and the package in one transaction (Admin check and typed name checked again on the server); Frappe keeps each in Deleted Documents for an Admin to restore. Deleting a package in Desk is Admin only too. |

---

## 9. Open questions and known gaps

**Waiting for the owner**
1. The Admin-only ✏️ (edit one package) is a screen rule only; the setup endpoint accepts every billing
   user. Enforce it on the server?
2. ~~Any billing user can delete a tracker that has no bills (in Desk).~~ Answered by decision 27: Admin only.
3. The server does not check that a chosen billing manager has a billing profile.
4. The automatic first submission date can fall after the typed approval date.
5. PMO sees Total Invoiced / Total Inflow on the Billing tab although Financials hides them from PMO
   (decision 11: restrict later).
6. Test data on CTS Chennai (`KANCHIPURAM-PROJ-00107`): trackers, bills and DC rows from testing. Keep or
   delete?

**Known gaps (accepted or not yet fixed)**
- A migrate brings back any of the 9 fixture packages that was deleted or renamed (decision 19).
- `get_my_bills` returns every bill row although the screen uses only the counts and packages; the
  counts could be a SQL `COUNT`.
- `/billing-tracker` has no page-level role guard: the sidebar hides it and the server refuses the data,
  but a typed URL opens an empty page.
- Shared code, not billing: `api/data_table/search.py` counts with `frappe.db.count`, so a non-billing user
  calling the DataTable API directly gets `total_count` (rows and facets stay empty).

---

## 10. Tests and how to verify

**Automated**

| Suite | Count | Run |
|---|---|---|
| `services/project_billing/test_rules.py` | 41 | in the container, from `apps/nirmaan_stack`: `../../env/bin/python -m unittest nirmaan_stack.services.project_billing.test_rules` |
| `utils/billingFormat.test.ts` | 58 | in the container, from `frontend`: `npx vitest run src/pages/ProjectBilling` |
| `src/utils/projectBillingStatusParity.test.ts` | 2 | `npx vitest run src/utils/projectBillingStatusParity.test.ts` |

**Manual check by role** (needs one login per role)

| Role | Must be able to | Must be refused |
|---|---|---|
| Admin | everything; ✏️ on a package; change a saved DC row in Desk | delete a package in use |
| PMO | see everything; set up packages; edit bills and log DC only where a manager | edit bills of others' packages; add / rename / delete billing packages |
| Billing Lead | as PMO, plus add / rename / delete billing packages | edit bills of others' packages |
| Billing Executive | see everything; set up packages; bills and DC on packages they manage | the rest |
| Project Lead / Accountant / others | — | see the Billing tab, the Billing Tracker or any billing data |

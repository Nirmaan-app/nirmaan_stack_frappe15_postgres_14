# Billing Tracker

Client-side billing tracker: the bills Nirmaan raises to the client, tracked per project and per
billing package, with a daily Supply DC log per package. Replaces the per-project billing Google
Sheet. Source mockups: `nirmaan-project-billing-tab.html` (project Billing tab) and
`nirmaan-bill-tracker.html` (Billing Trackers page).

This file is the single source of truth for the feature: what is built, the rules, who may do what,
and the owner's decisions. Synced with the code on 2026-10-05.

---

## 0. Status

- **Committed** on branch `billing-tracker`, 8 commits starting at `61ab3654d` (`git log 61ab3654d~1..`), **not pushed**.
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
- **Bills table:** "All | each package" tabs with bill counts (NA excluded).
- **Buttons:** Add Bill, Packages, Update Supply DC. Update Supply DC is hidden here for Billing Executive and
  Billing Lead (owner, 2026-10-05): they log Supply DC from Billing Tracker → My Bills. Screen only.

**Billing Tracker page**
- **Project Wise:**
  - Above the table: search (project name or manager), "X of Y projects", a **billing-status filter**
    and a **Deadline sort**.
    - Billing-status filter: a project matches when **any** of its bills is in the picked status (a
      project with no bills matches none). The options are the bill statuses that exist, in the standard
      order; a red badge shows while one is picked. Each project's statuses come from
      `get_billing_projects` (`bill_statuses`).
    - Deadline sort: ↑ earliest first (the default), ↓ latest first; a project with no deadline always
      last; ties A to Z.
    A project's deadline is the earliest ETA among its packages' next pending bills (`projectDeadline`,
    the same rule as the View Bills "Deadline" chip).
  - One row per project: status chip, managers, PO total with the approved/awaiting bar, Supply DC, and
    View Bills.
  - Expanding a project shows its package rows (manager, next bill and status, deadline, PO with bar) and a
    NOTES row with each package's remarks.
- **Bill Wise:**
  - The Billing Manager Summary grid counts bills per manager in 7 columns: Not Started · Submission
    (Prepared, Submission Pending) · Cert. Pending (Internally Approved, Submitted, Certification Pending) ·
    On Hold (Client Hold, Revision Pending) · Approved (Client Approved) · Invoiced (Invoice Sent) · Paid
    (Payment Received, Partial Payment Received). These are **bill counts by status**, not money: "Invoiced"
    means bills in status Invoice Sent. Defined once in `rules.SUMMARY_COLUMNS`.
  - Manager and Deadline filters drive both the grid and the bills table.
- **My Bills:** counts (my bills, pending, due in 7 days, overdue), the bills of the packages I manage, and
  Update Supply DC.

**View Bills page:** owner, deadline (earliest pending ETA), bill count, an "approved & beyond" ring,
package tabs, and the bills table.

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
| po_value | Currency | typed in the Packages dialog |
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
  - refuses a Supply DC total below zero.
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
| bill_value | Currency | |
| payment_received | Currency | per-bill tracking only; feeds no total (inflow comes from Financials) |
| invoice_requested | Check | per-bill tracking only (yes / no); feeds no total |
| eta_date | Date | today or later when set or changed |
| first_submission_date | Date, read-only | stamped automatically (§3) |
| approval_date | Date | today or later when set or changed |
| bill_document_link | Data (URL) | a link **or** `bill_attachment`, never both |
| bill_attachment | Attach | uploaded before save, then linked to the bill by `bills._link_attachment` |

- **The bill's own validate** (`project_billing.py`):
  - copies project and package from the tracker;
  - stamps the first submission date;
  - refuses a link and an attachment together;
  - refuses an ETA or approval date before today when it is set or changed (a saved past date may stay).
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
- **First submission date** is stamped with today's date the first time a bill is saved with Submitted,
  Client Hold, Certification Pending, Client Approved, Invoice Sent, Payment Received or Partial Payment
  Received (`SUBMITTED_OR_LATER`).
  - It never moves afterwards and cannot be edited.
  - A bill saved straight into a later status is stamped that day.
  - It records when the status was saved, not when the bill physically went out.
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

The rules live in one pure module: `services/project_billing/rules.py` (`APPROVED_STATUSES`,
`PENDING_STATUSES`, `SUBMITTED_OR_LATER`, `next_bill`, `SUMMARY_COLUMNS`, `summary_column`,
`deadline_window`, `can_edit_package_bills`, `clean_package_name`). The frontend's status lists are pinned
to the doctype by `src/utils/projectBillingStatusParity.test.ts`.

---

## 4. Workflows

1. **Set up packages** (project Billing tab → "Set up billing packages" / "Packages"; Admin, PMO and
   Billing users):
   - ① Tick the packages in scope. A package already set up stays ticked and locked.
   - ② For each picked package, choose one or more managers and type the PO value (accepts 45L / 1.2cr).
     "Use these managers for all packages" copies one row to the rest.
   - A missing manager or PO value is outlined in amber; it never blocks saving.
   - Save creates one tracker per new package and updates the managers and PO value of existing ones, in one
     transaction.
2. **Edit one package** (Admin; ✏️ on the package row): managers and PO value for that package, saved
   through the same setup endpoint.
3. **Add or edit a bill** (Add Bill on the project tab; the pencil on any bills table):
   - Project is fixed. Package offers only the packages you may edit (decision 18); with none set up, the
     drawer asks to set up packages first.
   - Fields: bill type, value, ETA, approval date, status, payment received, invoice requested, and the
     document as a **link or an uploaded file**.
   - ETA and approval date cannot be before today when set or changed (the screen and the server both check).
4. **Log Supply DC** ("Update Supply DC" on My Bills, and on the project tab for Admin and PMO): lists only
   the packages you may edit.
   - **Add today's:** the value delivered today.
   - **Correct total:** type the corrected total and the difference is logged (a minus entry when lower).
     A total equal to the current one is refused.
   - **No delivery today:** saves a ₹0 row dated today, so the package counts as updated today.
   - A typed 0 is refused on screen (decision 16); the server refuses a total below zero.
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
| Delete a tracker (Desk) | any billing user, only while it has no bills (Frappe's link check) | `tracker_on_trash` (open question 2) |
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
| `tracker.get_billing_projects()` | Project Wise rollup, with each project's distinct bill statuses | SQL totals across projects |
| `tracker.get_manager_summary(deadline)` | Bill Wise grid: counts per manager × status, every manager listed | SQL `GROUP BY` |
| `tracker.get_my_bills()` | My Bills: counts, my packages | SQL with `managed_by` |
| `setup.setup_project_billing(project, packages)` | `packages = [{package, billing_managers: [user, …], po_value}]`; creates or updates trackers | several trackers, one transaction |
| `bills.save_bill(bill)` | create (needs `billing_tracker`) or update (needs `name`) a bill, then link its uploaded file | the bill and its file row in one transaction; an update through the doc API would also add a raw `updateDoc` (residence rule F5) |
| `supply_dc.add_dc_entry(tracker, amount, dc_date)` | lock the tracker, append one DC row | the doc API replaces the whole DC log with the browser's copy, so two people logging at once would lose a row |
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
| Tracker | `tracker_on_trash` | billing writer |
| Bill | `billing_validate`, `billing_on_trash` | billing writer + Admin or a manager of the bill's package |
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
| `components/SupplyDcSheet.tsx` | Update Supply DC |
| `components/BillingPackagesMaster.tsx` | the Billing Packages tab (via `src/components/billing-packages.tsx` and `pages/PackagesSettings/config/packageSettingsTabs.constants.ts`) |
| `components/BillingBits.tsx` | shared pieces: `StatusBadge`, `Money`, `PersonChips`, `PackageTabs`, `SegmentedTabs`, `EtaCell`, `ApprovalBar` |
| `data/useBillingQueries.ts` | every read and write; `useRefreshBilling` refreshes all `project-billing:` keys after a write |
| `utils/billingFormat.ts` | pure helpers: `dcEntryPlan`, `poAmount`, `setupSummary`, `cleanPackageName`, `clashingPackage`, `trackersAssignedTo`, `billDocMode`, `projectDeadline`, `billStatusOptions`, `matchesBillStatus`, `sortProjectsByDeadline`, … |
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
| 1 | First submission date: automatic only, or editable with pre-fill? | **Automatic only.** |
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
| 16 | A 0 typed in the Supply DC box? | **Not saved** (owner, 2026-10-03). The **"No delivery today"** button is the one way to log a zero day: it saves a ₹0 DC log row dated today, so the package counts as updated today (owner, 2026-10-03, after briefly hiding it; no extra field). In Correct total, a total equal to the current one is refused too; a real correction down to 0 still saves, as a minus entry. Screen rule only (`dcEntryPlan`): the server still accepts an amount of 0. |
| 17 | Several billing managers per package? | **Yes** (owner, 2026-10-03). New child table `Project Billing Manager`, shown on the tracker as `billing_managers`; it replaces the single `billing_manager` field. My Bills and the Bill Wise manager filter match anyone among the managers. The Bill Wise manager grid counts a package's bills under each of its managers, so its rows can add up to more than the overall total. No patch: nothing was live, and the old column is left in the database unread. |
| 18 | Who may add / edit bills and log Supply DC? | **Admin for every package; everyone else only for packages where they are one of the billing managers** (owner, 2026-10-03; narrows decision 4 for bills and DC). Viewing is unchanged: every billing user still sees every bill. Setup (Packages dialog: managers, PO value) is unchanged. Enforced in the controller hooks (bill save / delete, a new DC row checked against the managers as saved) through the pure `rules.can_edit_package_bills`; the read APIs stamp `can_edit_bills` per package and the screens follow it: Update Supply DC lists only those packages, Add Bill offers only those, and other rows show a lock instead of the pencil. |
| 19 | Where are billing packages managed? | **Admin Options → Packages Settings → Billing Packages tab** (owner, 2026-10-05). Admin adds, renames and deletes (server rule: Admin + Billing Lead); PMO sees it read-only. Every package is ordinary (owner, 2026-10-05: "that not standard i can remove those also", which replaced the earlier option a with its locked standard 9): any package can be deleted while no project uses it, and renamed at any time. Because the fixture stays, a migrate re-creates any of the 9 that was deleted, or renamed away from its fixture name. Renaming or deleting: `rename_billing_package` renames the package AND each tracker named `{project}-{package}` (Frappe's rename then updates the bills' `billing_tracker` / `package` links, the managers + DC log child rows and the Version history), in one transaction (owner, 2026-10-05: option 1, no tracker ID keeps the old name). Names are unique ignoring case. |
| 20 | Endpoints for single-document calls? | **No** (owner, 2026-10-05). The package list, add and delete use the standard document API; the unused `delete_bill`, `get_billing_packages`, `add_billing_package` and `delete_billing_package` endpoints were removed. Endpoints only where §6 says why. |

---

## 9. Open questions and known gaps

**Waiting for the owner**
1. The Admin-only ✏️ (edit one package) is a screen rule only; the setup endpoint accepts every billing
   user. Enforce it on the server?
2. Any billing user, even one who manages no package, can delete a tracker that has no bills (in Desk).
   Intended?
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
| `services/project_billing/test_rules.py` | 20 | in the container, from `apps/nirmaan_stack`: `../../env/bin/python -m unittest nirmaan_stack.services.project_billing.test_rules` |
| `utils/billingFormat.test.ts` | 40 | in the container, from `frontend`: `npx vitest run src/pages/ProjectBilling` |
| `src/utils/projectBillingStatusParity.test.ts` | 2 | `npx vitest run src/utils/projectBillingStatusParity.test.ts` |

**Manual check by role** (needs one login per role)

| Role | Must be able to | Must be refused |
|---|---|---|
| Admin | everything; ✏️ on a package; change a saved DC row in Desk | delete a package in use |
| PMO | see everything; set up packages; edit bills and log DC only where a manager | edit bills of others' packages; add / rename / delete billing packages |
| Billing Lead | as PMO, plus add / rename / delete billing packages | edit bills of others' packages |
| Billing Executive | see everything; set up packages; bills and DC on packages they manage | the rest |
| Project Lead / Accountant / others | — | see the Billing tab, the Billing Tracker or any billing data |

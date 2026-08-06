# Role-Based Access Control Reference

This document contains detailed page-level role access control mappings for the Nirmaan Stack frontend.

## Role Profiles

| Role Profile | Short Name | Color |
|---|---|---|
| `Nirmaan Admin Profile` | Admin | Red |
| `Nirmaan PMO Executive Profile` | PMO Executive | Teal |
| `Nirmaan Project Lead Profile` | Project Lead | Amber |
| `Nirmaan Project Manager Profile` | Project Manager | Blue |
| `Nirmaan Procurement Executive Profile` | Procurement Executive | Emerald |
| `Nirmaan Accountant Profile` | Accountant | Purple |
| `Nirmaan Estimates Executive Profile` | Estimates Executive | Cyan |
| `Nirmaan Billing Executive Profile` | Billing Executive | Sky |
| `Nirmaan Design Lead Profile` | Design Lead | Indigo |
| `Nirmaan Design Executive Profile` | Design Executive | Pink |
| `Nirmaan HR Executive Profile` | HR Executive | Lime |

**Special:** `Administrator` user (user_id) is hardcoded with Admin role access.

**Note:** PMO Executive Profile mirrors Admin Profile access in all areas **except**:
- **TDS Approval:** PMO can see the "Pending Approval" tab (read-only) but cannot approve/reject TDS items
- **Project Payment Approval:** PMO can see the "Approve Payments" tab (read-only) but cannot approve/reject payments or edit fulfilled payments
- **PR Approval** *(2026-07-04 access review)*: PMO does **not** see the "Approve PR" tab and is blocked from the approve/reject view even by a direct/bookmarked `?tab=Approve PR` URL (redirected to New PR Request). Approver roles are **Admin + Project Lead** (`PR_ADMIN_ROLES` in `config/prTabs.constants.ts`). Unlike TDS/Payments, this is NOT a read-only tab — it is removed entirely. PMO keeps New PR Request / In Progress / Sent Back / All PRs.
- **New-item creation in the PR flow** *(2026-07-04 access review)*: PMO is treated like a Project Manager — in `new_items="false"` categories they can only **request** an item (ephemeral `REQ-…`), not create a master Item. The Admin/PMO category-restriction bypass was removed (Admin still bypasses). Does not affect the Items master table (PMO already could not create there; only edit).

---

## Billing Executive (view-only finance mirror) — [ADR-0015](../../../docs/adr/0015-billing-executive-role.md)

`Nirmaan Billing Executive Profile` is a **view-only mirror of Estimates Executive, MINUS Pricing (HVAC/Electrical/ELV) and MINUS BoQ.** The backend Role + Role Profile pre-existed in fixtures; this is frontend wiring + doctype permissions. The rule of thumb: everywhere the code reads `Nirmaan Estimates Executive Profile`, the Billing profile sits beside it **except** the two pricing gates and the BoQ surfaces.

- **Sidebar:** Dashboard, Projects, Item Price Search, Purchase Orders, Work Order Rate Card, TDS Repository. (No Pricing, no Upload BoQ, no BoQ Templates, no Admin Options.)
- **Two deliberate exclusions:** the Pricing sidebar spread (`NewSidebar.tsx`) + `PricingRoute` guard (so `/hvac-pricing` etc. 403 by direct URL). BoQ is likewise excluded on every surface (sidebar, BoQ-template authoring gates frontend+backend, all BoQ doctype perms, and the BoQ project tab).
- **Behaviour:** identical view-only treatment to Estimates on shared pages — it reuses the `isEstimatesExecutive` flag (`project.tsx`, `PurchaseOrder.tsx`, `approved-sr.tsx`, etc.). The **BoQ project tab is the one place they diverge**: a separate `isBilling` flag in `project.tsx` deletes `PROJECT_PAGE_TABS.BOQ` from the allowed set (it would 403 on `BOQs`).
- **Doctype permissions — mostly pre-existing, the changes are DB-ONLY (NOT in the repo).** Billing's baseline **read** perms were already seeded in fixtures on ~77 doctypes — and since Billing is view-only, read is all it functionally needs. The doctype-JSON edits made during this work were **deliberately reverted** (the "Don't Touch doctype JSONs" convention), so the repo carries no doctype-permission change for Billing. The 16 BoQ doctypes correctly have no Billing row.

> ⚠️ **DB-ONLY permission changes — not in the repo (reapply on every new env).** These were applied at runtime and a fresh site / prod restore silently lacks them:
> - **`Nirmaan Item Units`** (read) and **`Material Delivery Plan`** (read) — carry **`Custom DocPerm`**, which *fully overrides* standard `DocPerm`, so a JSON/fixture grant is inert. `Nirmaan Item Units` was the original "No permission" error. **These two MUST be reapplied** — Role Permission Manager → add role `Nirmaan Billing Executive` (read) on each.
> - 8 transactional doctypes upgraded read→RWCD + Commission Report Template Snapshot read (via `reload_doctype`) — **parity-only** (view-only role doesn't need write); a `bench migrate` resets these. Reapply only if strict Estimates parity is wanted.
>
> See [ADR-0015](../../../docs/adr/0015-billing-executive-role.md).

**Key files:** `utils/roleColors.ts` (`ROLE_COLORS`/`ROLE_OPTIONS`), `components/layout/dashboards/billing-executive-dashboard.tsx`, `pages/dashboard.tsx`, `components/layout/NewSidebar.tsx`, `pages/projects/project.tsx` (`isBilling` BoQ-tab hide). Backend: doctype JSON `permissions`, `api/sidebar_counts.py`, `api/projects/tendering.py`.

---

## Key Files

- `src/hooks/useUserData.ts` - Fetches user role from `NirmaanUsers` doctype
- `src/utils/auth/ProtectedRoute.tsx` - Route guards (AdminRoute, LeadRoute, ManagerRoute, ProcuementExecutiveRoute, UsersRoute, UserProfileRoute)
- `src/utils/roleColors.ts` - Role color schemes and `ROLE_OPTIONS` constant
- `src/components/layout/NewSidebar.tsx` - Sidebar menu visibility by role

---

## Common Patterns

```typescript
// Single role check
role === "Nirmaan Admin Profile"

// Multiple roles (Admin + PMO)
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role)

// Admin + PMO + Administrator bypass
user_id === "Administrator" || role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile"
```

---

## Sidebar Menu Access

| Feature | Admin | PMO | Proj Lead | Proj Mgr | Procurement | Accountant | Estimates | Design Lead | Design Exec | HR Exec |
|---------|:-----:|:---:|:---------:|:--------:|:-----------:|:----------:|:---------:|:-----------:|:-----------:|:-------:|
| Admin Options | Y | Y | - | - | - | - | - | - | - | - |
| Critical PO Categories | Y | Y | - | - | - | - | - | - | - | - |
| PO Tracker | Y | Y | Y | Y | Y | - | - | - | - | - |
| Projects (standalone) | - | - | Y | Y | Y | Y | - | - | - | - |
| Products (standalone) | - | - | - | - | Y | - | - | - | - | - |
| Vendors (standalone) | - | - | - | - | Y | - | - | - | - | - |
| Users (standalone) | - | - | - | - | - | - | - | - | - | Y |
| Item Price Search | Y | Y | Y | Y | Y | Y | Y | - | - | - |
| Procurement Requests | Y | Y | Y | - | Y | - | - | - | - | - |
| Purchase Orders | Y | Y | Y | - | Y | - | - | - | - | - |
| Work Orders | Y | Y | Y | - | Y | Y | - | - | - | - |
| Project Payments | Y | Y | Y | - | Y | Y | - | - | - | - |
| Credit Payments | Y | Y | Y | - | Y | Y | - | - | - | - |
| In-Flow Payments | Y | Y | - | - | - | Y | - | - | - | - |
| Invoice Reconciliation | Y | Y | - | - | Y | Y | - | - | - | - |
| Project Invoices | Y | Y | - | - | - | Y | - | - | - | - |
| Project Expenses | Y | Y | - | - | - | Y | - | - | - | - |
| Non-Project Expenses | Y | Y | - | - | - | Y | - | - | - | - |
| Reports | Y | Y | Y | Y | Y | Y | - | - | - | - |
| Design Tracker | Y | Y | Y | Y | - | - | Y | Y | - | - |
| Planning Tab | Y | Y | - | - | - | - | Y | - | - | - |
| Bulk Download | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| TDS Repository | Y | Y | - | - | Y | - | Y | - | - | - |
| Help Repository | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |

---

## Dashboard Routing

Each role sees a different dashboard (`src/pages/dashboard.tsx`):
- Admin → Default Dashboard
- PMO Executive → Default Dashboard (mirrors Admin)
- Project Lead → Project Lead Dashboard
- Project Manager → Project Manager Dashboard
- Procurement Executive → Procurement Dashboard
- Accountant → Accountant Dashboard
- Estimates Executive → Estimates Executive Dashboard
- Billing Executive → Billing Executive Dashboard (a copy of the Estimates dashboard, own `useCounts` cache key)
- Design Lead/Executive → Design Dashboard
- HR Executive → HR Dashboard

---

## Project Requirement Exemptions

Roles that don't require `has_project === "true"`:
- Nirmaan Admin Profile
- Nirmaan PMO Executive Profile
- Nirmaan Estimates Executive Profile
- Nirmaan Billing Executive Profile
- Nirmaan Design Lead Profile
- Nirmaan Design Executive Profile
- Nirmaan HR Executive Profile

---

## Page-Level Access Control

### Pages with Open Access (no role checks)
- `auth/` - Authentication at route level
- `ApprovedQuotationsFlow/`, `DeliveryNotes/`, `DeliveryChallansAndMirs/`
- `customers/`, `credits/`, `vendors-wp-categories/`
- `CriticalPOCategories/` - Sidebar-level access only
- `Manpower-and-WorkMilestones/` - No explicit checks

### Users Page Access (Route-Level Guards)

| Page | Admin | PMO | HR Exec | Others | Own Profile |
|------|:-----:|:---:|:-------:|:------:|:-----------:|
| `/users` (list) | Y | Y | Y | - | - |
| `/users/:userId` (profile) | Y | Y | Y | - | Y |

**Route Guards:** `UsersRoute`, `UserProfileRoute` in `ProtectedRoute.tsx`

---

### Procurement Requests (`ProcurementRequests/`)

| Feature | Admin | PMO | Proj Lead | Procurement | Others |
|---------|:-----:|:---:|:---------:|:-----------:|:------:|
| Approve PR Tab | Y | - | Y | - | - |
| New PR/In Progress Tabs | Y | Y | Y | Y | - |
| Sent Back Tabs | Y | Y | Y | Y | - |
| Delete PR | Y | Y | Y | - | - |
| Create New Item (bypass category restriction) | Y | - | - | - | - |

> **PMO note (2026-07-04):** PMO removed from `PR_ADMIN_ROLES`, so no "Approve PR" tab and the approve view/list are guarded against direct-URL access. The new-item create bypass now excludes PMO (Admin-only), so PMO is request-only in `new_items="false"` categories like a Project Manager.

**Key files:** `config/prTabs.constants.ts` (`PR_ADMIN_ROLES` — approver set), `render-procurement-requests.tsx` (approve-view URL guard → redirect), `procurement-requests.tsx` (tab visibility + pending-list guard), `NewPR/components/NewItemDialog.tsx` + `NewPR/components/ItemSelectorControls.tsx` (`newItemsDisabled` create-vs-request gate)

---

### Purchase Orders (`ProcurementOrders/`)

| Feature | Admin | PMO | Proj Lead | Proj Mgr | Procurement | Accountant | Estimates |
|---------|:-----:|:---:|:---------:|:--------:|:-----------:|:----------:|:---------:|
| Approve PO Tabs | Y | Y | Y | - | - | - | - |
| Status Tabs | Y | Y | Y | - | Y | - | Read-only |
| Request Payment | Y | Y | Y | - | Y | - | - |
| Update Delivery | Y | Y | Y | Y | Y | - | - |
| Dispatch PO | Y | Y | Y | - | Y | - | - |
| Revert PO Status | Y | Y | Y | - | Y | - | - |
| Delete Custom PO | Y | Y | Y | - | Y | - | - |
| Mark Inactive | Y | Y | - | - | - | Y | - |

**Key files:**
- `release-po-select.tsx:104-105,223-264`
- `PurchaseOrder.tsx:141`
- `PODetails.tsx:507,551,598,632,681,1069`
- `POPaymentTermsCard.tsx:758,909`

---

### Service Requests (`ServiceRequests/`)

| Feature | Admin | PMO | Proj Lead | Proj Mgr | Procurement | Accountant |
|---------|:-----:|:---:|:---------:|:--------:|:-----------:|:----------:|
| Approve Tabs | Y | Y | Y | - | - | - |
| Print SR | Y | Y | Y | - | Y | Y |
| Delete SR | Y | Y | Y | - | Y | Y |
| Record Payment | Y | Y | - | - | - | Y |
| SR Link Clickable | Y | Y | Y | - | Y | Y |

**Key files:**
- `ServiceRequestsTabs.tsx:23,45`
- `sr-summary.tsx:175,184,190-191`
- `approved-sr.tsx:70`
- `SRPaymentsSection.tsx:149`

---

### Financial Pages

| Page | Feature | Admin | PMO | Accountant | Others |
|------|---------|:-----:|:---:|:----------:|:------:|
| ProjectPayments | Approve Tab | Y | Read-only | Read-only | Read-only* |
| ProjectPayments | New Payments Tab | Y | Y | Y | - |
| ProjectPayments | Edit Payment | Y | - | Y | - |

*Read-only Approve tab visible to all roles with sidebar access (PL, Procurement Exec, etc.)
| ProjectExpenses | Add Expense | Y | Y | Y | - |
| ProjectExpenses | Delete Expense | Y | Y | - | - |
| NonProjectExpenses | Edit/Delete | Y | Y | - | - |
| ProjectInvoices | Edit/Delete | Y | Y | - | - |
| InFlowPayments | Edit/Delete | Y | Y | - | - |
| InvoiceReconciliation | Pending Tab | Y | Y | Y | - |

**Key files:**
- `RenderProjectPaymentsComponent.tsx:30,65,81`
- `AllPayments.tsx:124-125,357`
- `ProjectExpensesList.tsx:160,227`
- `NonProjectExpensesPage.tsx:240,249`
- `InFlowPayments.tsx:280`
- `InvoiceReconciliationContainer.tsx:23,51`

---

### Reports (`reports/`)

| Tab | Admin | PMO | Proj Lead | Proj Mgr | Procurement | Accountant |
|-----|:-----:|:---:|:---------:|:--------:|:-----------:|:----------:|
| Projects | Y | Y | Y | - | - | Y |
| Vendors | Y | Y | Y | - | - | Y |
| PO | Y | Y | Y | Limited* | Y | Y |
| WO (SR) | Y | Y | Y | - | Y | Y |

*Project Manager only sees "Dispatched for 1+ days" report

**Key files:** `ReportsContainer.tsx:49,130,136,144,150,183,185`

---

### Design Tracker (`ProjectDesignTracker/`)

| Feature | Admin | PMO | Design Lead | Design Exec | Proj Mgr | Proj Lead |
|---------|:-----:|:---:|:-----------:|:-----------:|:--------:|:---------:|
| Edit Structure (zones/categories) | Y | Y | Y | - | - | - |
| Edit All Tasks | Y | Y | Y | - | - | Y |
| Edit Assigned Tasks Only | - | - | - | Y | - | - |
| Switch Tabs | Y | Y | Y | Y | - | Y |
| View Only | - | - | - | - | Y | - |

**Key files:**
- `design-tracker-list.tsx:350-352,364`
- `project-design-tracker-details.tsx:629-631`

---

### Projects/Users/Items/Vendors

| Page | Feature | Admin | PMO | HR Exec | Proj Lead | Others |
|------|---------|:-----:|:---:|:-------:|:---------:|:------:|
| Projects | Edit Project | Y | Y | - | Y | - |
| Projects | Change Status | Y | Y | - | - | - |
| Projects | Assign Users | Y | Y | Y | Y | - |
| Users | Create New User | Y | Y | Y | - | - |
| Users | Manage (reset pwd, delete, rename) | Y | Y | Y | - | - |
| Users | Edit Role Profile | Y | Y | Y | - | Self only |
| Users | Assign Projects to Users | Y | Y | Y | - | - |
| Items | Add/Edit Products | Y | Y | - | - | - |
| Vendors | Export Ledger | Y | Y | - | Y (Accountant) | - |

**Key files:**
- `project.tsx:1045,1058`
- `ProjectOverviewTab.tsx:391`
- `user-profile.tsx:33`
- `EditUserForm.tsx:230`
- `UserRowActions.tsx:37`
- `renderRightActionButton.tsx:141,153`
- `itemsPage.tsx:173`
- `item.tsx:153`
- `POVendorLedger.tsx:53-54`

---

## Action Capabilities Summary

| Action | Admin | PMO | Proj Lead | Proj Mgr | Procurement | Accountant |
|--------|:-----:|:---:|:---------:|:--------:|:-----------:|:----------:|
| Create New PR | Y | Y | Y | - | Y | - |
| Approve/Reject PR | Y | - | Y | - | - | - |
| Create Item from PR (bypass category restriction) | Y | - | - | - | - | - |
| Create New Work Order | Y | Y | Y | - | Y | Y |
| Create Project/User/Vendor | Y | Y | - | - | - | - |
| Delete Project Expense | Y | Y | - | - | - | - |
| Add Project Expense | Y | Y | - | - | - | Y |
| Export Vendor Ledger | Y | Y | - | - | - | Y |
| Edit Vendor Bank Details | Y | Y | Y | - | Y | Y |
| Request Payments (PO) | Y | Y | Y | - | Y | - |
| Edit Design Tracker Structure | Y | Y | - | - | - | - |
| Edit User Role Profiles | Y | Y | - | - | - | - |
| Edit Items/Products | Y | Y | - | - | - | - |
| Edit Project Details | Y | Y | Y | - | - | - |

**Design Tracker specific:** Design Lead can edit structure; Design Executive can only edit assigned tasks; Project Manager is view-only.

**PMO Executive exceptions:** PMO Executive can view TDS Approval and Payment Approval tabs (read-only) but cannot approve/reject or edit fulfilled payments. PMO also **cannot approve/reject PRs** (no "Approve PR" tab; approvers = Admin + Project Lead) and **cannot create master Items from the PR flow** (request-only in restricted categories, like a Project Manager) — *2026-07-04 access review*. In all other areas, PMO mirrors Admin.

**TDS History deletion** *(2026-08-05)*: the Actions column in `TdsHistoryTable` is gated by TWO predicates, because they answer different questions — `canManageTDS` (Admin **or** PMO) decides who sees the COLUMN, `canDeleteRow(item)` decides which rows get a button. PMO deletes rows whose `tds_status` is **Pending or Rejected**; an Approved row is part of the signed submittal record and stays Admin-only. So a PMO sees the column with buttons on eligible rows and `--` on the rest, rather than icons that fail on click. `New` is NOT PMO-deletable (the status list is taken literally; no rows currently carry it). ⚠️ **UI gate only** — delete goes straight through `deleteDoc("Project TDS Item List", …)` with no whitelisted endpoint and no permission check, and the doctype grants delete to all 18 role profiles.

---

## Read-Only Approval Tabs

Approval tabs are visible to all roles with sidebar access, but non-approvers see them in read-only mode (info banner, no action buttons, no row navigation to approval screens).

| Page | Approver Roles | Read-Only Roles | Non-Approver Behavior |
|------|---------------|-----------------|----------------------|
| TDS Approval | Admin, Project Lead | PMO, Project Manager, others | See Pending tab, no row click, no actions, info banner |
| Project Payments | Admin | PMO, Accountant, PL, Proc Exec, others | See Approve Payments tab, no action buttons, info banner |

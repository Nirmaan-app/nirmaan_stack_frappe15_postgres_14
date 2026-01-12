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
| `Nirmaan Design Lead Profile` | Design Lead | Indigo |
| `Nirmaan Design Executive Profile` | Design Executive | Pink |
| `Nirmaan HR Executive Profile` | HR Executive | Lime |

**Special:** `Administrator` user (user_id) is hardcoded with Admin role access.

**Note:** PMO Executive Profile mirrors Admin Profile access in all areas.

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
| Critical PO Categories | Y | Y | Y | - | - | - | - | - | - | - |
| PO Tracker | Y | Y | Y | Y | Y | - | - | - | - | - |
| Projects (standalone) | - | - | Y | - | Y | - | - | - | - | - |
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
- Design Lead/Executive → Design Dashboard
- HR Executive → HR Dashboard

---

## Project Requirement Exemptions

Roles that don't require `has_project === "true"`:
- Nirmaan Admin Profile
- Nirmaan PMO Executive Profile
- Nirmaan Estimates Executive Profile
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
| Approve PR Tab | Y | Y | Y | - | - |
| New PR/In Progress Tabs | Y | Y | Y | Y | - |
| Sent Back Tabs | Y | Y | Y | Y | - |
| Delete PR | Y | Y | Y | - | - |
| Create New Item (bypass category restriction) | Y | Y | - | - | - |

**Key files:** `procurement-requests.tsx:117,177,181,186,351`, `NewItemDialog.tsx:83`

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
| ProjectPayments | Approve Tab | Y | Y | - | - |
| ProjectPayments | New Payments Tab | Y | Y | Y | - |
| ProjectPayments | Edit Payment | Y | Y | Y | - |
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

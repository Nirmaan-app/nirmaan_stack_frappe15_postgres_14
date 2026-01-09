# Claude Code Session Changelog

This file tracks significant changes made by Claude Code sessions.

---

## 2026-01-09: Added HR Executive Role with User Management Access

### Summary
Added `Nirmaan HR Executive Profile` as a new role focused on user management. HR Executive has access to Users page and all user management actions (create, edit, delete, reset password, assign projects).

### Files Created
- `src/components/layout/dashboards/dashboard-hr.tsx` - HR Executive dashboard with:
  - Total Users count card (links to /users)
  - Role Distribution section with clickable pills
  - Each role pill filters users table via URL params

### Files Modified

**Role Colors & Config:**
- `src/utils/roleColors.ts` - Added HR Executive with lime color scheme + ROLE_OPTIONS entry

**Navigation & Layout:**
- `src/components/layout/NewSidebar.tsx`:
  - Added standalone "Users" menu item for HR Executive (line 228-236)
  - Added "Users" to direct link labels whitelist (line 631)

**Dashboard Routing:**
- `src/pages/dashboard.tsx`:
  - Added HRDashboard import and rendering (line 76)
  - Added HR Executive to project requirement exemption list (line 57)

**User Management Access:**
- `src/components/helpers/renderRightActionButton.tsx` - HR can see "New User" in dashboard dropdown
- `src/pages/users/user-profile.tsx` - HR added to `isAdmin` check (line 33)
- `src/pages/users/EditUserForm.tsx` - HR can edit role profiles (line 230)
- `src/pages/users/components/UserRowActions.tsx` - HR added to `isAdmin` check (line 37)
- `src/pages/users/components/UserProjectsTab.tsx` - Fixed ReactSelect portal issue for assign project dialog

**User Form Enhancement:**
- `src/pages/users/user-form.tsx` - Role Profile field now uses ReactSelect (searchable)
- `src/pages/users/EditUserForm.tsx` - Role Profile field now uses ReactSelect (searchable)

**Backend:**
- `nirmaan_stack/api/users.py` - `get_user_role_counts()` now dynamically fetches all Nirmaan roles from Role Profile doctype

### Documentation Updated
- `.claude/context/role-access.md` - Added HR Executive to all access matrices
- `CLAUDE.md` - Updated role count to 10, added HR Executive special note

### Key Patterns

**Role Distribution with Filtered Navigation:**
```typescript
const navigateToFilteredUsers = (roleProfile: string) => {
  const filter = [{ id: "role_profile", value: [roleProfile] }];
  const encodedFilter = btoa(JSON.stringify(filter));
  navigate(`/users?users_list_filters=${encodedFilter}`);
};
```

**ReactSelect in Dialog (portal fix):**
```typescript
<ReactSelect
  menuPortalTarget={document.body}
  menuPosition="fixed"
  styles={{
    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  }}
/>
```

---

## 2026-01-09: Added PMO Executive Profile with Admin Access

**Commit:** `2372410d` - feat: added PMO Executive role and matched access with Admin role

### Summary
Added `Nirmaan PMO Executive Profile` as a new role that mirrors all access permissions of `Nirmaan Admin Profile` across the frontend.

### Files Modified (49 total)

**Core Infrastructure:**
- `src/utils/roleColors.ts` - Added PMO role with teal color scheme
- `src/utils/auth/ProtectedRoute.tsx` - Updated AdminRoute to include PMO

**Navigation & Layout:**
- `src/components/layout/NewSidebar.tsx` - 14 role checks updated for menu visibility
- `src/components/helpers/renderRightActionButton.tsx` - 3 role checks updated

**Dashboard & Role Selection:**
- `src/pages/dashboard.tsx` - PMO shows DefaultDashboard
- `src/components/updates/RoleSelector.tsx` - PMO can access role selector
- `src/components/updates/RoleDashboard.tsx` - PMO exempt from project requirement

**User Management (5 files):**
- `user-profile.tsx`, `EditUserForm.tsx`, `UserProfileActions.tsx`, `UserRowActions.tsx`, `UserProjectsTab.tsx`

**Financial Pages (8 files):**
- `AllPayments.tsx`, `RenderProjectPaymentsComponent.tsx`, `ProjectExpensesList.tsx`, `NonProjectExpensesPage.tsx`, `AllProjectInvoices.tsx`, `ProjectInvoiceTable.tsx`, `InFlowPayments.tsx`, `InvoiceReconciliationContainer.tsx`

**Procurement (7 files):**
- `procurement-requests.tsx`, `ApprovePRView.tsx`, `ItemSelectorControls.tsx`, `NewItemDialog.tsx`, `release-po-select.tsx`, `PODetails.tsx`, `POPaymentTermsCard.tsx`

**Service Requests (7 files):**
- `ServiceRequestsTabs.tsx`, `ApprovedSRView.tsx`, `SRPaymentsSection.tsx`, `approved-sr.tsx`, `select-service-vendor-list.tsx`, `sr-summary.tsx`, `new-service-request.tsx`

**Projects & Design (6 files):**
- `project.tsx`, `ProjectOverviewTab.tsx`, `ProjectWorkReportTab.tsx`, `CustomerPODeatilsCard.tsx`, `design-tracker-list.tsx`, `project-design-tracker-details.tsx`

**Reports & Other (8 files):**
- `ReportsContainer.tsx`, `useReportStore.ts`, `POVendorLedger.tsx`, `sent-back-request.tsx`, `item.tsx`, `itemsPage.tsx`, `pr-summary.tsx`

### Documentation Updated
- `.claude/context/role-access.md` - Added PMO to all access matrices
- `CLAUDE.md` - Updated Role-Based Access Control section (9 roles, PMO mirrors Admin)

### Pattern Used
```typescript
// Before
["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role)

// After
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
```

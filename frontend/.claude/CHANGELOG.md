# Claude Code Session Changelog

This file tracks significant changes made by Claude Code sessions.

---

## 2026-01-09: Header/Sidebar Alignment Fix & Mobile Menu

### Summary
Fixed visual misalignment between sidebar header and main layout topbar. Added minimal mobile menu trigger.

### Files Modified

**Sidebar Header (`src/components/layout/NewSidebar.tsx:603`):**
- Set fixed height `h-14 min-h-[56px]` matching main layout header
- Changed flex layout from `flex-col` to `flex-row items-center justify-between`
- Added `border-b border-border/40` for consistent border line
- Removed separate `<Separator />` component
- SidebarTrigger centers (`mx-auto`) when sidebar collapsed

**Main Layout (`src/components/layout/main-layout.tsx`):**
- Removed duplicate absolute-positioned mobile SidebarTrigger
- Added minimal inline mobile menu trigger (`w-5` width, `h-4 w-4` icon)
- Trigger only visible on mobile with muted styling

### Visual Result
- Sidebar and main layout header borders now align horizontally
- Mobile view has compact hamburger icon on left edge of topbar
- Cleaner visual separation between header and content

---

## 2026-01-09: Asset Management Module

### Summary
Complete frontend module for managing company assets including categories, asset master records, assignments, and declarations.

### Files Created

**Main Pages:**
- `src/pages/Assets/AssetsPage.tsx` - Main page with tabs:
  - Assets tab: Sub-tabs for All/Assigned/Unassigned/Pending Declaration
  - Categories tab: Manage asset categories
- `src/pages/Assets/AssetOverview.tsx` - Individual asset detail/edit page

**Components (`src/pages/Assets/components/`):**
- `AssetCategoriesList.tsx` - Category management table
- `AssetMasterList.tsx` - All assets table with filters
- `AssignedAssetsList.tsx` - Currently assigned assets view
- `UnassignedAssetsList.tsx` - Available assets view
- `PendingActionsList.tsx` - Assets pending declaration upload
- `AssetsSummaryCard.tsx` - Stats card showing asset counts
- `AddAssetCategoryDialog.tsx` - Create new category
- `AddAssetDialog.tsx` - Create new asset
- `AssignAssetDialog.tsx` - Assign asset to user
- `UnassignAssetDialog.tsx` - Remove assignment

**Constants:**
- `src/pages/Assets/assets.constants.ts` - Doctype names, field definitions, search configs

### Doctypes Used
- `Asset Category` - Asset classification
- `Asset Master` - Individual asset records
- `Asset Management` - Assignment records linking assets to users

### Routing
- `/asset-management` - Main assets page
- `/asset-management/:assetId` - Asset detail/overview page

### Access Control
- Sidebar: Admin, PMO Executive, HR Executive
- All actions require one of these roles

---

## 2026-01-09: Accountant Role Enhancements

### Summary
Fixed Accountant role unable to create Work Orders and created backend patch to remove project assignments from all Accountant users (giving them access to all projects).

### Backend Patch Created

**File:** `nirmaan_stack/patches/v2_8/remove_accountant_project_assignments.py`

Removes all project assignments from Accountant users:
- Deletes `User Permission` entries (Frappe built-in) for Projects
- Deletes `Nirmaan User Permissions` entries for Projects
- Sets `has_project = "false"` for all Accountant users

**Registered in:** `nirmaan_stack/patches.txt`

**Run with:** `bench --site localhost migrate`

### Frontend Bug Fix

**File:** `src/pages/ServiceRequests/service-request/new-service-request.tsx:128`

**Issue:** Accountant role was missing from the `handleSubmit()` role check array, causing silent failure when creating Work Orders.

**Fix:** Added `"Nirmaan Accountant Profile"` to allowed roles. Also removed `"Nirmaan Project Manager Profile"` (was inconsistent with role-access.md and button visibility).

**Before:**
```typescript
["Nirmaan Project Manager Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile",
 "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"]
```

**After:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile",
 "Nirmaan Project Lead Profile", "Nirmaan Accountant Profile"]
```

### Documentation Created

**File:** `.claude/context/_index.md` - Navigation index for frontend context files

---

## 2026-01-09: Added User Assets Tab with Assignment and Declaration Upload

### Summary
Enhanced user profile page with an "Assets" tab showing assigned assets. Admins (Admin/PMO/HR) can assign unassigned assets to users. Users can upload pending declaration documents for their own assets.

### Files Created

**New Components:**
- `src/pages/users/components/UserAssetsTab.tsx` - Displays user's assigned assets with:
  - Asset cards showing name, category, condition, serial number, assignment date
  - Declaration status (Pending/Uploaded) with upload/view actions
  - Assign Asset button (Admin/PMO/HR only)
  - Unassign button (Admin/PMO/HR only)

- `src/pages/users/components/AssignAssetToUserDialog.tsx` - Dialog for assigning assets:
  - Category dropdown filter
  - Asset dropdown (filtered to unassigned only)
  - Assignment date picker
  - Optional declaration file upload

### Files Modified

**User Profile:**
- `src/pages/users/user-profile.tsx`:
  - Added Assets tab (visible to all users with profile access)
  - Fetches Asset Management, Asset Master, Asset Category data
  - Tab layout: 2 cols for project-exempt roles, 3 cols for others

- `src/pages/users/components/UserOverviewTab.tsx`:
  - Added `assetCount` and `showAssetStats` props
  - "Assigned Assets" stat card shown when user has assets
  - Dynamic grid layout for 1-3 stat cards

- `src/pages/users/components/index.ts` - Exported new components

### Access Control

| Action | Admin/PMO/HR | Own Profile | Others |
|--------|:------------:|:-----------:|:------:|
| View Assets Tab | Yes | Yes | No |
| Assign Asset | Yes | No | No |
| Unassign Asset | Yes | No | No |
| Upload Declaration | Yes | Yes (own) | No |

### Key Patterns

**Asset Assignment Flow:**
```typescript
// 1. Create Asset Management record
await createDoc(ASSET_MANAGEMENT_DOCTYPE, {
  asset: selectedAsset,
  asset_assigned_to: userId,
  asset_assigned_on: date,
  asset_declaration_attachment: fileUrl,
});

// 2. Update Asset Master
await updateDoc(ASSET_MASTER_DOCTYPE, selectedAsset, {
  current_assignee: userId,
});
```

---

## 2026-01-09: Fixed Project Count for Own Profile and Hide for Exempt Roles

### Summary
Fixed bug where non-admin users couldn't see their assigned projects. Added logic to hide Projects tab/stats for roles that have access to all projects (no assignment required).

### Changes

**Bug Fix - Project Count:**
- Changed `permission_list` fetch condition from `isAdmin` to `(isAdmin || isOwnProfile)`
- Changed doctype from "User Permission" to "Nirmaan User Permissions"

**Hide Projects for Exempt Roles:**
- Added `PROJECT_EXEMPT_ROLES` constant (Admin, PMO, HR, Accountant, Estimates, Design Lead)
- Projects tab hidden for users with these roles
- "Assigned Projects" stat card hidden for exempt roles

---

## 2026-01-09: Restricted Users Page Access to Authorized Roles

### Summary
Added route-level access control to restrict `/users` and `/users/:userId` pages to Admin, PMO Executive, and HR Executive roles only. Non-authorized users can still access their own profile.

### Files Modified

**Route Guards:**
- `src/utils/auth/ProtectedRoute.tsx` - Added two new route guards:
  - `UsersRoute` - Restricts `/users` list to Admin, PMO, HR Executive
  - `UserProfileRoute` - Restricts `/users/:userId` to authorized roles OR own profile

**Routing:**
- `src/components/helpers/routesConfig.tsx` - Wrapped users routes with new guards

### Bug Fix: Own Profile Access for Non-Authorized Roles

**Issue:** Non-authorized users (e.g., Project Manager) could not access their own profile at `/users/:userId` even though `UserProfileRoute` allowed it.

**Root Cause:** `UserProfileRoute` was nested inside `UsersRoute`, so React Router evaluated `UsersRoute` first, which blocked non-authorized users before `UserProfileRoute` could check for own profile.

**Fix:** Restructured routes so `UserProfileRoute` is a sibling, not a child of `UsersRoute`:
```tsx
{
  path: "users",
  children: [
    // UsersRoute guards only list and new-user
    {
      element: <UsersRoute />,
      children: [
        { index: true, element: <Users /> },
        { path: "new-user", element: <UserForm /> },
      ],
    },
    // UserProfileRoute guards profile routes independently
    {
      path: ":userId",
      element: <UserProfileRoute />,
      children: [
        { index: true, element: <Profile /> },
        { path: "edit", element: <EditUserForm /> },
      ],
    },
  ],
}
```

### Access Control Pattern

```tsx
// UsersRoute - for /users list page
export const UsersRoute = () => {
  const { role, user_id } = useUserData()
  const canAccessUsers =
    role === "Nirmaan Admin Profile" ||
    role === "Nirmaan PMO Executive Profile" ||
    role === "Nirmaan HR Executive Profile" ||
    user_id === "Administrator"
  // ...
}

// UserProfileRoute - for /users/:userId profile page
export const UserProfileRoute = () => {
  const { role, user_id } = useUserData()
  const { userId } = useParams()
  const isAuthorizedRole = /* Admin, PMO, HR, Administrator */
  const isOwnProfile = user_id === userId
  if (isAuthorizedRole || isOwnProfile) return <Outlet />
  // ...
}
```

### Access Matrix

| Role | /users | Other's Profile | Own Profile |
|------|--------|-----------------|-------------|
| Admin/PMO/HR | ✅ | ✅ | ✅ |
| All other roles | ❌ | ❌ | ✅ |

---

## 2026-01-09: Enterprise Minimalist User Form Redesign

### Summary
Redesigned Create New User and Edit User forms with an enterprise minimalist aesthetic. Forms now feature Card containers, two-column grid layouts for name fields, cleaner labels, and placeholder-based hints instead of verbose descriptions.

### Files Modified

**User Forms:**
- `src/pages/users/user-form.tsx` - Complete redesign with:
  - Card wrapper with brand-gradient header
  - Two-column grid for First Name + Last Name
  - Organized sections: Personal Info, Contact, Access & Permissions
  - Smaller labels (`text-xs font-medium`)
  - Placeholders instead of FormDescription
  - Centered layout with max-width constraint

- `src/pages/users/EditUserForm.tsx` - Same redesign pattern with:
  - Clean header with title and description
  - Two-column grid for name fields
  - Lock icon indicator for disabled email field
  - Conditional role profile section
  - Bottom border separator for action buttons

### Design Patterns Applied

**Card Layout (Create Form):**
```tsx
<Card className="border shadow-sm">
  <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5">
    <CardTitle>Create New User</CardTitle>
    <CardDescription>Add a new team member</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter className="border-t bg-gray-50/50">...</CardFooter>
</Card>
```

**Two-Column Grid:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* First Name */}
  {/* Last Name */}
</div>
```

**Disabled Field with Lock Icon:**
```tsx
<div className="relative">
  <Input disabled className="bg-gray-50 pr-10" {...field} />
  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
</div>
```

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

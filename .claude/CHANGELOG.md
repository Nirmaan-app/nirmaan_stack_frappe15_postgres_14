# Changelog

Changes made by Claude Code sessions.

---

### 2026-01-09: Asset Management Frontend - Full UI Implementation

**Summary:** Built complete frontend for asset management including dashboard, asset lists, assignment workflow, and detail pages.

**Files Created (Frontend):**
- `frontend/src/pages/Assets/AssetsPage.tsx` - Main dashboard with tabs (Categories, All Assets, Assigned, Unassigned, Pending Declaration)
- `frontend/src/pages/Assets/AssetOverview.tsx` - Individual asset detail page with assignment controls
- `frontend/src/pages/Assets/assets.constants.ts` - Constants for asset conditions, doctypes, fields
- `frontend/src/pages/Assets/components/` - 10 component files:
  - `AddAssetDialog.tsx`, `AddAssetCategoryDialog.tsx` - Creation dialogs
  - `AssetCategoriesList.tsx`, `AssetMasterList.tsx` - Data table views
  - `AssignedAssetsList.tsx`, `UnassignedAssetsList.tsx`, `PendingActionsList.tsx` - Filtered asset views
  - `AssignAssetDialog.tsx`, `UnassignAssetDialog.tsx` - Assignment workflow dialogs
  - `AssetsSummaryCard.tsx` - Dashboard summary cards

**Files Modified:**
- `frontend/src/components/helpers/routesConfig.tsx` - Added `/asset-management` routes (avoiding Frappe's `/assets` static path)
- `frontend/src/components/layout/NewSidebar.tsx` - Added Assets menu item for Admin/HR/PMO roles
- `frontend/src/index.css` - Added `.scrollbar-hide` utility class

**Backend Field Added:**
- `nirmaan_stack/doctype/asset_master/asset_master.json` - Added `asset_value` (Currency) field

**Features:**
- Role-based access (Admin, HR, PMO get full CRUD; others read-only)
- IT credential visibility restricted to assigned user or admin roles
- Assignment workflow with declaration attachment upload
- Pending declaration tracking with upload action
- Responsive design with mobile-optimized views

---

### 2026-01-09: Asset Management - Security & Sync Improvements

**Summary:** Fixed security issues, added assignment sync, and improved field naming.

**Changes:**

1. **Security Fix** (Asset Master):
   - `asset_email_password` → Password fieldtype (encrypted)
   - `asset_pin` → Password fieldtype (encrypted)

2. **New Field** (Asset Master):
   - `current_assignee` (Link to Nirmaan Users, read-only) - Auto-synced from Asset Management

3. **Field Naming Fix** (Asset Management):
   - `asset_name` → `asset` (fieldname) with label "Asset"
   - `asset_assigned_to` label → "Assigned To"
   - Both fields now required and visible in list view

4. **Sync Hooks** (Asset Management):
   - `after_insert`: Sets `current_assignee` on Asset Master
   - `on_update`: Updates `current_assignee` on Asset Master
   - `on_trash`: Clears `current_assignee` on Asset Master

**Files Created:**
- `integrations/controllers/asset_management.py` - Sync hooks

**Files Modified:**
- `hooks.py` - Added Asset Management doc_events
- `asset_master.json` - Password fields, new current_assignee field
- `asset_management.json` - Fixed field naming, added required constraints

---

### 2026-01-09: Asset Management Doctypes - Permissions & Autoname

**Summary:** Added Nirmaan role permissions to all Asset doctypes and implemented custom autoname for Asset Master.

**Changes:**

1. **Role Permissions Added** (all 3 doctypes):
   - Full CRUD: System Manager, Nirmaan HR Executive, Nirmaan PMO Executive
   - Read-only: All other Nirmaan roles (Project Lead, Project Manager, Procurement Executive, Accountant, Estimates Executive, Design Lead, Design Executive)

2. **Asset Master Autoname**:
   - Format: `ASSET-<first 3 letters of category>-###`
   - Examples: `ASSET-LAP-001` (Laptop), `ASSET-MOB-001` (Mobile Phone)
   - Implemented in `asset_master.py` using `make_autoname()`

3. **Field Updates** (Asset Master):
   - `asset_name` - Now required, visible in list view
   - `asset_category` - Now required, visible in list view

---

### 2026-01-09: Asset Management Doctypes Added

**Summary:** Three new doctypes created for tracking company assets and their assignment to users.

**Doctypes Created:**
- `Asset Category` - Master list of asset categories (autonamed by `asset_category` field)
- `Asset Master` - Asset inventory with details, serial numbers, and IT credentials
- `Asset Management` - Tracks asset assignments to Nirmaan Users with declaration attachments

**Relationships:**
- Asset Master links to Asset Category
- Asset Management links to Asset Master and Nirmaan Users

---

### 2026-01-09: User Management Improvements

**Summary:** Added user creation and password reset APIs with graceful email failure handling. Improved error handling and logging throughout Nirmaan Users sync and lifecycle operations.

**Files Modified:**
- `api/users.py` - Added `create_user()` and `reset_password()` APIs
- `nirmaan_stack/doctype/nirmaan_users/nirmaan_users.py` - Improved sync logic with robust error handling
- `integrations/controllers/nirmaan_users.py` - Enhanced `on_trash` with granular error handling
- `frontend/src/hooks/useUserSubmitHandlers.ts` - Updated handlers for new APIs
- `frontend/src/pages/users/components/UserRowActions.tsx` - Updated password reset flow
- `frontend/src/pages/users/user-form.tsx` - Updated to use new create_user API

**Features:**
- Graceful email failure handling (user created even if welcome email fails)
- Detailed error logging for sync and email failures
- Defensive checks in on_trash for missing Frappe User
- User-friendly error messages for email configuration issues

---

### 2025-01-08: User Email Rename Feature

**Summary:** Added ability for admins to rename user email addresses with cascading updates across all linked records.

**Files Modified:**
- `api/users.py` - Added `rename_user_email()` API endpoint
- `integrations/controllers/nirmaan_users.py` - Added `after_rename()` hook
- `hooks.py` - Registered `after_rename` hook for Nirmaan Users
- `frontend/src/hooks/useUserSubmitHandlers.ts` - Added `handleRenameEmail()` handler
- `frontend/src/pages/users/user-profile.tsx` - Added Rename Email button and dialog

**Features:**
- Admin-only email rename with cascading updates
- Automatic Link field updates via Frappe's `rename_doc()`
- Manual update for Data fields (`Nirmaan User Permissions.user`)
- Force logout of renamed user
- PostgreSQL-compatible SQL queries

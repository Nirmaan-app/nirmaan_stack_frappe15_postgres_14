# Changelog

Changes made by Claude Code sessions.

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

# Changelog

Changes made by Claude Code sessions.

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

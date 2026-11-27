# User Management Domain

## Nirmaan Users Architecture

The `Nirmaan Users` doctype extends Frappe's core `User`:
- **Primary Key**: Email address (`name = email`)
- **Auto-sync**: Created automatically when Frappe User is created (via `after_insert` hook)
- **Special User**: "Administrator" exists with non-email name for system operations

---

## Renaming User Email

When changing a user's email (primary key), update in order:

1. **Frappe User doctype** - `rename_doc("User", old, new, force=True)`
2. **Nirmaan Users doctype** - `rename_doc("Nirmaan Users", old, new, force=True)`
3. **Nirmaan User Permissions.user** and **Asset History.assigned_to / done_by** (Data fields) - require manual SQL update (`services/asset_history.rename_person` for the history)
4. **Clear sessions** - force logout the renamed user

**API**: `nirmaan_stack.api.users.rename_user_email`

### PostgreSQL Reserved Keyword
The `user` column is reserved. Always use double quotes in raw SQL:
```python
frappe.db.sql('''
    UPDATE "tabNirmaan User Permissions"
    SET "user" = %s WHERE "user" = %s
''', (new_email, old_email))
```

---

## Deleting Nirmaan Users

**Cascade on delete** (`integrations/controllers/nirmaan_users.on_trash`):
- Deletes all `User Permission` records for the user
- Deletes all `Nirmaan Notifications` (both sender and recipient)
- Switches the person's Frappe `User` off and keeps it (`services/exited_employees.switch_off_login`): disabled,
  every role and the role profile removed, API key and secret cleared, sessions ended after commit. The person
  is now an *exited employee* (GLOSSARY.md). Deleting the User failed on its many links, and was swallowed.
- Creates audit record in `Nirmaan Versions`

**Does NOT delete**: PRs, POs, Comments (preserves audit trail with orphaned `owner`/`modified_by`)

---

## Admin Permission Check

`ADMIN_PROFILE` in `services/role_profiles.py` is the Admin profile alone. The Software Developer
(`DEVELOPER_PROFILE`, [ADR-0051](../../../docs/adr/0051-software-developer-profile-mirrors-admin.md)) is allowed
wherever Admin is, and every check names it beside Admin; `frontend/src/constants/roles.ts` mirrors both. Never
write either profile as an inline string, and never name Admin without the developer outside the guard's exception
list: `services/test_software_developer_profile.py` refuses both.

```python
from nirmaan_stack.services.role_profiles import (
    ADMIN_PROFILE, DEVELOPER_PROFILE, PMO_EXECUTIVE_PROFILE,
    has_role_profile, is_admin_profile, is_developer, is_developer_profile, is_nirmaan_admin,
)

is_nirmaan_admin(user) or is_developer(user)               # the Administrator user, an Admin or a developer
is_admin_profile(p) or is_developer_profile(p)             # for a profile string already in hand (no Administrator pass)
has_role_profile(user, (ADMIN_PROFILE, DEVELOPER_PROFILE, PMO_EXECUTIVE_PROFILE))   # a list: both, side by side
```

`is_nirmaan_admin` alone is the Administrator user or the Admin profile, and `is_admin_profile` alone the Admin
profile; each is on the guard's exception list only where it is defined.

Renaming a user's email (`api/users.rename_user_email`): the caller must be the Administrator user, an Admin or a
developer, and the person renamed must be neither (an Admin or Software Developer account is never renamed).

---

## Administrator User

Created in `install.py`:
- `name`: "Administrator" (not a valid email)
- `email`: "Administrator"
- `role_profile`: "Nirmaan Admin Profile"

**Important**: Block Administrator from rename/delete operations explicitly by name check.

---

## Related Doctypes

| Doctype | Purpose |
|---------|---------|
| `Nirmaan Users` | Extended user profiles with FCM tokens |
| `Nirmaan User Permissions` | Project-level permissions |
| `Nirmaan Notifications` | User notifications |

---

## Creating Users (Graceful Email Handling)

Use `nirmaan_stack.api.users.create_user` instead of direct Frappe User creation:

```python
# This API separates user creation from email sending
result = frappe.call("nirmaan_stack.api.users.create_user", {
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "mobile_no": "9999999999",
    "role_profile_name": "Nirmaan Project Lead Profile"
})
# Returns: { success, user, message, email_sent, email_error }
```

**Pattern:** Create user with `send_welcome_email=0` first, then attempt email in try/catch. User is created even if email fails.

---

## Password Reset (Safe API)

Use `nirmaan_stack.api.users.reset_password` for graceful email error handling:

```python
result = frappe.call("nirmaan_stack.api.users.reset_password", {
    "user": "john@example.com"
})
# Returns: { success, message, email_sent, email_error? }
```

User admins only (`services/role_profiles.USER_ADMIN_PROFILES`), as is `create_user`. Frappe makes and stores the
key (`User._reset_password`, hashed), so the link works; the link goes only to the user's inbox, never back to the
caller. Refused for Administrator and a switched-off login.

---

## User Sync Robustness

The `create_user_profile()` function has a fallback path:
1. **Primary insert**: All fields (first_name, last_name, full_name, email, mobile_no, role_profile)
2. **Fallback insert**: Minimal fields only (first_name, full_name, email)

This prevents orphaned Frappe Users without Nirmaan Users records.

---

## Deletion Edge Cases

The `on_trash` handler in `integrations/controllers/nirmaan_users.py`:
- Uses isolated try/catch for each deletion (User Permissions, Notifications)
- Switches the login off only when a Frappe User exists

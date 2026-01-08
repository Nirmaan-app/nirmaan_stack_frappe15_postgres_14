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
3. **Nirmaan User Permissions.user** (Data field) - requires manual SQL update
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
- Deletes the linked Frappe `User` document
- Creates audit record in `Nirmaan Versions`

**Does NOT delete**: PRs, POs, Comments (preserves audit trail with orphaned `owner`/`modified_by`)

---

## Admin Permission Check

Handle both system Administrator and Nirmaan Admin role:
```python
is_admin = current_user == "Administrator" or \
           frappe.get_value("Nirmaan Users", current_user, "role_profile") == "Nirmaan Admin Profile"
```

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

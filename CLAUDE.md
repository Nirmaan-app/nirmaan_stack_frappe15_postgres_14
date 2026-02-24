# CLAUDE.md - Nirmaan Stack Backend

## Project Overview

**Nirmaan Stack** is a construction project management and procurement ERP built on **Frappe Framework v15+** (Python). The backend handles business logic, data persistence, workflows, and APIs consumed by a React frontend.

**Core domains:** Procurement (PR/PO/RFQ), Projects, Financial Management, Vendors, Service Requests, Design Tracking, Inventory, Bulk PDF Download

---

## Tech Stack

- **Framework:** Frappe v15+ (Python 3.10+)
- **Database:** PostgreSQL v14.11 (NOT MariaDB)
- **Cache:** Redis
- **Frontend:** React 18 + TypeScript (in `frontend/` directory)
- **Real-time:** Socket.IO
- **Push notifications:** Firebase Cloud Messaging

---

## Quick Commands

**Site name:** `localhost`

```bash
# Start development server (from frappe-bench directory)
bench start
# Backend: http://localhost:8000 | Socket.IO: http://localhost:9000

# Database operations (use --site localhost)
bench --site localhost migrate    # Run migrations
bench --site localhost clear-cache # Clear Redis cache

# Development
bench new-doctype "Name"   # Create new doctype
bench build                # Rebuild assets
bench run-tests --app nirmaan_stack  # Run tests
```

---

## Directory Structure

```
nirmaan_stack/
├── nirmaan_stack/doctype/   # 84 custom doctypes
├── api/                      # Whitelisted API endpoints (35+ files)
├── integrations/
│   ├── controllers/          # Document lifecycle hooks (KEEP HOOKS HERE)
│   ├── firebase/             # FCM push notifications
│   └── Notifications/        # Notification system
├── tasks/                    # Scheduled background jobs
├── www/                      # Web routes (frontend.html, boot API)
├── hooks.py                  # App configuration
└── patches/                  # Database migrations (v1_5 - v3_0)
```

---

## Critical Patterns (MUST FOLLOW)

### Before Any Change
1. **Read `BACKEND_ARCHITECTURE.md`** - Complete doctype mappings, API docs, hooks
2. **Read `IMPROVEMENT_CHECKLIST.md`** - Refactoring priorities, architectural decisions
3. **Check existing patterns** - Follow established conventions

### Code Organization
- **API naming:** Use `snake_case` (NOT hyphens)
- **Lifecycle hooks:** Keep in `integrations/controllers/`, NOT in doctype files
- **Doctype files:** Only for `autoname`/basic `validate`
- **Large files:** Split files >500 lines into focused modules

### Data Patterns
- **Child Tables:** For queryable, relational data (items, payment terms)
- **JSON Fields:** For flexible, UI-driven data (categories, RFQ metadata)

---

## Common Gotchas

1. **PostgreSQL `user` keyword:** Always quote in SQL: `"user"` not `user`
2. **PostgreSQL JSON fields:** Cannot use `!=` or `is set` filters with JSON fields in `frappe.get_all()`. Use raw SQL: `WHERE json_field IS NOT NULL` with double-quoted table names (`"tabDoctype"`)
3. **Transactions:** Always `frappe.db.commit()` after DB operations in whitelisted methods
4. **Socket.IO:** Call `frappe.db.commit()` BEFORE `publish_realtime()` to avoid race conditions
5. **Administrator user:** Has non-email name "Administrator" - handle explicitly in rename/delete
6. **Link vs Data fields:** `rename_doc()` only updates Link fields, Data fields need manual SQL
7. **Email configuration:** User creation/password reset can fail due to email server misconfiguration (encryption key issues). Use `api/users.create_user` and `api/users.reset_password` which separate email sending from the critical operation
8. **Child table filtering:** `frappe.get_all()` and `useFrappeGetDocList` filter at PARENT document level. If ANY child row matches, ALL child rows from that parent are returned. For row-level filtering on child tables (e.g., "only show payment terms with status=Due"), use custom SQL APIs with JOINs. See `api/credits/get_credits_list.py` for the pattern.
9. **CEO Hold authorization:** The `ceo_hold_by` field on Projects tracks who set CEO Hold. Backend validation in `integrations/controllers/projects.py` (`validate` method) restricts setting/unsetting CEO Hold to `nitesh@nirmaan.app` only — not role-based.

---

## API Pattern

```python
@frappe.whitelist()
def method_name(param1, param2):
    # Business logic
    return {"status": "success", "data": {...}}
```

Frontend calls: `useFrappePostCall('nirmaan_stack.api.module.method')`

---

## Adding Document Lifecycle Hook

```python
# integrations/controllers/my_doctype.py
def after_insert(doc, method):
    pass

# hooks.py
doc_events = {
    "My Doctype": {
        "after_insert": "nirmaan_stack.integrations.controllers.my_doctype.after_insert"
    }
}
```

---

## Real-time Events

```python
frappe.publish_realtime(
    event="pr:new",
    message={...},
    user=user['name']
)
```

Event naming: `{doctype}:{action}` (e.g., `pr:approved`, `po:new`, `payment:fulfilled`)

---

## Reference Documentation

For detailed context, read these files when working on related tasks:

| Domain | File | When to Read |
|--------|------|--------------|
| **Doctypes** | `.claude/context/doctypes.md` | Creating/modifying doctypes |
| **APIs** | `.claude/context/apis.md` | Adding API endpoints |
| **Integrations** | `.claude/context/integrations.md` | Frontend-backend, Socket.IO, Firebase |
| **Workflows** | `.claude/context/workflows.md` | Business logic, auto-approval |
| **Patterns** | `.claude/context/patterns.md` | Code conventions, naming |
| **Procurement** | `.claude/context/domain/procurement.md` | PR/PO/RFQ work |
| **Service Requests** | `.claude/context/domain/service-requests.md` | Work Orders, finalization |
| **Projects** | `.claude/context/domain/projects.md` | Status lifecycle, effects |
| **Users** | `.claude/context/domain/users.md` | User management |

**Full index:** `.claude/context/_index.md`

---

## Changelog

See `.claude/CHANGELOG.md` for changes made by Claude Code sessions.

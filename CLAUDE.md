# CLAUDE.md - Nirmaan Stack Backend

## Project Overview

**Nirmaan Stack** is a construction project management and procurement ERP built on **Frappe Framework v15+** (Python). The backend handles business logic, data persistence, workflows, and APIs consumed by a React frontend.

**Core domains:** Procurement (PR/PO/RFQ), Projects, Financial Management, Vendors, Service Requests

---

## Tech Stack

- **Framework:** Frappe v15+ (Python 3.10+)
- **Database:** MariaDB/PostgreSQL
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
├── nirmaan_stack/doctype/   # 60 custom doctypes
├── api/                      # Whitelisted API endpoints (30+ files)
├── integrations/
│   ├── controllers/          # Document lifecycle hooks (KEEP HOOKS HERE)
│   ├── firebase/             # FCM push notifications
│   └── Notifications/        # Notification system
├── tasks/                    # Scheduled background jobs
├── www/                      # Web routes (frontend.html, boot API)
├── hooks.py                  # App configuration
└── patches/                  # Database migrations (v1_5 - v2_7)
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
2. **Transactions:** Always `frappe.db.commit()` after DB operations in whitelisted methods
3. **Socket.IO:** Call `frappe.db.commit()` BEFORE `publish_realtime()` to avoid race conditions
4. **Administrator user:** Has non-email name "Administrator" - handle explicitly in rename/delete
5. **Link vs Data fields:** `rename_doc()` only updates Link fields, Data fields need manual SQL
6. **Email configuration:** User creation/password reset can fail due to email server misconfiguration (encryption key issues). Use `api/users.create_user` and `api/users.reset_password` which separate email sending from the critical operation

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
| **Users** | `.claude/context/domain/users.md` | User management |

**Full index:** `.claude/context/_index.md`

---

## Changelog

See `.claude/CHANGELOG.md` for changes made by Claude Code sessions.

# Code Patterns & Conventions

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Doctypes | CamelCase with spaces | `Procurement Requests` |
| Python modules | snake_case | `procurement_requests.py` |
| API methods | snake_case | `new_custom_pr` |
| API files | snake_case (not hyphens) | `custom_pr_api.py` |

---

## File Organization

### Doctype Controller Structure
```
nirmaan_stack/doctype/procurement_requests/
  ├── procurement_requests.json        # Schema definition
  ├── procurement_requests.py          # Controller class (optional)
  ├── procurement_requests.js          # Client-side hooks (optional)
  └── test_procurement_requests.py     # Unit tests (optional)
```

### Controller Methods
- `validate()` - Pre-save validation
- `before_insert()`, `after_insert()` - Insert hooks
- `on_update()`, `before_save()` - Update hooks
- `on_trash()`, `after_delete()` - Delete hooks

---

## Architectural Patterns

### Lifecycle Hooks Location
- **Keep in:** `integrations/controllers/`
- **Doctype files:** Only for `autoname`/basic `validate`
- **Known exception:** `Items.on_update()` in `doctype/items/items.py` syncs item changes to `TDS Repository`. This lives in the doctype file because it's tightly coupled to the Items schema and only targets one downstream doctype.

### Large Files
- Split files >500 lines into focused modules

### Shared Logic
- Use base controllers for PR/PO/SR common patterns

---

## Data Storage Patterns

### Hybrid Approach
- **Child Tables:** Structured, queryable data (items, payment terms)
- **JSON Fields:** Flexible, UI-driven data (categories, RFQ metadata)

### Migration Note
Old PRs had `procurement_list` (JSON) → migrated to `order_list` (child table)

---

## Permissions Model

1. **Frappe Roles:** Standard RBAC
2. **Custom Permissions:** `Nirmaan User Permissions` for project-level isolation
3. **Document-Level:** Workflow states control actions

---

## Error Handling

```python
# User-facing errors
frappe.throw("Error message")

# Logging
frappe.log_error("Error details")

# Transactions
frappe.db.begin()
try:
    # operations
    frappe.db.commit()
except:
    frappe.db.rollback()
    raise
```

---

## Real-time Event Publishing

```python
frappe.publish_realtime(
    event="custom:event_name",
    message={"data": "value"},
    user=user_id  # Optional: target specific user
)
```

Frontend listens via Socket.IO in `SocketInitializer.tsx`

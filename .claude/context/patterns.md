# Code Patterns & Conventions

Code examples and reference snippets. The rules themselves (naming, where code goes, lifecycle-hook placement, file size, child tables vs JSON) live in root `CODING_STANDARDS.md`.

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

### Shared Logic
- Use base controllers for PR/PO/SR common patterns

---

## Data Storage Patterns

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

---

## Print Formats (PDF)

### Landscape orientation (Frappe ≥ 15.115)
Frappe commit `8744b8004d` (2026-04-22, "disable meta tag parsing in pdfkit") ignores every `<meta name="pdfkit-*">`
tag, so `<meta name="pdfkit-orientation" content="Landscape"/>` no longer does anything and the PDF comes out portrait.
wkhtmltopdf never honoured `@page { size: A4 landscape }` either. Set orientation in a `<style>` tag instead:

```html
<style>.print-format { orientation: Landscape; }</style>
```

- It must be a plain top-level `.print-format { … }` rule. A rule inside `@media print` or a selector like `.print-format p` is skipped.
  `read_options_from_html` in `frappe/utils/pdf.py` reads only `orientation`, `margin-*`, `page-size`,
  `page-width`/`page-height` and `header-spacing` from it.
- From Python you can instead pass `frappe.get_print(..., as_pdf=True, pdf_options={"orientation": "Landscape"})`.
- Landscape formats currently: `Overall Milestones Report` (the DPR "All Zones 14 Days" download) and
  `LSProject Commission Report - Filled Task`.
- `Print Format` is an unfiltered fixture. Edit in Desk, export fixtures, then commit `fixtures/print_format.json`.
  A DB-only edit is reverted by the next `bench migrate`.

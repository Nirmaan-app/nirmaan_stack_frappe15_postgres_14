# API Reference

Backend API endpoints in `nirmaan_stack/api/`.

## Procurement APIs

| File | Methods | Purpose |
|------|---------|---------|
| `custom_pr_api.py` | `new_custom_pr()`, `resolve_custom_pr()` | Custom PR creation and resolution |
| `pr_editing_lock.py` | `acquire_lock()`, `release_lock()`, `check_lock()`, `extend_lock()` | Redis-based concurrent edit prevention |
| `approve_vendor_quotes.py` | `generate_pos_from_selection()` | PO generation from selected quotes |
| `send_vendor_quotes.py` | - | RFQ distribution to vendors |
| `approve_reject_sb_vendor_quotes.py` | - | Sent-back quote handling |
| `reject_vendor_quotes.py` | - | Quote rejection logic |
| `approve_amend_po.py` | - | PO amendment approval |
| `handle_cancel_po.py` | - | PO cancellation |
| `po_merge_and_unmerge.py` | - | PO consolidation |
| `procurement_orders.py` | - | PO helper methods |

## Data & Reporting APIs

| File | Purpose |
|------|---------|
| `data-table.py` (55KB) | Data aggregation for frontend tables |
| `sidebar_counts.py` | Badge counts for navigation |
| `get_project_reports.py` | Report generation |

## Domain-Specific APIs

### Projects (`api/projects/`)
- `new_project.py` - Project creation
- `add_customer_po.py` - Customer PO linking
- `project_aggregates.py` - Financial aggregations
- `project_wise_invoice_data.py` - Invoice analytics

### PO Delivery Documents (`api/po_delivery_documentss.py`)
- `create_po_delivery_documents()` - Create DC/MIR record with file upload and item quantities
- `get_po_delivery_documents()` - Get delivery docs for a specific PO (enriched with child items and attachment URLs)
- `update_po_delivery_documents()` - Update existing DC/MIR record
- `get_project_po_delivery_documents()` - Get all delivery docs for a project
- `get_all_delivery_documents()` - Get all delivery docs (for reports, with filters)
- Shared `_enrich_delivery_docs()` helper batch-fetches child items and attachment URLs (avoids N+1 queries)

### Other Domains
- `invoices/` - Invoice data APIs (PO-wise, SR-wise)
- `payments/` - Payment processing
- `delivery_notes/` - Delivery note updates
- `vendor/` - Vendor-specific data (POs, invoices)
- `customers/` - Customer financials
- `target_rates/` - Historical rate lookups

### Master Data
- `create_vendor_and_address.py` - Vendor onboarding
- `bank_details.py` - Banking utilities
- `users.py` - User management (rename, etc.)

---

## API Pattern

```python
@frappe.whitelist()
def method_name(param1, param2):
    # Validate inputs
    # Business logic
    return {"status": "success", "data": {...}}
```

### Common Patterns

1. **JSON parameter handling** - Accept both string and parsed
2. **Transaction management** - `frappe.db.begin()`, `frappe.db.commit()`, rollback on error
3. **Permission bypass** - `ignore_permissions=True` when needed
4. **Error logging** - `frappe.log_error()`
5. **Standardized response** - `{"status": "success/error", "data": {...}}`

### Frontend Consumption

```typescript
// Via frappe-react-sdk
useFrappePostCall('nirmaan_stack.api.my_endpoint.my_method')
useFrappeGetCall('nirmaan_stack.api.my_endpoint.my_method')
```

---

## Adding New API Endpoint

1. Create Python file in `api/` directory:
```python
# api/my_endpoint.py
import frappe

@frappe.whitelist()
def my_method(param1, param2):
    # Validate inputs
    # Business logic
    return {"status": "success", "data": {...}}
```

2. Organize by domain - create subdirectory if needed
3. Use snake_case for method names (not hyphens)

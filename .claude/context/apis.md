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
| `data-table.py` (55KB, legacy hyphenated name) | Data aggregation for frontend tables |
| `data_table/` (new module) | Refactored data aggregation: `search.py`, `facets.py`, `aggregations.py`, `utils.py` |
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

### Bulk PDF Download (`api/pdf_helper/`)
- `bulk_download.py` - Unified bulk download for POs, WOs, Invoices, DCs, MIRs, DNs
  - Supports vendor/date filtering, progress tracking, rate selection
  - Filters POs by Delivered/Partially Delivered status
  - Restricts PO rate visibility for Project Managers
  - Fetches only approved invoice attachments for invoice downloads
- `pdf_merger_api.py` - PDF merge utility with progress percentage tracking
- `po_print.py` - PO print format generation
- `print_integration.py` - Print format integration utilities

### Remaining Items / Inventory (`api/remaining_items_report.py`)
- `create_remaining_items_report()` - Create inventory snapshot with item quantities
- `get_remaining_items_report()` - Fetch report with eligible items
- Cooldown enforcement (prevents rapid successive reports)
- Declaration acceptance required before submission

### Design Tracker (`api/design_tracker/`)
- `get_task_wise_list.py` - Task-centric queries with designer/status/phase filtering
- `get_team_summary.py` - Designer performance metrics with unassigned task tracking
- `generate_handover_tasks.py` - Generate handover phase tasks, preserving Not Applicable status

### TDS (`api/tds/`)
- `tds_report.py` - TDS report generation with progressive PDF percentage tracking

### Other Domains
- `invoices/` - Invoice data APIs (PO-wise, SR-wise)
- `payments/` - Payment processing
- `delivery_notes/` - Delivery note updates (includes `uploaded_by` validation for Administrator)
- `vendor/` - Vendor-specific data (POs, invoices)
- `customers/` - Customer financials
- `target_rates/` - Historical rate lookups
- `data_table/search.py` - Data aggregation (sorting support prepared but not yet enabled; requires explicit field selection)

### Master Data
- `create_vendor_and_address.py` - Vendor onboarding
- `bank_details.py` - Banking utilities
- `users.py` - User management (rename, etc.)
- `items.py` - Items doctype with `on_update` hook syncing item_name and category to TDS Repository

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

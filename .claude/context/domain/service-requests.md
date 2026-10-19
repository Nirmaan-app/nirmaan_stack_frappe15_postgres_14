# Service Requests (Work Orders)

Service Requests are called "Work Orders" in the UI. They represent service-based procurement (vs. item-based Purchase Orders).

## Load-bearing invariants

- **`amount_paid` / `amount_due` are recounted by the system, never typed (ADR-0034).** `amount_paid` = the WO's
  *Paid* Project Payments plus the TDS withheld from the vendor on them, less its *Received* Vendor Refunds
  (ADR-0034 Amendment A, #1509; tax the company paid on top is not part of it); `amount_due` =
  `total_amount - amount_paid`. The tax by who bore it has one source, `payment_tds.borne_tds_by_order_sql`;
  never add `total_tds` onto `amount_paid` (ratchet `p1_tds_added_to_amount_paid`). Who bore each deduction is
  its stored `Payment TDS Deduction.borne_by`, set once when it is created; the WO's categories (Misc/Transport
  only) decide only that creation, never a reader, so a Misc/Transport WO paid net of TDS before 2026-09-17
  still counts it as paid and a later category change moves nothing (`payment-tds.md` § Company-borne). The
  request caps and the WO page's Amount Paid hover read the same field. The watched fields that
  recount them (a payment's `status`, `amount`, `document_type`, `document_name`, both the WO it leaves and the
  one it joins; a refund's) and the judge `services/amount_paid_drift.mismatches` are in `procurement.md`
  § Load-bearing invariants, shared with POs.
- **A new WO payment passes the invoice check (#1488, GLOSSARY *Invoice check*).** Raised (every payment not
  Rejected, base and GST, gross of vendor-borne TDS) − `amount_invoiced` must be < ₹100, measured BEFORE the new
  payment. It lives in the pure `services/work_order_payment_limit` (`invoice_check`, `request_refusal`) and is
  enforced where the WO limit is: `create_payment_request_for_service` and the Project Payments insert
  validation (the Accountant's paid entry, Desk, REST), as the session user. An L1 approver or the CEO skips it
  (`order_payments.skips_invoice_check`, via `approval_raiser.raiser_level`); split leftovers and adjustments
  skip it with the limit. The same check refuses a negative WO payment for everyone (refunds are Vendor
  Refunds). `get_payment_summary` returns it as `limit.invoice_check` with `skipped` for the viewer.

## Doctype: Service Requests

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | Select | Pending, Approved, Rejected, Cancelled |
| `is_finalized` | Check | Locks the SR from editing/deletion |
| `finalized_by` | Data | Full name (not email) of who finalized |
| `finalized_on` | Datetime | When finalized |
| `total_amount` | Currency | Total service amount |
| `amount_paid` | Currency | Paid payments less Received refunds (system-recounted, see above) |

### Finalization Workflow

Approved SRs can be "finalized" to lock them from further modifications.

**Finalize locks:**
- Amend action
- Delete action
- Edit Terms & Notes

**Permission Model:**
```
Finalize: Admin, PMO, PL, Procurement Executive, OR owner
Revert:   Admin, PMO, PL, Procurement Executive only
```

**Admin roles constant (in sr_finalize.py):**
```python
ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
]
```

## SR Remarks (Comments)

SR remarks reuse the `Nirmaan Comments` doctype with specific field values.

### Comment Structure

```python
Nirmaan Comments:
  comment_type: "sr_remark"
  reference_doctype: "Service Requests"
  reference_name: <SR ID>
  subject: "accountant_remark" | "procurement_remark" | "admin_remark"
  content: <remark text>
  comment_by: <user email>
  is_system_generated: 0 | 1  # System comments are undeletable
```

### Subject Mapping by Role

```python
ROLE_SUBJECT_MAP = {
    "Nirmaan Accountant Profile": "accountant_remark",
    "Nirmaan Procurement Executive Profile": "procurement_remark",
    "Nirmaan Admin Profile": "admin_remark",
    "Nirmaan PMO Executive Profile": "admin_remark",
    "Nirmaan Project Lead Profile": "admin_remark",
    "Nirmaan Project Manager Profile": "admin_remark",
}
```

### System-Generated Comments

Finalization and revert actions create system-generated audit comments:
- `is_system_generated = 1`
- Cannot be deleted by anyone (backend blocks, frontend hides delete button)
- Shows "Auto" badge in UI

**Comment templates:**
- Finalize: "This Work Order was finalized by {name} on {date}"
- Revert: "Finalization was reverted by {name} on {date}"

## API Endpoints

### sr_finalize.py

| Endpoint | Description |
|----------|-------------|
| `finalize_sr(sr_id)` | Finalize an approved SR |
| `revert_finalize_sr(sr_id)` | Revert finalization (admin only) |
| `check_finalize_permissions(sr_id)` | Check what actions user can perform |

### sr_remarks.py

| Endpoint | Description |
|----------|-------------|
| `add_sr_remark(sr_id, content)` | Add remark (subject auto-determined) |
| `get_sr_remarks(sr_id, subject_filter)` | Get remarks with counts |
| `delete_sr_remark(remark_id)` | Delete own remark (blocks system comments) |
| `get_sr_remarks_count(sr_id)` | Lightweight count for tables |
| `get_sr_recent_remarks(sr_id, limit)` | Recent remarks for hover cards |

## Frontend Components

### Hooks

- `useSRFinalize.ts` - `useSRFinalizePermissions()`, `useFinalizeSR()`, `useRevertFinalizeSR()`
- `useSRRemarks.ts` - `useSRRemarks()`, `useAddSRRemark()`, `useDeleteSRRemark()`

### Components

- `SRFinalizeDialog.tsx` - Confirmation dialogs for finalize/revert
- `SRComments.tsx` - Full remarks section with filters and "Auto" badge
- `SRDetailsCard.tsx` - Shows finalization status

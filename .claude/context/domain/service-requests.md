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
- **Who may decide or edit a WO invoice is checked on the server (#1531, ADR-0014 Amendment A).** Approve or
  reject: the invoice-approval roles; edit number, date or amounts: Accountants and Admin; once *Approved*, only
  Admin may change them, and anyone else rejects it (an Approved WO invoice may be rejected) and uploads it
  again. Uploading is not narrowed. The role sets are `role_profiles.WO_INVOICE_DECIDE_PROFILES` /
  `WO_INVOICE_EDIT_PROFILES` / `WO_APPROVED_INVOICE_EDIT_PROFILES`; the rule is the pure
  `services/work_order_invoice_access.change_problem`, applied by the Vendor Invoices `validate` hook
  (`controllers/vendor_invoices.guard_work_order_invoice`), so Desk and REST obey it. Any new path that writes
  a WO Vendor Invoice (the generated-invoice upload, #1547) runs as the session user and passes through it.
  PO invoices keep their old rules.
- **WO status-move rules live in one place, `services/work_order_lifecycle.change_problem` (#1529).** The
  Service Requests `validate` hook `controllers/service_requests.guard_lifecycle` applies it on every save,
  so the SPA, Desk and REST obey it. A save that moves the status INTO *Approved* or *Rejected* (approve,
  reject, accept or revert an amendment, or a new WO saved straight as Approved) takes
  `role_profiles.WO_DECIDE_PROFILES` (Admin, Project Lead; mirrored by `SR_ADMIN_ROLES` in
  `frontend/src/pages/ServiceRequests/config/srTabs.constants.ts`). Amend itself (Approved -> Amendment) is open
  to every WO writer. A new status-move or lock rule (Finalize #1539, amendments #1540) goes into the same
  function, never into a screen or an endpoint alone. PMO Executive writes and deletes WOs through the patch
  `v3_0.pmo_write_on_work_orders` (Custom DocPerm, so it survives a JSON re-import), but never approves.
- **A WO's remarks and items are read only by someone who may read that WO (#1529).** Every `api/sr_remarks`
  read/add call starts with `assert_can_read_work_order` (doc read permission, project User Permissions
  included); `api/sr_items.get_sr_items_for_parents` returns only readable WOs, with or without names.

- **The GST flag (`gst`) follows the vendor and is never written by hand (ADR-0028 Amendment A, #1538).**
  Its writers: `ServiceRequests.set_gst_from_vendor` (first approval; an accepted amendment whose vendor differs
  from the one before it, read from Version rows by `services/work_order_amendment.vendor_before_amendment`) and
  `api/service_requests/match_gst_to_vendor` (Admin / Accountants, Approved WOs, Finalized included). Each sets
  `doc.flags.gst_set_from_vendor`; any other save that changes `gst` is refused by
  `controllers/service_requests.validate_gst_flag_not_changed_by_hand`. A new server writer must set that flag
  and save the document (never `set_value`), so `on_update` recounts `total_amount` / `amount_due` and the GST
  payment guard runs. The rule is the pure `work_order_gst.gst_flag_for_vendor` (frontend twin
  `utils/workOrderGst.gstForVendor`). Remove GST Hold writes no WO. First approval also fills a blank
  `project_gst` from the project (`ServiceRequests.fill_project_gst_on_approval`).

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

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
- **A generated invoice is a record, numbered and limited by the server, never edited (#1546, GLOSSARY
  *Generated invoice*, *RA number*).** Doctype `WO Generated Invoice`, named `WGI-<WO>-<RA number>` (so the pair
  is unique in the primary key). Made only by `api/service_requests/generated_invoices.generate_invoice`
  (the doc's `before_insert` refuses any insert without `flags.made_by_generate`), changed only by the moves in
  `services/wo_generated_invoices.MOVES` (`change_problem`, run by the doc's `validate`), never deleted
  (`on_trash`). Generate runs under `_billing_lock`, a session-level advisory lock followed by a commit: Frappe
  runs PostgreSQL at REPEATABLE READ, so a row lock alone left a waiting generate reading the old highest RA
  number (the concurrency test caught it). Generate and void commit. The limit counts Pending + Approved Vendor
  Invoices and generated invoices at *Generated*; a *Signed* one is counted through the Pending invoice its
  upload creates, so #1547 must create that invoice in the same save that moves the record to *Signed*. Only an
  Approved WO with `gst` explicitly off (`work_order_gst.gst_is_explicitly_off`; blank is not off) and a
  Nirmaan GST is billed. The print is the "WO Generated Invoice" print format, which reads the record; the old
  "SR Invoice" format, which read the amount from the link, is disabled (patch
  `v3_0.disable_sr_invoice_print_format`, because a Print Format fixture re-import keeps the site's `disabled`).
  Roles: `role_profiles.WO_GENERATED_INVOICE_PROFILES`.
- **A generated invoice's signed upload is its one Vendor Invoice, and that invoice's decision moves it (#1547).**
  `generated_invoices.upload_signed_copy`, under `_billing_lock`, makes the scan's Nirmaan Attachments row and a
  *Pending* Vendor Invoice (the record's number, date and amount; base = amount, GST = 0; no auto-approval) and
  moves the record to *Signed* in one commit; only a *Generated* record is uploaded. Accountants who can see the
  project (a Projects User Permission on it, or none at all, as most have) get a `wo_invoice:signed_uploaded`
  notification after the commit; `pr_notifications.get_allowed_accountants` would miss the unrestricted ones. The Vendor Invoices `on_update` hook
  `controllers/vendor_invoices.follow_generated_invoice` moves the record (approved: *Approved*; rejected, even
  after approval: *Voided*, the rejection as its reason; `wo_generated_invoices.vendor_invoice_move`), so the
  single, bulk and Desk approvals all move it. That Vendor Invoice is never deleted (`on_trash`
  `refuse_deleting_generated_invoice`; `delete_invoice_entry` answers it first): reject it instead.
- **WO status-move rules live in one place, `services/work_order_lifecycle.change_problem` (#1529).** The
  Service Requests `validate` hook `controllers/service_requests.guard_lifecycle` applies it on every save,
  so the SPA, Desk and REST obey it. A save that moves the status INTO *Approved* or *Rejected* (approve,
  reject, accept or revert an amendment, or a new WO saved straight as Approved) takes
  `role_profiles.WO_DECIDE_PROFILES` (Admin, Project Lead; mirrored by `SR_ADMIN_ROLES` in
  `frontend/src/pages/ServiceRequests/config/srTabs.constants.ts`). Amend itself (Approved -> Amendment) is open
  to every WO writer. A new status-move or lock rule (Finalize #1539, amendments #1540) goes into the same
  function, never into a screen or an endpoint alone. PMO Executive writes and deletes WOs through the patch
  `v3_0.pmo_write_on_work_orders` (Custom DocPerm, so it survives a JSON re-import), but never approves.
- **A WO's approval date is `approved_on` / `approved_by`, never `modified` (#1532).** The save that approves
  it (`work_order_lifecycle.is_approval`: into Approved from anything but Amendment) stamps them; every other
  save carries the stored values over, whatever it sends (`approval_record`, from `ServiceRequests.validate`).
  Accepting or reverting an amendment keeps the first approval. `approved_by` is the user id as Data, not a
  Link, so it never blocks deleting that user. Old WOs were filled from Version rows by the patch
  `v3_0.backfill_work_order_approval` (blanks only); one created straight as Approved has no history and
  stays blank, and the WO page then shows "--".
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
- **A Finalized WO's scope is locked on the server, for everyone, Admin included (#1539).** The same
  `work_order_lifecycle.change_problem` refuses a save of a Finalized WO that changes `LOCKED_FIELDS`
  (status, so Amend; vendor, project, `gst`, `notes` (terms), `work_order_items`, `service_order_list`,
  `service_category_list`, `total_amount`), and `delete_problem`, run first in `on_trash`
  (`controllers/service_requests.guard_delete`), refuses its delete before anything is cleared. Both refuse with
  `FINALIZED_REFUSAL`, the text the WO page's banner shows word for word
  (`frontend/src/pages/ServiceRequests/config/finalizedLock.ts`, pinned by `services/test_work_order_lifecycle`).
  Everything else stays open: payments and the figures they recount, invoices, remarks, `project_gst`, the PDF,
  Generate invoice. The one `gst` change let through is `flags.gst_set_from_vendor` (Match GST to vendor).
  `is_finalized` moves only in a save carrying `flags.finalize_action`, set by `api/sr_finalize` (Finalize and
  Revert Finalization, which write the audit remark); `is_finalized` and `total_amount` are read-only in Desk.
  The comparison ignores how Desk sends a value (JSON as text, int vs float, a row's own name and timestamps),
  so a Desk save that leaves the scope alone passes.
- **An amendment is held to its rules on the server (#1540, GLOSSARY *Amendment (of a Work Order)*).** The
  same `work_order_lifecycle.change_problem` checks every amendment save (`is_amendment_save`: Approved ->
  Amendment, Amendment -> Amendment, Amendment -> Approved) against `AmendmentFacts`, which
  `controllers/service_requests.amendment_facts` reads from the database: Amend waits while a payment is
  neither Paid nor Rejected (listed); no amendment save lowers the total below the stored `amount_paid` or
  `amount_invoiced` (the stored `total_amount` is recomputed only at the decision, so until then it is the
  total from before the amendment; a save that does not lower it is never refused, so a revert passes); the
  vendor stays the one before the amendment (`work_order_amendment.vendor_before_amendment`) once a payment
  not Rejected, a Vendor Invoice not Rejected or a WO Generated Invoice not Voided exists; a vendor on GST Hold
  is not swapped in. A new payment on a WO in Amendment is refused on insert
  (`controllers/project_payments.refuse_while_work_order_under_amendment`, rule `payment_request_problem`).
  The snapshot (Nirmaan Versions, `new_state` Amendment, copied from the amend save's Version by
  `controllers/nirmaan_versions`) is never deleted: the deciding save marks every undecided one with
  `outcome` Accepted or Reverted (`ServiceRequests.name_amendment_outcome` -> `flags.amendment_outcome`, then
  `work_order_amendment.mark_snapshots` in `on_update`). Revert is `api/service_requests/amendment.revert_amendment`
  (the user's own save, so the decide rule applies), which writes back items, vendor, categories and
  `project_gst` from the snapshot (`pre_amendment_values`); a plain Amendment -> Approved save is an accept.
  Snapshots exist only for saves that leave a Version: in tests pass `ignore_version=False` on the amend save.
  The amend reason is the Nirmaan Comments row with subject "amending approved work order".

## Doctype: Service Requests

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | Select | Pending, Approved, Rejected, Cancelled |
| `is_finalized` | Check | Locks the SR from editing/deletion |
| `finalized_by` | Data | Full name (not email) of who finalized |
| `finalized_on` | Datetime | When finalized |
| `approved_on` | Datetime | First approval (read-only; never moved after, #1532) |
| `approved_by` | Data | User id (email) of the first approver (read-only) |
| `total_amount` | Currency | Total service amount |
| `amount_paid` | Currency | Paid payments less Received refunds (system-recounted, see above) |

### Finalization Workflow

Approved SRs can be "finalized" to lock them from further modifications.

**Finalize locks** (on the server, see Load-bearing invariants; the page hides the buttons and shows a banner):
- Amend, Delete, Edit Terms
- The GST flag (except Match GST to vendor), items, categories, vendor and total, Desk included

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

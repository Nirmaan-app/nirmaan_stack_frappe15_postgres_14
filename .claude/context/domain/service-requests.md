# Service Requests (Work Orders)

Service Requests are called "Work Orders" in the UI. They represent service-based procurement (vs. item-based Purchase Orders).

## Doctype: Service Requests

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | Select | Pending, Approved, Rejected, Cancelled |
| `is_finalized` | Check | Locks the SR from editing/deletion |
| `finalized_by` | Data | Full name (not email) of who finalized |
| `finalized_on` | Datetime | When finalized |
| `total_amount` | Currency | Total service amount |
| `amount_paid` | Currency | Amount paid so far |

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

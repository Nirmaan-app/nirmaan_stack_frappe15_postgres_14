# Business Logic & Workflows

## Auto-Approval Algorithm

**File:** `integrations/controllers/procurement_requests.py`

### Logic
1. **Immediate Auto-Approve:** If total PR value < ₹5,000
2. **Conditional Auto-Approve (with vendors selected):**
   - If total PO value < ₹20,000
   - AND it's not the 8th consecutive auto-approval
   - → Auto-approve AND generate PO
   - Counter resets after 8th approval (forces manual review)

---

## Historical Rate Calculation

**File:** `populate_target_rates.py`

### Algorithm
1. Fetch approved quotations per item-unit combination
2. **Single quote in last 3 months:** Use that rate
3. **Multiple quotes in last 3 months:** Weighted average by quantity
4. **No recent quotes:** Use latest historical quote
5. Creates `Target Rates` records for frontend reference
6. Runs daily via scheduler

---

## PR Workflow States

```
Pending → Approved → Vendor Selected → Vendor Approved → Closed
              ↓
         Rejected / Cancelled / Partially Approved
```

### Controlled By
- Frappe Workflow engine (configured in fixtures)
- Custom Python logic in `integrations/controllers/`
- Auto-transitions based on business rules

---

## Document Lifecycle Events (hooks.py)

### Event Handler Pattern
```python
"Procurement Requests": {
    "after_insert": "...controllers.procurement_requests.after_insert",
    "on_update": "...controllers.procurement_requests.on_update",
    "on_trash": [...],
    "after_delete": "...controllers.procurement_requests.after_delete"
}
```

### What Gets Triggered
- **User Creation**: Auto-create `Nirmaan Users` profile
- **Project Creation**: Auto-generate work milestones and permissions
- **Vendor Changes**: Auto-generate vendor categories
- **PR/PO/SR Lifecycle**: State management + versioning
- **Versioning**: Amendment tracking for all major documents
- **Items on_update**: Syncs `item_name` and `category` to TDS Repository entries (added v3.0)
- **Design Tracker Tasks**: Auto-sets `last_submitted` date on status change; validates approval proof for Approved status

---

## Scheduled Background Jobs

### Daily Cron Jobs
- `populate_target_rates_by_unit()` - Calculate historical rate benchmarks
- `update_item_status()` - Sync item statuses

### Adding Scheduled Task
```python
# tasks/my_task.py
def my_scheduled_task():
    pass

# hooks.py
scheduler_events = {
    "daily": ["nirmaan_stack.tasks.my_task.my_scheduled_task"]
}
```

---

## Project Status Lifecycle

**Detail:** See `domain/projects.md` for full documentation.

### Statuses
```
Created → WIP / Completed / Halted / CEO Hold
```

- **Created**: System-set on project creation. Cannot be reverted to.
- **WIP/Completed/Halted**: Manual transitions by Admin/PMO Executive only.
- **CEO Hold**: Only `nitesh@nirmaan.app` can set/unset. Blocks ALL procurement, payment, and expense operations.

### Key Behavior
- **Halted/Completed** projects are hidden from `ProjectSelect` dropdown (used in PR/SR list filters, expense creation, etc.)
- **CEO Hold** actively blocks all operations (see `frontend/.claude/context/domain/ceo-hold.md`)
- **No hard API guards** — PR and SR creation is NOT blocked for Halted/Completed projects (but IS blocked for CEO Hold)
- **Financial ops intentionally bypass** — Inflow payments and new invoices show all projects (except CEO Hold)

---

## Version Control Strategy

- Extensive use of Frappe's native `Version` doctype
- Custom `Nirmaan Versions` for business-specific tracking
- Audit trail for: PRs, POs, SRs, estimates, payments

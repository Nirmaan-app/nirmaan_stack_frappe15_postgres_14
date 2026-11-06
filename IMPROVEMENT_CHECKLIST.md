# Nirmaan Stack Backend Improvement Checklist

> Prioritized improvements based on comparison with Frappe, ERPNext, and Raven patterns.
> Created: 2026-01-08

## Priority Legend

- 🔴 **P0 - Critical**: Fix immediately, causing active problems
- 🟠 **P1 - High**: Fix soon, significant tech debt
- 🟡 **P2 - Medium**: Fix when touching related code
- 🟢 **P3 - Low**: Nice to have, do opportunistically

---

## Phase 1: Cleanup & Consistency (1-2 weeks effort)

### 🔴 P0-1: Remove/Archive Duplicate Files

**Problem:** `populate_target_rates.py` exists in two places causing confusion.

**Action:**
- [ ] Delete `/nirmaan_stack/custom/populate_target_rates.py` (legacy version)
- [ ] Verify `/nirmaan_stack/populate_target_rates.py` is the active scheduler task
- [ ] Add comment in active file: `# This is the ACTIVE scheduled task. Legacy version was removed.`

**Files:**
- `/nirmaan_stack/custom/populate_target_rates.py` → DELETE
- `/nirmaan_stack/populate_target_rates.py` → KEEP (verify it's in hooks.py)

---

### 🔴 P0-2: Clarify `custom/` Folder Purpose

**Problem:** `custom/` folder has ambiguous purpose with only 2 files.

**Action:**
- [ ] Move `get_project_progress_state.py` to `/api/projects/` (it's an API endpoint)
- [ ] Delete empty `custom/` folder OR document its intended purpose
- [ ] If keeping: Add `custom/README.md` explaining when to use it

**Migration:**
```bash
# Move the API
mv custom/get_project_progress_state.py api/projects/

# Update any imports referencing old path
# Old: nirmaan_stack.custom.get_project_progress_state
# New: nirmaan_stack.api.projects.get_project_progress_state
```

---

### 🟠 P1-1: Fix Naming Inconsistencies

**Problem:** Mixed naming conventions (`data-table.py` vs `custom_pr_api.py`).

**Action:**
- [ ] Rename `api/data-table.py` → `api/data_table.py`
- [ ] Update all frontend imports referencing `data-table`
- [ ] Audit all files for consistent snake_case naming

**Frontend Update Needed:**
```typescript
// Old
useFrappePostCall('nirmaan_stack.api.data-table.get_list_with_count_enhanced')
// New
useFrappePostCall('nirmaan_stack.api.data_table.get_list_with_count_enhanced')
```

---

### 🟠 P1-2: Split `data_table.py` Monolith

**Problem:** 59KB single file is unmaintainable.

**Action:**
- [ ] Create `/api/data_table/` folder
- [ ] Split into focused modules:
  ```
  api/data_table/
  ├── __init__.py           # Re-export main function for backwards compatibility
  ├── core.py               # Main get_list_with_count_enhanced
  ├── filters.py            # Filter processing logic
  ├── aggregations.py       # SUM, AVG, COUNT logic
  ├── child_table_search.py # Child table item search
  └── cache.py              # Caching logic
  ```
- [ ] Keep backwards compatibility: `__init__.py` re-exports main function

**Backwards Compatibility:**
```python
# api/data_table/__init__.py
from .core import get_list_with_count_enhanced

__all__ = ['get_list_with_count_enhanced']
```

---

## Phase 2: Structural Improvements (2-4 weeks effort)

### 🟡 P2-1: Consolidate Lifecycle Hooks Location

**Problem:** Logic split between `integrations/controllers/` and `doctype/` folders.

**Decision Point:** Choose ONE pattern and stick to it.

**Option A: ERPNext Pattern (Recommended)**
Keep `integrations/controllers/` for event handlers, but ensure doctype controllers only handle:
- `autoname`
- Basic `validate` (field-level validation only)
- No business logic

**Option B: Raven Pattern**
Move all lifecycle logic into doctype controllers, use `integrations/controllers/` only for:
- Wildcard handlers (`"*"`)
- External doctype hooks (User, Address)

**Action (Option A):**
- [ ] Document the pattern in `CLAUDE.md`
- [ ] Audit each doctype controller - move business logic to `integrations/controllers/`
- [ ] Keep only field validation in doctype controllers

---

### 🟡 P2-2: Create Shared Base Controllers

**Problem:** PR, PO, SR duplicate notification, versioning, and status patterns.

**Action:**
- [ ] Create `/controllers/` folder at app root (following ERPNext)
- [ ] Create base classes:
  ```
  controllers/
  ├── __init__.py
  ├── document_controller.py    # Versioning, comments, attachments
  ├── procurement_controller.py # Shared PR/PO/SR logic
  └── notification_mixin.py     # Notification publishing
  ```
- [ ] Refactor doctypes to inherit from appropriate base

**Example Implementation:**
```python
# controllers/procurement_controller.py
class ProcurementController(Document):
    def publish_status_notification(self, event_id, recipients):
        """Shared notification logic for PR, PO, SR"""
        for user in recipients:
            create_nirmaan_notification(...)
            frappe.publish_realtime(event_id, ...)
            send_firebase_notification(...)

    def create_version_snapshot(self, previous_state, new_state):
        """Shared versioning logic"""
        frappe.get_doc({
            "doctype": "Nirmaan Versions",
            "ref_doctype": self.doctype,
            ...
        }).insert()

# doctype/procurement_requests/procurement_requests.py
from nirmaan_stack.controllers.procurement_controller import ProcurementController

class ProcurementRequests(ProcurementController):
    # Now inherits shared methods
    pass
```

---

### 🟡 P2-3: Organize API Files by Domain

**Problem:** Flat API folder with 30+ files, hard to navigate.

**Current:**
```
api/
├── approve_vendor_quotes.py
├── custom_pr_api.py
├── sidebar_counts.py
├── projects/
├── payments/
└── ... (mixed flat files and folders)
```

**Target (ERPNext-inspired):**
```
api/
├── __init__.py
├── procurement/              # All PR/PO/SB/Quotation APIs
│   ├── __init__.py
│   ├── requests.py          # custom_pr_api → renamed
│   ├── orders.py            # PO-related APIs
│   ├── quotes.py            # approve_vendor_quotes, reject, etc.
│   └── sent_back.py         # SB-related APIs
├── projects/                 # Already organized
├── payments/                 # Already organized
├── invoices/                 # Already organized
├── data/                     # Data aggregation APIs
│   ├── __init__.py
│   ├── table.py             # data_table split
│   └── sidebar.py           # sidebar_counts
└── master/                   # Master data APIs
    ├── vendors.py
    ├── items.py
    └── categories.py
```

**Migration Strategy:**
1. Create new folder structure
2. Move files, update imports
3. Keep old files as re-export stubs for 1 release cycle
4. Remove stubs after confirming no breakage

---

## Phase 3: Long-term Architecture (When Building New Features)

### 🟢 P3-1: Consider Module-Based Doctype Organization

**Problem:** 69 doctypes in flat folder doesn't scale.

**Current:**
```
nirmaan_stack/doctype/
├── procurement_requests/
├── procurement_orders/
├── projects/
└── ... (69 folders)
```

**Target (Raven-inspired):**
```
nirmaan_stack/
├── procurement/
│   └── doctype/
│       ├── procurement_requests/
│       ├── procurement_orders/
│       ├── quotation_requests/
│       └── sent_back_category/
├── projects/
│   └── doctype/
│       ├── projects/
│       └── project_work_milestones/
├── financials/
│   └── doctype/
│       ├── project_payments/
│       ├── project_invoices/
│       └── project_expenses/
└── master_data/
    └── doctype/
        ├── vendors/
        ├── items/
        └── categories/
```

**Note:** This is a MAJOR refactor. Only do when:
- Starting fresh with a new major version
- Breaking changes are acceptable
- All imports/paths need updating

**Alternative:** Keep flat structure but add `doctype/README.md` documenting groupings.

---

### 🟢 P3-2: Standardize Real-time Event Naming

**Current:** Mix of patterns
```python
frappe.publish_realtime("pr:new", ...)
frappe.publish_realtime("po:amended", ...)
frappe.publish_realtime("payment:fulfilled", ...)
```

**Proposed Standard:**
```python
# Pattern: {module}:{doctype}:{action}
frappe.publish_realtime("procurement:pr:created", ...)
frappe.publish_realtime("procurement:po:updated", ...)
frappe.publish_realtime("finance:payment:status_changed", ...)
```

**Action:**
- [ ] Document event naming convention
- [ ] Update events gradually as you touch related code
- [ ] Support both old and new names during transition

---

### 🟢 P3-3: Add Type Hints to Python Code

**Current:** No type hints
```python
def generate_pos_from_selection(pr_name, selections, payment_terms_map):
    pass
```

**Target:**
```python
from typing import Dict, List, Optional
from frappe.model.document import Document

def generate_pos_from_selection(
    pr_name: str,
    selections: List[Dict],
    payment_terms_map: Dict[str, List[Dict]]
) -> Dict[str, str]:
    pass
```

**Benefits:**
- Better IDE support
- Self-documenting code
- Catch type errors early

---

### 🟢 P3-4: Add Unit Tests for Critical Business Logic

**Current State:** Minimal/no tests visible

**Priority Test Targets:**
1. Auto-approval algorithm (`validate_procurement_request_for_po`)
2. Rate calculation (`populate_target_rates_by_unit`)
3. Payment term LIFO adjustment (`approve_amend_po_with_payment_terms`)
4. PO generation from quotes (`generate_pos_from_selection`)

**Test Location:**
```
tests/
├── test_auto_approval.py
├── test_rate_calculation.py
├── test_payment_terms.py
└── test_po_generation.py
```

---

## Quick Wins (Can Do Today)

1. [ ] Delete `/custom/populate_target_rates.py`
2. [ ] Rename `data-table.py` → `data_table.py`
3. [ ] Add this checklist to the repo
4. [ ] Document chosen patterns in `CLAUDE.md`

---

## Decision Log

Track architectural decisions here:

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-08 | Created improvement checklist | Align with Frappe/ERPNext/Raven patterns |
| | | |

---

## Progress Tracking

### Phase 1 Progress
- [ ] P0-1: Remove duplicate files
- [ ] P0-2: Clarify custom/ folder
- [ ] P1-1: Fix naming inconsistencies
- [ ] P1-2: Split data_table.py

### Phase 2 Progress
- [ ] P2-1: Consolidate lifecycle hooks
- [ ] P2-2: Create shared base controllers
- [ ] P2-3: Organize API files

### Phase 3 Progress
- [ ] P3-1: Module-based doctype organization
- [ ] P3-2: Standardize event naming
- [ ] P3-3: Add type hints
- [ ] P3-4: Add unit tests

---

*Update this checklist as improvements are completed.*

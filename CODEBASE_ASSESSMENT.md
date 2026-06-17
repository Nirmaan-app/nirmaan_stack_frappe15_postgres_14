# Nirmaan Stack — Codebase Assessment
## Security Vulnerabilities & Improvement Areas

> Prepared from full codebase analysis — March 2026
> Covers: Backend Python (api/, integrations/), Frontend React/TypeScript, Architecture & Code Quality

---

## Executive Summary

| Area | Status | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| SQL Injection | ✅ Safe | 0 | 0 | 0 | 0 |
| Authentication / Sessions | ✅ Safe | 0 | 0 | 0 | 0 |
| Authorization (Role Enforcement) | ⚠️ Gaps | 1 | 1 | 0 | 0 |
| Secrets / Credentials in Code | 🔴 Issue | 1 | 0 | 0 | 0 |
| Data Leakage | 🔴 Issue | 1 | 0 | 0 | 0 |
| Frontend Security | ⚠️ Gaps | 0 | 2 | 2 | 0 |
| Error Handling | ⚠️ Gaps | 0 | 1 | 1 | 0 |
| Performance (N+1 queries, caching) | ⚠️ Gaps | 0 | 1 | 1 | 0 |
| Code Quality / Maintainability | ⚠️ Gaps | 0 | 1 | 4 | 5 |

**Total findings: 3 Critical, 6 High, 8 Medium, 5 Low**

---

## What Is Working Well

Before the issues — these areas are solid and should be preserved:

- **SQL injection risk is minimal.** All 103+ raw SQL queries use parameterized placeholders (`%s`, `%(key)s`). PostgreSQL reserved keywords (`"user"`, `"tabDoctype"`) are correctly double-quoted throughout.
- **`frappe.db.commit()` usage is correct.** No DB writes found without a subsequent commit. The documented pattern of committing before `publish_realtime()` (to avoid race conditions) is followed.
- **Input parsing is defensive.** JSON parameters are parsed with `isinstance()` checks and try/except throughout the API layer.
- **Batch fetching pattern exists.** `api/po_delivery_documentss.py` demonstrates the correct approach for avoiding N+1 queries — a good reference pattern.
- **Transaction handling in PO operations is correct.** Cancel, merge, and amendment APIs properly wrap operations.

---

## Critical Issues — Fix Immediately

---

### C1 — Firebase Credentials Committed to Source Control

**Severity:** Critical
**File:** `frontend/src/firebase/firebaseConfig.ts`

**What is exposed:**
```
apiKey: "AIzaSyAZWGDU4LU-EIHJ0P14sNEKXTw91mB5_2Y"
authDomain: "nirmaan-stack.firebaseapp.com"
projectId: "nirmaan-stack"
VAPIDKEY: "BKCnCTRykNel6hGvgixZVcBs7Hyzzox6H9qZdmWV6golyHlLd3EIV9hTdyJd0AKlC0r7ZMd1Wplgpc9K190oiIQ"
appId: "1:260249096269:web:b5e2c804c3dd39616d4c04"
measurementId: "G-L623HFQCFY"
```

**Risk:**
Firebase API keys are semi-public by design (client-side SDKs need them), but the **VAPID key** is a different matter — it allows anyone who has it to send push notifications to your users impersonating the Nirmaan Stack app. If the Firebase project security rules are not locked down properly, the exposed `apiKey` could also allow unauthorized reads/writes to Firebase services.

Additionally, these credentials are now in git history. Even if you remove them from the file, they remain accessible in git log.

**Fix:**
1. Move all values to environment variables (`.env.local` for dev, CI/CD env vars for prod)
2. Add `.env.local` and `.env.production` to `.gitignore`
3. Rotate the VAPID key in Firebase Console immediately
4. Audit Firebase security rules to ensure all operations require authentication
5. Consider using `VITE_` prefixed variables for the Vite build system

---

### C2 — PO and PR Delete API Has No Authorization Check

**Severity:** Critical
**File:** `nirmaan_stack/api/delete_custom_po_and_pr.py`

**What it does:**
A whitelisted API function that permanently deletes a Procurement Order and its linked Procurement Request. Any authenticated user — regardless of role — can call this API directly and delete any PO or PR in the system.

**Risk:**
- A site-level user (e.g., a Project Lead or even a lower-privilege role) could delete any PO/PR in the system, not just their own projects
- No audit trail is created for the deletion
- No project-level permission check is performed

**Fix:**
Add role validation at the top of the function before any deletion occurs:
```python
@frappe.whitelist()
def delete_custom_po(po_id: str):
    allowed_roles = ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"]
    user_role = frappe.get_value("Nirmaan Users", frappe.session.user, "role_profile")
    if frappe.session.user != "Administrator" and user_role not in allowed_roles:
        frappe.throw("You do not have permission to delete Purchase Orders", frappe.PermissionError)
    # ... rest of function
```
Also verify that project-level permissions are checked (the user should only be able to delete POs/PRs belonging to their assigned projects).

---

### C3 — Debug Print Statements Leaking Sensitive Data in Production

**Severity:** Critical
**Primary file:** `nirmaan_stack/api/approve_vendor_quotes.py` (15+ print statements)
**Also affected:** `api/approve_reject_sb_vendor_quotes.py`, `api/data_table/utils.py`
**Total count:** ~121 `print()` calls across the `api/` directory

**Examples of what is being printed to production server logs:**
```python
print(f"DEBUGPP0: before payment_terms :{payment_terms}")   # Full JSON payload
print(f"DEBUGPP1: parsed_terms :{parsed_terms}")             # Payment term data
print(f"DEBUG_ATTACHMENT: {pr_attachment}")                  # Attachment info
print(f"DEBUGSBAPPROVE: ...")                                # SB approval data
```

**Risk:**
- Sensitive business data (payment terms, item quantities, vendor details) is written to server stdout/logs
- In a shared hosting environment, logs may be accessible to unintended parties
- Performance overhead from I/O on every API call
- Obscures legitimate log output, making debugging harder

**Fix:**
Remove all debug prints entirely. Where actual logging is needed for debugging:
```python
# Replace print() with:
frappe.log_error(f"Context: {variable}", "ModuleName")
# Or for non-error logging:
import logging
logger = logging.getLogger(__name__)
logger.debug(f"Context: {variable}")
```

---

## High Priority — Fix Within Current Sprint

---

### H1 — Frontend-Only Access Control on Sensitive Actions

**Severity:** High
**Files:**
- `frontend/src/components/common/BulkPdfDownloadButton.tsx`
- `frontend/src/components/helpers/renderRightActionButton.tsx`

**What is happening:**
Several sensitive actions are restricted in the UI by checking the user's role in React, but the corresponding backend API endpoints do not perform the same check. A user can bypass the UI entirely and call the API directly.

**Specific cases:**
1. **Invoice download with rates**: `BulkPdfDownloadButton.tsx` hides the "Download Invoices" and "With Rate" options for Project Managers via `isProjectManager` check. The underlying bulk download API does not validate this.
2. **Document creation buttons**: `renderRightActionButton.tsx` hides PR creation, expense creation, and product creation buttons based on role. These backend creation APIs likely do not enforce the same restrictions.

**Risk:**
Any user who knows the API endpoint and has a valid session can perform these restricted actions directly — bypassing the UI entirely.

**Fix:**
For each frontend-restricted action, add a corresponding role check in the backend API:
```python
@frappe.whitelist()
def bulk_download_with_rates(...):
    user_role = frappe.get_value("Nirmaan Users", frappe.session.user, "role_profile")
    if user_role == "Nirmaan Project Manager Profile":
        frappe.throw("Project Managers cannot download invoices with rates", frappe.PermissionError)
```

---

### H2 — N+1 Query Patterns on High-Frequency APIs

**Severity:** High
**Files:**
- `nirmaan_stack/api/sidebar_counts.py` (lines 83–91, 112–119)
- `nirmaan_stack/api/commission_report/get_task_wise_list.py` (lines 26–54)
- `nirmaan_stack/api/design_tracker/get_task_wise_list.py` (lines 32–76)

**What is happening:**
These APIs fetch a list of parent documents with `frappe.get_all()`, then call `frappe.get_doc()` inside a loop for each result to access child table data. This generates one database query per parent document.

Example from `sidebar_counts.py`:
```python
pr_list = frappe.get_all("Procurement Requests", ...)  # Query 1
for d in pr_list:
    full_doc = frappe.get_doc("Procurement Requests", d.name)  # Query per row!
    order_list_items = full_doc.order_list or []
```

**Risk:**
- The sidebar API is called on **every page load** for every user. With 50 pending PRs, this fires 50+ extra DB queries per load.
- Commission Report and Design Tracker task lists will degrade linearly with data volume.

**Fix:**
Replace the loop-with-get_doc pattern with a single SQL JOIN. The correct pattern is already demonstrated in `api/credits/get_credits_list.py` — use that as the reference:
```python
frappe.db.sql("""
    SELECT parent.name, child.item_id, child.status
    FROM "tabProcurement Requests" parent
    JOIN "tabProcurement Request Item Detail" child ON child.parent = parent.name
    WHERE parent.workflow_state = %s
""", (state,), as_dict=True)
```

---

### H3 — Bare `except:` Clauses Silently Swallowing All Errors

**Severity:** High
**Primary files:**
- `nirmaan_stack/api/data_table/search.py`
- `nirmaan_stack/api/data_table/facets.py`
- `nirmaan_stack/api/data_table/utils.py` (15+ instances)
- `nirmaan_stack/api/seven_days_planning/` (multiple files)
- `nirmaan_stack/api/commission_report/get_task_wise_list.py`

**Total count:** 25+ bare `except:` or `except Exception: continue` clauses

**Example from `data_table/search.py`:**
```python
try:
    meta = frappe.get_meta(doctype)
    # ... build query fields ...
except:
    pass  # "Keep it extremely safe"
```

**Risk:**
- Failures — including database errors, permission errors, and malformed data — are silently ignored
- Users see wrong/empty results with no indication something failed
- Makes production debugging extremely difficult (errors are invisible in logs)
- A bare `except:` also catches `KeyboardInterrupt`, `SystemExit`, and `GeneratorExit` which can prevent the process from shutting down cleanly

**Fix:**
Replace with specific exception types and log the error:
```python
try:
    meta = frappe.get_meta(doctype)
except (frappe.DoesNotExistError, AttributeError) as e:
    frappe.log_error(f"Metadata error for {doctype}: {e}", "DataTable")
    return []  # Or appropriate fallback
```

---

### H4 — Role Strings Hardcoded in 100+ Places With No Constants File

**Severity:** High
**Primary files:**
- `frontend/src/components/layout/NewSidebar.tsx` (100+ instances)
- `frontend/src/utils/auth/ProtectedRoute.tsx` (20+ instances)
- `frontend/src/components/helpers/renderRightActionButton.tsx`

**What is happening:**
Every role check in the frontend uses raw string literals:
```typescript
role === "Nirmaan Admin Profile"
role === "Nirmaan PMO Executive Profile"
role === "Nirmaan Project Lead Profile"
// ... repeated hundreds of times across many files
```

There is no central `roles.ts` constants file. Additionally, equality checks are inconsistent — some files use `==`, others use `===`, some use `.includes()`, others use `||` chains.

**Risk:**
- A single typo (e.g., "Nirmaan PMO Exective Profile") silently breaks access control with no error
- When a role is renamed, every occurrence must be manually found and updated — easy to miss one
- The inconsistent `==` vs `===` could cause edge cases in type coercion

**Fix:**
Create `frontend/src/constants/roles.ts`:
```typescript
export const ROLES = {
  ADMIN: "Nirmaan Admin Profile",
  PMO_EXECUTIVE: "Nirmaan PMO Executive Profile",
  PROJECT_LEAD: "Nirmaan Project Lead Profile",
  PROJECT_MANAGER: "Nirmaan Project Manager Profile",
  PROCUREMENT_EXECUTIVE: "Nirmaan Procurement Executive Profile",
  ACCOUNTANT: "Nirmaan Accountant Profile",
  ESTIMATES_EXECUTIVE: "Nirmaan Estimates Executive Profile",
  DESIGN_LEAD: "Nirmaan Design Lead Profile",
  DESIGN_EXECUTIVE: "Nirmaan Design Executive Profile",
  HR_EXECUTIVE: "Nirmaan HR Executive Profile",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];
```
Then replace all string literals with `ROLES.ADMIN` etc. and standardise all checks to use `===`.

---

### H5 — XSS Vector in Error Banner

**Severity:** High
**File:** `frontend/src/components/layout/alert-banner/error-banner.tsx` (lines 109–111)

**What is happening:**
```typescript
{messages.map((m, i) => (
  <div key={i} dangerouslySetInnerHTML={{ __html: m.message }} />
))}
```
Error messages received from the backend (`_server_messages`) are rendered as raw HTML without sanitization.

**Risk:**
If the backend ever sends an error message containing an HTML script tag (whether intentionally injected or accidentally constructed), it will execute in the user's browser. This is an indirect XSS vector — the attack surface is the backend error message pipeline.

**Fix:**
Install `dompurify` and sanitize before rendering:
```typescript
import DOMPurify from 'dompurify';

<div
  key={i}
  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m.message) }}
/>
```
Or, if the messages are always plain text (no intentional HTML formatting), use a text-only renderer and remove `dangerouslySetInnerHTML` entirely:
```typescript
<div key={i}>{m.message}</div>
```

---

## Medium Priority — Next 1–2 Sprints

---

### M1 — Duplicate Project Access-Control Logic in 8+ Backend Files

**Severity:** Medium
**Files:** `api/sidebar_counts.py`, `api/credits/get_credits_list.py`, `api/seven_days_planning/*.py` (3 files), `api/critical_po_tasks/get_projects_with_stats.py`, `api/tds/get_tds_requests.py`, and others

**Pattern repeated in each:**
```python
is_full_access = user_role in [full_access_roles...]
user_projects = [] if is_full_access else frappe.get_all(
    "Nirmaan User Permissions",
    filters={"user": user, "allow": "Projects"},
    pluck="for_value",
)
```

**Fix:**
Create `nirmaan_stack/api/utils/access.py`:
```python
def get_allowed_projects(user=None):
    """Returns list of project names the user can access, or None for full access."""
    user = user or frappe.session.user
    role = frappe.get_value("Nirmaan Users", user, "role_profile")
    full_access_roles = ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", ...]
    if role in full_access_roles or user == "Administrator":
        return None  # Full access
    return frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value"
    )
```

---

### M2 — Missing Redis Caching on High-Frequency Expensive APIs

**Severity:** Medium
**Files:**
- `nirmaan_stack/api/sidebar_counts.py` — runs 6+ DB queries on every page load with no cache
- `nirmaan_stack/api/projects/project_aggregates.py` — 537-line aggregation, no cache
- `nirmaan_stack/api/commission_report/get_team_summary.py` — no cache
- `nirmaan_stack/api/design_tracker/get_team_summary.py` — no cache

**Comparison:** `api/data_table/` and `api/pr_editing_lock.py` correctly use `frappe.cache()` — those are the right reference patterns.

**Fix:**
Wrap expensive read operations with Redis caching:
```python
cache_key = f"sidebar_counts:{frappe.session.user}"
cached = frappe.cache().get_value(cache_key)
if cached:
    return cached

result = _compute_sidebar_counts()  # Expensive DB queries
frappe.cache().set_value(cache_key, result, expires_in_sec=300)  # 5-min TTL
return result
```
Invalidate the cache when documents that affect counts are created/updated (in the relevant lifecycle hooks).

---

### M3 — Severely Oversized Files

**Severity:** Medium
**CLAUDE.md explicitly states:** "Large files: Split files >500 lines into focused modules"

**Backend (most urgent):**

| File | Lines | Suggested split |
|---|---|---|
| `integrations/controllers/procurement_requests.py` | 1,040 | Split by workflow state: `pr_creation.py`, `pr_approval.py`, `pr_deletion.py` |
| `api/approve_reject_sb_vendor_quotes.py` | 894 | Also contains ~214 lines of commented-out dead code at the top — remove those first |
| `api/pdf_helper/bulk_download.py` | 630 | Split into `pdf_generation.py` and `bulk_download.py` |
| `api/po_revisions/revision_logic.py` | 544 | Extract validation helpers to `_revision_validators.py` |

**Frontend (most urgent):**

| File | Lines | Suggested split |
|---|---|---|
| `pages/Manpower-and-WorkMilestones/MilestoneTab.tsx` | **5,865** | Extract: `MilestoneProgressSection`, `ManpowerSection`, `PhotoUploadSection`, `WorkHeaderSection` |
| `pages/projects/project.tsx` | 2,302 | Tabs should each be their own component (most already are — finish the split) |
| `pages/ProjectDesignTracker/project-design-tracker-details.tsx` | 1,899 | Split by design phase |
| `pages/CommissionReport/project-commission-report-details.tsx` | 1,797 | Split by report section |

---

### M4 — No Test Coverage for API Endpoints

**Severity:** Medium
**Current state:** 73 doctype unit test files exist in `doctype/*/test_*.py`, but there are **0 tests** for any of the 92+ files in `api/`.

**Highest-risk unverified flows:**
- PR auto-approval logic (₹5,000 threshold, 8-consecutive-auto-approval cap)
- PO generation from selected quotes (`approve_vendor_quotes.py`)
- Payment term linking and status sync
- PO revision auto-approval rules

**Fix:**
Start with integration tests for the highest-risk APIs using Frappe's test framework:
```python
# api/tests/test_approve_vendor_quotes.py
import frappe
from frappe.tests.utils import FrappeTestCase

class TestApproveVendorQuotes(FrappeTestCase):
    def test_auto_approval_below_threshold(self):
        ...
    def test_manual_review_after_8_consecutive(self):
        ...
```

---

### M5 — Migration Patches Have Performance and Safety Issues

**Severity:** Medium
**File:** `nirmaan_stack/patches/v2_0/project_gst_patch.py` (and pattern repeated across other patches)

**Issues:**
1. N+1 pattern: loads each document individually in a loop instead of batch SQL
2. No try/except around per-record operations — one bad record fails the whole migration

**Fix:**
```python
# Instead of loop-with-get_doc:
frappe.db.sql("""
    UPDATE "tabProjects"
    SET project_gst_number = %s
    WHERE (project_gst_number IS NULL OR project_gst_number = '')
""", (default_gst,))
frappe.db.commit()
```
For patches that must process records individually, wrap in try/except and continue on failure:
```python
for project in projects:
    try:
        # ... update logic ...
    except Exception as e:
        frappe.log_error(f"Patch failed for {project.name}: {e}", "MigrationPatch")
        continue
```

---

### M6 — URL Parameters Passed to APIs Without Project-Level Validation

**Severity:** Medium
**Files:**
- `frontend/src/pages/Items/item.tsx` (unit, make from URL → passed to API filter)
- `frontend/src/pages/Manpower-and-WorkMilestones/MilestoneDailySummary.tsx` (project_id, zone, report_date from URL)
- `frontend/src/components/procurement/EstimatedPriceOverview.tsx` (poId, itemId from URL)

**Risk:**
A user can manually construct a URL with a different `project_id` to view data from a project they haven't been assigned to. The backend is the correct enforcement layer, but each of these URL-driven API calls needs to be audited to confirm project-level permission checks exist.

**Fix:**
Audit the backend APIs called by these three pages. For each one, ensure the API checks:
```python
allowed_projects = get_allowed_projects(frappe.session.user)
if allowed_projects is not None and project_id not in allowed_projects:
    frappe.throw("Access denied to this project", frappe.PermissionError)
```

---

### M7 — Only 2 Error Boundaries for 30+ Pages

**Severity:** Medium
**Current state:** `NewPRErrorBoundary.tsx` and `ProgressReportErrorBoundary.tsx` exist — no others.

**Risk:**
When any unhandled JavaScript error occurs (null reference, failed JSON parse, component rendering crash), the entire page goes blank with no recovery option. This is poor user experience and makes errors hard to diagnose.

**Fix:**
Create a generic `PageErrorBoundary` component and wrap all top-level page components:
```typescript
// components/error-boundaries/PageErrorBoundary.tsx
class PageErrorBoundary extends React.Component {
  // ... fallback UI with retry button and error details
}

// In each page:
export default function MyPage() {
  return (
    <PageErrorBoundary>
      <MyPageContent />
    </PageErrorBoundary>
  );
}
```

---

## Low Priority — Backlog / Tech Debt

---

### L1 — Business Logic Thresholds Hardcoded in Multiple Files

| Threshold | Value | File |
|---|---|---|
| PR auto-approval | ₹5,000 | `integrations/controllers/procurement_requests.py:18` |
| PO auto-approval | ₹20,000 | `integrations/controllers/procurement_requests.py` |
| PO revision auto-approval | ₹5,000 | `api/po_revisions/revision_logic.py:16` |
| Auto-approval consecutive cap | 8 | `integrations/controllers/procurement_requests.py` |

**Fix:** Consolidate into `nirmaan_stack/constants.py` or a Frappe Settings doctype so business rules can be changed in one place.

---

### L2 — Country "India" Hardcoded in Project Creation

**File:** `api/projects/new_project.py` line 152
`address_doc.country = "India"`
**Fix:** Read from Frappe's System Settings default country.

---

### L3 — ~214 Lines of Commented-Out Dead Code

**File:** `api/approve_reject_sb_vendor_quotes.py` (top of file)
Old implementation left as comments. Git history preserves it if ever needed.
**Fix:** Delete entirely.

---

### L4 — Orphaned Hook Comment in hooks.py

**File:** `nirmaan_stack/hooks.py` (line 154)
```python
# "on_update": "...project_work_milestones...edit_pwm",
# Commented out - PWM doctype no longer in use
```
**Fix:** Remove the comment. Verify no other files reference the PWM handler.

---

### L5 — Inconsistent Query Patterns Across api/

Three different approaches are used for similar operations:
- `frappe.get_all()` with filters (simple queries)
- `frappe.get_doc()` loops (N+1 anti-pattern, see H2)
- Raw `frappe.db.sql()` (complex JOINs)
- `frappe.db.count()` for aggregates

**Fix:** Document a decision tree in CLAUDE.md:
- Simple single-doctype queries with standard fields → `frappe.get_all()`
- Complex JOINs, child table filtering, aggregations → raw SQL
- Never `frappe.get_doc()` inside a loop

---

## Appendix: All Files Requiring Attention

### Immediate Action Required

| File | Issue | Severity |
|---|---|---|
| `frontend/src/firebase/firebaseConfig.ts` | Firebase credentials in repo | Critical |
| `nirmaan_stack/api/delete_custom_po_and_pr.py` | No authorization check on delete | Critical |
| `nirmaan_stack/api/approve_vendor_quotes.py` | 15+ debug prints with sensitive data | Critical |
| `nirmaan_stack/api/approve_reject_sb_vendor_quotes.py` | Debug prints + 214 lines dead code | Critical/Low |

### High Priority Review

| File | Issue | Severity |
|---|---|---|
| `frontend/src/components/common/BulkPdfDownloadButton.tsx` | Frontend-only access control | High |
| `frontend/src/components/helpers/renderRightActionButton.tsx` | Frontend-only access control | High |
| `nirmaan_stack/api/sidebar_counts.py` | N+1 queries on every page load | High |
| `nirmaan_stack/api/commission_report/get_task_wise_list.py` | N+1 query pattern | High |
| `nirmaan_stack/api/design_tracker/get_task_wise_list.py` | N+1 query pattern | High |
| `nirmaan_stack/api/data_table/search.py` | Bare except clauses | High |
| `nirmaan_stack/api/data_table/facets.py` | Bare except clauses | High |
| `nirmaan_stack/api/data_table/utils.py` | 15+ bare except clauses + debug prints | High |
| `frontend/src/components/layout/NewSidebar.tsx` | 100+ hardcoded role strings | High |
| `frontend/src/utils/auth/ProtectedRoute.tsx` | Hardcoded role strings | High |
| `frontend/src/components/layout/alert-banner/error-banner.tsx` | XSS via dangerouslySetInnerHTML | High |

### Medium Priority Review

| File | Lines | Issue |
|---|---|---|
| `integrations/controllers/procurement_requests.py` | 1,040 | Oversized, needs splitting |
| `api/approve_reject_sb_vendor_quotes.py` | 894 | Oversized |
| `pages/Manpower-and-WorkMilestones/MilestoneTab.tsx` | 5,865 | Severely oversized |
| `pages/projects/project.tsx` | 2,302 | Oversized |
| `pages/ProjectDesignTracker/project-design-tracker-details.tsx` | 1,899 | Oversized |
| `pages/CommissionReport/project-commission-report-details.tsx` | 1,797 | Oversized |
| `nirmaan_stack/patches/v2_0/project_gst_patch.py` | — | N+1 migration pattern |
| `nirmaan_stack/hooks.py` | line 154 | Orphaned hook comment |

---

*Assessment prepared from full codebase analysis — March 2026*

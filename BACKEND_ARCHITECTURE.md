# Nirmaan Stack Backend Architecture

> Complete technical documentation of the Nirmaan Stack Frappe application backend.
> Last Updated: 2026-01-08

## Table of Contents

1. [Overview](#overview)
2. [Directory Structure](#directory-structure)
3. [Doctypes (69 Total)](#doctypes-69-total)
4. [API Layer (38+ Endpoints)](#api-layer-38-endpoints)
5. [Document Lifecycle Hooks](#document-lifecycle-hooks)
6. [Scheduled Tasks](#scheduled-tasks)
7. [Notification System](#notification-system)
8. [Business Rules](#business-rules)
9. [Cross-Doctype Relationships](#cross-doctype-relationships)
10. [Data Patterns](#data-patterns)

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | Nirmaan Stack |
| **Framework** | Frappe v15+ |
| **Purpose** | Construction project management and procurement ERP |
| **License** | MIT |

### Key Statistics

| Metric | Count |
|--------|-------|
| Total Doctypes | 69 |
| Master Doctypes | 53 |
| Child Tables | 14 |
| Single Doctypes | 2 |
| API Endpoints | 38+ |
| Scheduled Tasks | 3 |
| Doctypes with Hooks | 17 |
| Fixtures | 14 groups |

---

## Directory Structure

```
nirmaan_stack/
├── nirmaan_stack/
│   ├── doctype/                    # 69 custom doctypes
│   │   ├── procurement_requests/
│   │   ├── procurement_orders/
│   │   ├── projects/
│   │   └── ... (66 more)
│   │
│   ├── api/                        # 38+ whitelisted API endpoints
│   │   ├── approve_vendor_quotes.py
│   │   ├── custom_pr_api.py
│   │   ├── data-table.py           # 59KB - main data aggregation
│   │   ├── sidebar_counts.py
│   │   ├── projects/
│   │   │   ├── new_project.py
│   │   │   ├── add_customer_po.py
│   │   │   └── project_aggregates.py
│   │   ├── payments/
│   │   ├── invoices/
│   │   ├── vendor/
│   │   ├── customers/
│   │   ├── delivery_notes/
│   │   ├── tasks/
│   │   ├── target_rates/
│   │   └── ...
│   │
│   ├── integrations/               # Event handlers & external services
│   │   ├── controllers/            # Document lifecycle handlers
│   │   │   ├── procurement_requests.py
│   │   │   ├── procurement_orders.py
│   │   │   ├── service_requests.py
│   │   │   ├── project_payments.py
│   │   │   ├── sent_back_category.py
│   │   │   ├── nirmaan_users.py
│   │   │   ├── nirmaan_versions.py
│   │   │   ├── delete_doc_versions.py
│   │   │   ├── user_permission.py
│   │   │   └── items.py
│   │   ├── firebase/               # FCM push notifications
│   │   │   └── firebase_admin_setup.py
│   │   └── Notifications/          # Notification helpers
│   │       └── pr_notifications.py
│   │
│   ├── tasks/                      # Scheduled background jobs
│   │   ├── payment_term_worker.py
│   │   └── item_status_update.py
│   │
│   ├── custom/                     # Legacy/utility scripts
│   │   ├── populate_target_rates.py
│   │   └── get_project_progress_state.py
│   │
│   ├── services/                   # Business logic services
│   ├── fixtures/                   # Seed data (JSON)
│   ├── patches/                    # Database migrations (v1_5 - v2_7)
│   ├── templates/                  # Jinja templates
│   ├── www/                        # Web routes
│   │   ├── nirmaan_stack.py       # Boot context API
│   │   └── frontend.html          # React app entry
│   ├── public/frontend/            # Built React assets
│   │
│   ├── hooks.py                    # App configuration (doc_events, scheduler)
│   ├── install.py                  # Installation scripts
│   ├── populate_target_rates.py    # Rate calculation (ACTIVE scheduler task)
│   └── __init__.py                 # Firebase initialization
│
├── CLAUDE.md                       # Project documentation
├── BACKEND_ARCHITECTURE.md         # This file
└── ...
```

---

## Doctypes (69 Total)

### 1. Procurement Workflow (14 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Procurement Requests** | Master | project, workflow_state, order_list (child), category_list (JSON) | Material requisitions |
| **Procurement Orders** | Master | project, vendor, status, order_list (child), payment_terms (child) | Purchase orders |
| **Quotation Requests** | Master | procurement_request, vendor, items | RFQs to vendors |
| **Approved Quotations** | Master | item_id, vendor, quote, quantity, unit, make | Accepted quotes |
| **Selected Quotations** | Child | item_id, vendor_name, procurement_order | Quote selections |
| **Sent Back Category** | Master | procurement_request, type, item_list (JSON), status | Rejected PR categories |
| **Service Requests** | Master | project, vendor, service_order_list (JSON), status, gst, total_amount | Service procurement |
| **Procurement Request Item Detail** | Child | item_id, item_name, unit, category, vendor, status | PR line items |
| **Purchase Order Item** | Child | item_id, quantity, amount, tax_amount, total_amount | PO line items |
| **PO Payment Terms** | Child | payment_type, percentage, due_date, status, term_status | Payment milestones |
| **Procurement Packages** | Master | package_name | Procurement categorization |
| **Critical PO Category** | Master | category_name | Critical item categories |
| **Critical PO Items** | Master | category, item_name, release_timeline_offset | Critical item definitions |
| **Critical PO Tasks** | Master | project, category, po_release_date, status | Project-specific tracking |

### 2. Projects & Planning (11 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Projects** | Master | project_name, customer, project_value, project_start_date, customer_po_details (child) | Central hub |
| **Project Types** | Master | project_type_name | Categorization |
| **Project Estimates** | Master | project, category, item, quantity_estimate, rate_estimate | BOQ management |
| **Project Expenses** | Master | project, vendor, amount, expense_type | Cost tracking |
| **Project Invoices** | Master | project, invoice_no, amount | Vendor invoices |
| **Project Inflows** | Master | project, customer, utr, amount | Revenue tracking |
| **Project Payments** | Master | project, document_type, document_name, utr, status | Payment records |
| **Non Project Expenses** | Master | expense_type, amount, description | Overhead costs |
| **Customer PO Child Table** | Child | customer_po_number, customer_po_value_inctax | Customer PO details |
| **Project Drive Link Child Table** | Child | drive_name, drive_link | Google Drive links |
| **Project Zone Child Table** | Child | zone_name | Project zones |

### 3. Work Management (7 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Work Packages** | Master | work_package_name | WBS definitions |
| **Work Headers** | Master | work_package, work_header_name | Work headers |
| **Work Milestones** | Master | work_header, work_milestone_name | Milestone definitions |
| **Scopes of Work** | Master | work_package, scope_of_work_name | Scope definitions |
| **Milestones** | Master | scope_of_work, milestone_name, start_day, end_day | Milestone master |
| **Project Work Milestones** | Master | project, work_package, milestone, status | Project milestones |
| **Project Work Headers** | Child | work_header, enabled | Project work headers |

### 4. Reporting & Tracking (9 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Project Progress Reports** | Master | project, report_date, report_status, manpower (child), milestones (child) | Progress tracking |
| **Project Progress Report Attachments** | Child | location, remarks | Progress photos |
| **Project Progress Report Manpower Details** | Child | label, count | Labor details |
| **Project Progress Report Work Milestones** | Child | work_milestone_name, status, progress | Milestone status |
| **Project Design Tracker** | Master | project, status, phase | Design tracking |
| **Design Tracker Category** | Master | category_name | Design categories |
| **Design Tracker Tasks** | Master | task_name, category | Design tasks |
| **Design Tracker Task Child Table** | Child | task_name, deadline, status, assigned_designers (JSON) | Task details |
| **Manpower Reports** | Master | project, report (JSON) | Labor tracking |

### 5. Master Data (12 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Vendors** | Master | vendor_name, vendor_city, vendor_gst, vendor_category (JSON) | Vendor master |
| **Customers** | Master | company_name, company_gst | Customer master |
| **Items** | Master | item_name, category, unit_name, item_status | Product master |
| **Category** | Master | category_name, tax, procurement_package | Item categories |
| **Makelist** | Master | make_name | Brands/manufacturers |
| **Category Makelist** | Master | category, make | Category-make links |
| **Vendor Category** | Master | vendor, category | Vendor-category links |
| **Nirmaan Item Units** | Master | unit_name, unit_abb | UOM definitions |
| **Pincodes** | Master | pincode, city, state | Geographic data |
| **Expense Type** | Master | expense_name, project, non_project | Expense categories |
| **Target Rates** | Master | item_id, unit, make, rate, selected_quotations (child) | Historical benchmarks |
| **Project Work Package Category Make** | Child | procurement_package, category, make | Category-make per project |

### 6. User & Permissions (2 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Nirmaan Users** | Master | email, full_name, role_profile, fcm_token, has_project | Extended user profiles |
| **Nirmaan User Permissions** | Master | user, allow, for_value | Project-level access |

### 7. Attachments & Collaboration (8 doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Nirmaan Attachments** | Master | project, associated_doctype, associated_docname, attachment_type | File storage |
| **Nirmaan Comments** | Master | reference_doctype, comment_type, content | Comments |
| **Nirmaan Notifications** | Master | recipient, title, document, event_id, seen, action_url | In-app notifications |
| **Nirmaan Versions** | Master | ref_doctype, docname, data (JSON), previous_state, new_state | Audit trail |
| **PR Attachments** | Master | procurement_request, vendor | PR files |
| **Delivery Note Attachments** | Master | procurement_order, project | Delivery docs |
| **Milestone Attachments** | Master | project_work_milestone, project | Milestone docs |
| **Category BOQ Attachments** | Master | procurement_request, category | BOQ documents |

### 8. System Configuration (2 single doctypes)

| Doctype | Type | Key Fields | Purpose |
|---------|------|------------|---------|
| **Auto Approval Counter Settings** | Single | auto_approved_pr_count | Auto-approval tracking |
| **Map API** | Single | api_key | Geolocation config |

---

## API Layer (38+ Endpoints)

### Procurement APIs

| File | Endpoint | Doctypes | Operations |
|------|----------|----------|------------|
| `approve_vendor_quotes.py` | `generate_pos_from_selection()` | PR, PO, Vendors | Creates POs from selected quotes |
| `custom_pr_api.py` | `new_custom_pr()`, `resolve_custom_pr()` | PR, Comments, Attachments | Custom PR creation with child tables |
| `approve_reject_sb_vendor_quotes.py` | `new_handle_approve()`, `new_handle_sent_back()` | SB, PR, PO | SB approval/rejection workflow |
| `reject_vendor_quotes.py` | `send_back_items()` | PR, SB, Comments | Send back rejected items |
| `handle_cancel_po.py` | `handle_cancel_po()` | PO, PR, SB | PO cancellation with SB creation |
| `po_merge_and_unmerge.py` | `handle_merge_pos()`, `handle_unmerge_pos()` | PO, Payments | PO consolidation |
| `approve_amend_po.py` | `approve_amend_po_with_payment_terms()` | PO, Vendors | Amendment approval with LIFO payment term adjustment |

### Data Aggregation APIs

| File | Endpoint | Features |
|------|----------|----------|
| `data-table.py` (59KB) | `get_list_with_count_enhanced()` | Child table search, JSON field search, date filtering, aggregations, 5-min cache |
| `sidebar_counts.py` | `sidebar_counts()` | Badge counts for PO, PR, SB, SR, Payments |

### Project APIs

| File | Endpoint | Operations |
|------|----------|------------|
| `projects/new_project.py` | `create_project_with_address()` | Project creation with Address |
| `projects/add_customer_po.py` | `add_customer_po_with_validation()` | Customer PO linking |
| `projects/project_aggregates.py` | `get_project_sr_summary_aggregates()` | Financial summaries with Redis cache |

### Financial APIs

| File | Endpoint | Operations |
|------|----------|------------|
| `payments/project_payments.py` | `create_project_payment()` | Payment creation with PO term linking |
| `invoices/po_wise_invoice_data.py` | `generate_all_po_invoice_data()` | Invoice aggregation |

---

## Document Lifecycle Hooks

### Registered in `hooks.py`

| Doctype | Events | Handler Location |
|---------|--------|------------------|
| **Procurement Requests** | after_insert, on_update, on_trash, after_delete | `integrations/controllers/procurement_requests.py` |
| **Procurement Orders** | after_insert, on_update, on_trash | `integrations/controllers/procurement_orders.py` |
| **Service Requests** | on_update, on_trash | `integrations/controllers/service_requests.py` |
| **Project Payments** | after_insert, on_update, on_trash | `integrations/controllers/project_payments.py` |
| **Sent Back Category** | after_insert, on_update, on_trash | `integrations/controllers/sent_back_category.py` |
| **Nirmaan Users** | on_trash | `integrations/controllers/nirmaan_users.py` |
| **User Permission** | after_insert, on_trash | `integrations/controllers/user_permission.py` |
| **Version** | after_insert | `integrations/controllers/nirmaan_versions.py` |
| **Items** | after_insert | `integrations/controllers/items.py` |
| **Projects** | after_insert, on_update | `doctype/projects/projects.py` |
| **Vendors** | after_insert, on_update, on_trash | `doctype/vendor_category/vendor_category.py` |
| **User** | after_insert, on_update | `doctype/nirmaan_users/nirmaan_users.py` |

### Event Handler Operations

| Doctype | Event | Operations |
|---------|-------|------------|
| **PR** | after_insert | Validate items, auto-approve if <₹5K, notifications, publish `pr:new` |
| **PR** | on_update | Handle workflow transitions, notifications by state |
| **PR** | on_trash | Delete comments/attachments/notifications, publish `pr:delete` |
| **PO** | after_insert | Notify procurement + accountants, publish `po:new` |
| **PO** | on_update (Dispatched) | Create Approved Quotations from PO items |
| **PO** | on_update (Amendment) | Notify leads, publish `po:amended` |
| **Payment** | after_insert | Link to PO payment_term, notify admins |
| **Payment** | on_update | Sync PO term status (Approved/Paid) |
| **Payment** | on_trash | Revert PO term status |

---

## Scheduled Tasks

### Configuration (`hooks.py`)

```python
scheduler_events = {
    "daily": [
        "nirmaan_stack.populate_target_rates.populate_target_rates_by_unit",
        "nirmaan_stack.tasks.payment_term_worker.update_payment_term_status",
        "nirmaan_stack.tasks.item_status_update.update_item_status"
    ]
}
```

### Task Details

| Task | File | Doctypes | Logic |
|------|------|----------|-------|
| `populate_target_rates_by_unit()` | `populate_target_rates.py` | Approved Quotations → Target Rates | Weighted average rates (3-month window) |
| `update_payment_term_status()` | `tasks/payment_term_worker.py` | PO Payment Terms | Created → Scheduled when due_date ≤ today |
| `update_item_status()` | `tasks/item_status_update.py` | Items, Approved Quotations, PO | Active/Inactive based on quote history |

---

## Notification System

### Three-Tier Architecture

```
Document Event → Event Handler
                      │
    ┌─────────────────┼─────────────────┐
    ▼                 ▼                 ▼
Firebase FCM    Nirmaan            Socket.IO
(push)         Notifications       (real-time)
               (persistent)
```

### Event IDs Published

| Doctype | Events |
|---------|--------|
| Procurement Requests | `pr:new`, `pr:vendorSelected`, `pr:approved`, `pr:rejected`, `pr:delete` |
| Procurement Orders | `po:new`, `po:amended`, `po:delete` |
| Service Requests | `sr:vendorSelected`, `sr:amended`, `sr:approved`, `sr:delete` |
| Sent Back Category | `{type}-sb:new`, `sb:vendorSelected`, `sb:delete` |
| Project Payments | `payment:new`, `payment:approved`, `payment:fulfilled`, `payment:delete` |

---

## Business Rules

### Auto-Approval Rules

| Rule | Threshold | Behavior |
|------|-----------|----------|
| Immediate Auto-Approve | PR total < ₹5,000 | Auto-approve on creation |
| Conditional Auto-Approve | PO total < ₹20,000 | Auto-approve + generate POs (with 8-count cap) |
| Manual Review Force | Every 8th auto-approval | Reset counter, require manual review |

### Rate Calculation Rules

| Scenario | Rate Used |
|----------|-----------|
| No valid quotes | Rate = "-1" (invalid) |
| Single quote (any time) | That quote's rate |
| Single recent quote (3 months) | That quote's rate |
| Multiple recent quotes | Weighted average by quantity |
| No recent quotes | Latest overall quote |

### Item Status Rules

| Condition | Status |
|-----------|--------|
| No quotes, created < 1 month | Active |
| No quotes, created >= 1 month | Inactive |
| 1 quote with PO < 6 months | Active |
| 1 quote with PO >= 6 months | Inactive |
| 2+ quotes | Active |

### Payment Term Rules

| Event | PO Payment Term Status |
|-------|----------------------|
| Term created | "Created" |
| Due date reached | "Scheduled" (via daily task) |
| Payment approved | "Approved" |
| Payment paid | "Paid" |
| Payment deleted | Reverts to "Scheduled" or "Created" |

---

## Cross-Doctype Relationships

### Dependency Graph

```
                              ┌─────────────┐
                              │   Projects  │ (Central Hub)
                              └──────┬──────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ Procurement     │         │ Service         │         │ Project         │
│ Requests        │         │ Requests        │         │ Estimates       │
└────────┬────────┘         └────────┬────────┘         └─────────────────┘
         │                           │
         ▼                           │
┌─────────────────┐                  │
│ Sent Back       │                  │
│ Category        │                  │
└────────┬────────┘                  │
         │                           │
         ▼                           │
┌─────────────────┐                  │
│ Procurement     │◄─────────────────┘
│ Orders          │
└────────┬────────┘
         │
         ├─────────────────────────────────────────┐
         │                                         │
         ▼                                         ▼
┌─────────────────┐                       ┌─────────────────┐
│ Approved        │                       │ Project         │
│ Quotations      │                       │ Payments        │
└─────────────────┘                       └────────┬────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ PO Payment      │
                                          │ Terms (child)   │
                                          └─────────────────┘
```

### Key Relationship Flows

**PR → PO Creation:**
```
PR (order_list) → Vendor Selection → Quotation Requests → Approved Quotations
                                                              ↓
                                            approve_vendor_quotes.py
                                                              ↓
                                            PO created (one per vendor)
                                                              ↓
                                            PO Dispatched → Approved Quotations created
```

**Payment ↔ PO Sync:**
```
Payment created → _find_and_update_po_term() → PO term linked
Payment status change → PO term status synced
Payment deleted → PO term status reverted
```

---

## Data Patterns

### JSON Fields vs Child Tables

| Pattern | Use Case | Examples |
|---------|----------|----------|
| **JSON Fields** | Flexible, UI-driven data | `category_list`, `rfq_data`, `service_order_list` |
| **Child Tables** | Structured, queryable data | `order_list`, `payment_terms`, `customer_po_details` |

### Naming Conventions

| Doctype | Pattern | Example |
|---------|---------|---------|
| Procurement Requests | `PR-{PROJECT_ID}-{SERIES}` | PR-001-000001 |
| Procurement Orders | `PO/{SERIES}/{PROJECT}/{FY}` | PO/001/001/25-26 |
| Service Requests | `SR-{PROJECT_ID}-{SERIES}` | SR-001-000001 |
| Projects | `{CITY}-PROJ-{SERIES}` | Mumbai-PROJ-00001 |

---

## Fixtures (Auto-imported)

### Master Data
- Work Packages, Procurement Packages, Category
- Scopes of Work, Milestones
- Expense Type, Nirmaan Item Units
- Items (Additional Charges category)

### System Configuration
- Nirmaan Roles, Nirmaan Role Profiles
- Workflow, Workflow State, Workflow Action Master
- Portal Menu Item, Print Format

---

## Installation Requirements

- **Frappe Framework**: v15.0+
- **Python**: 3.10+
- **Database**: MariaDB/PostgreSQL
- **Redis**: Required for caching
- **Firebase**: FCM credentials for push notifications

---

*This documentation should be updated when significant architectural changes are made.*

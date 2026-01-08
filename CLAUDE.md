# CLAUDE.md - Backend

This file provides guidance to Claude Code (claude.ai/code) when working with the Nirmaan Stack backend.

## IMPORTANT: Architecture Reference

**Before creating or modifying any Python script, API endpoint, or doctype in this project:**

1. **Read `BACKEND_ARCHITECTURE.md`** - Contains complete doctype mappings, API documentation, lifecycle hooks, and cross-doctype relationships
2. **Read `IMPROVEMENT_CHECKLIST.md`** - Contains prioritized refactoring tasks and architectural decisions. Check if your change aligns with improvement goals or conflicts with planned refactors
3. **Check existing patterns** - Follow established conventions for:
   - API endpoints in `/api/` folder (organize by domain)
   - Document lifecycle hooks in `/integrations/controllers/`
   - Scheduled tasks in `/tasks/`
   - Notification patterns using the three-tier system (Firebase, Nirmaan Notifications, Socket.IO)
4. **Update documentation** - When adding new doctypes, APIs, or hooks, update `BACKEND_ARCHITECTURE.md` accordingly
5. **Verify doctype dependencies** - Check the dependency graph before modifying linked doctypes

### Key Architectural Decisions (from IMPROVEMENT_CHECKLIST.md)
- **API naming**: Use snake_case (not hyphens)
- **Lifecycle hooks**: Keep in `integrations/controllers/`, doctype files only for `autoname`/basic `validate`
- **Large files**: Split files >500 lines into focused modules
- **Shared logic**: Use base controllers for PR/PO/SR common patterns

## Project Overview

This is a **Python-based Frappe Framework v15+ application** that serves as the backend for Nirmaan Stack - a comprehensive construction project management and procurement ERP system. The backend handles all business logic, data persistence, workflows, and API endpoints consumed by the React frontend.

## Development Environment

### Prerequisites
- Frappe Framework v15+
- Python 3.10+
- MariaDB/PostgreSQL
- Redis
- Node.js (for Frappe)

### Running the Backend
```bash
# From frappe-bench directory
bench start

# Backend runs on:
# - HTTP: http://localhost:8000
# - Socket.IO: http://localhost:9000
```

### Development Commands
```bash
# Create new doctype
bench new-doctype [doctype-name]

# Migrate database
bench migrate

# Clear cache
bench clear-cache

# Rebuild assets
bench build

# Run tests
bench run-tests --app nirmaan_stack

# Enable developer mode
bench set-config developer_mode 1
```

## Backend Architecture

### Directory Structure

```
nirmaan_stack/
├── nirmaan_stack/doctype/       # 57 custom doctypes
├── api/                          # Whitelisted API endpoints (30+ files)
├── integrations/                 # External integrations
│   ├── controllers/              # Document lifecycle event handlers
│   ├── firebase/                 # FCM push notifications
│   └── Notifications/            # Notification system
├── services/                     # Business logic services
├── tasks/                        # Scheduled background jobs
├── www/                          # Web routes & pages
│   ├── nirmaan_stack.py         # Boot context API
│   ├── frontend.html            # React app entry (production)
│   └── firebase-messaging-sw.js # Service worker
├── public/frontend/              # Built React app assets
├── fixtures/                     # Seed data (JSON)
├── patches/                      # Database migrations (v1_5 - v2_7)
├── config/                       # App configuration
├── custom/                       # Customizations
├── templates/                    # Jinja templates
├── hooks.py                      # Frappe app hooks
├── install.py                    # Installation scripts
├── populate_target_rates.py      # Rate calculation job
└── patches.txt                   # Migration manifest
```

## Frappe Doctypes (57 Total)

### Procurement Workflow (Core Business Logic)
- **Procurement Requests** - Material requisitions from project teams
- **Procurement Orders** - Purchase orders to vendors
- **Quotation Requests** - RFQs sent to vendors
- **Approved Quotations** - Accepted vendor quotes
- **Selected Quotations** - Chosen quotes for PO generation
- **Sent Back Category** - Rejected PR categories requiring revision
- **Procurement Request Item Detail** - Child table for PR items
- **Purchase Order Item** - Child table for PO items
- **PO Payment Terms** - Payment milestone terms
- **Procurement Packages** - Procurement categorization

### Projects & Planning
- **Projects** - Main project entity (hub for all project data)
- **Project Types** - Project categorization
- **Project Work Packages** - Work breakdown structure
- **Project Work Headers** - Work header entries
- **Project Work Milestones** - Milestone tracking
- **Project Work Package Category Make** - Category-make associations
- **Work Packages** - Master work package definitions
- **Work Headers** - Master work header definitions
- **Work Milestones** - Master milestone definitions
- **Scopes of Work** - Scope definitions
- **Milestones** - Master milestone data
- **Project Estimates** - Budget estimates (BOQ)

### Financial Management
- **Project Payments** - Payments to vendors
- **Project Invoices** - Vendor invoices
- **Project Expenses** - Project-related expenses
- **Project Inflows** - Revenue/cash inflows
- **Non Project Expenses** - Overhead expenses
- **Expense Type** - Expense categorization
- **Target Rates** - Historical rate benchmarks

### Service Requests
- **Service Requests** - Service-based procurement workflow

### Master Data
- **Vendors** - Vendor master with financial balances
- **Vendor Category** - Vendor categorization
- **Customers** - Customer master
- **Items** - Item/product master
- **Category** - Item categorization
- **Makelist** - Item make/brand list
- **Category Makelist** - Category-make associations
- **Category BOQ Attachments** - BOQ document storage
- **Nirmaan Item Units** - Unit of measurement
- **Pincodes** - Geographic data

### User Management & Permissions
- **Nirmaan Users** - Extended user profiles with FCM tokens
- **Nirmaan User Permissions** - Custom project-level permissions

### Documents & Collaboration
- **Nirmaan Attachments** - File attachment system
- **Nirmaan Comments** - Comment system
- **Nirmaan Notifications** - In-app notification storage
- **Nirmaan Versions** - Custom document versioning

### Delivery & Tracking
- **Delivery Note Attachments** - Delivery documentation
- **PR Attachments** - PR-specific attachments
- **Milestone Attachments** - Milestone documentation

### Reporting
- **Project Progress Reports** - Progress tracking
- **Project Progress Report Attachments**
- **Project Progress Report Manpower Details**
- **Project Progress Report Work Milestones**
- **Manpower Reports** - Labor tracking

### Supporting Tables
- **Customer PO Child Table** - Customer PO details
- **Task** - Task management
- **Auto Approval Counter Settings** - Auto-approval logic tracking
- **Map API** - Geolocation services

## Key Backend APIs

### Procurement APIs (`/api/`)
- **`custom_pr_api.py`** - Custom PR creation and resolution
  - `new_custom_pr()` - Create custom procurement requests
  - `resolve_custom_pr()` - Update/resolve custom PRs

- **`approve_vendor_quotes.py`** - PO generation from selected quotes
  - `generate_pos_from_selection()` - Main PO creation logic
  - Handles payment terms, vendor grouping, item aggregation

- **`send_vendor_quotes.py`** - RFQ distribution to vendors
- **`approve_reject_sb_vendor_quotes.py`** - Sent-back quote handling
- **`reject_vendor_quotes.py`** - Quote rejection logic
- **`approve_amend_po.py`** - PO amendment approval
- **`handle_cancel_po.py`** - PO cancellation
- **`po_merge_and_unmerge.py`** - PO consolidation
- **`procurement_orders.py`** - PO helper methods

### Data & Reporting APIs
- **`data-table.py`** (55KB) - Data aggregation for frontend tables
- **`sidebar_counts.py`** - Badge counts for navigation
- **`get_project_reports.py`** - Report generation

### Domain-Specific APIs
- **`projects/`**
  - `new_project.py` - Project creation
  - `add_customer_po.py` - Customer PO linking
  - `project_aggregates.py` - Financial aggregations
  - `project_wise_invoice_data.py` - Invoice analytics

- **`invoices/`** - Invoice data APIs (PO-wise, SR-wise)
- **`payments/`** - Payment processing
- **`delivery_notes/`** - Delivery note updates
- **`vendor/`** - Vendor-specific data (POs, invoices)
- **`customers/`** - Customer financials
- **`target_rates/`** - Historical rate lookups

### Master Data APIs
- **`create_vendor_and_address.py`** - Vendor onboarding
- **`bank_details.py`** - Banking utilities

## Backend Configuration (hooks.py)

### Document Lifecycle Events (`doc_events`)

**Automated Processing on Document Changes:**

```python
"Procurement Requests": {
    "after_insert": "...controllers.procurement_requests.after_insert",
    "on_update": "...controllers.procurement_requests.on_update",
    "on_trash": [...],
    "after_delete": "...controllers.procurement_requests.after_delete"
}
```

**Event Handlers Trigger:**
- **User Creation**: Auto-create `Nirmaan Users` profile when Frappe User created
- **Project Creation**: Auto-generate work milestones and user permissions
- **Vendor Changes**: Auto-generate vendor categories
- **PR/PO/SR Lifecycle**: Comprehensive state management + versioning
- **Versioning**: Amendment tracking for all major documents

### Scheduled Background Jobs (`scheduler_events`)

**Daily Cron Jobs:**
- `populate_target_rates_by_unit()` - Calculate historical rate benchmarks from approved quotations
- `update_payment_term_status()` - Mark payment terms as "Scheduled" when due
- `update_item_status()` - Sync item statuses

### Fixtures (Master Data Seed)

**Auto-imported on installation:**
- Work Packages, Procurement Packages, Categories
- Scopes of Work, Milestones
- Nirmaan-specific Roles and Role Profiles
- Workflows, Workflow States, Workflow Actions
- Print Formats, Portal Menu Items
- Expense Types, Item Units
- Items (Additional Charges category)

### Website Routes

- `/frontend/<path:app_path>` → React SPA (catch-all routing)

## Frontend ↔ Backend Integration

### 1. Boot Context API

**Development Mode:**
```python
# File: www/nirmaan_stack.py
@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
    # Returns full Frappe session boot data
    # Called by frontend: http://localhost:8000/api/method/nirmaan_stack.www.nirmaan_stack.get_context_for_dev
```

**Production Mode:**
- Frontend receives `window.frappe.boot` injected into `www/frontend.html`
- Contains user session, permissions, site config, system settings

### 2. REST API Pattern

Frontend uses `frappe-react-sdk` which abstracts:
- `frappe.client.get_list` ← `useFrappeGetDocList()`
- `frappe.client.get` ← `useFrappeGetDoc()`
- `frappe.client.insert` ← `useFrappeCreateDoc()`
- `frappe.client.set_value` ← `useFrappeUpdateDoc()`
- `frappe.client.delete` ← `useFrappeDeleteDoc()`
- Custom `@frappe.whitelist()` methods ← `useFrappePostCall()` / `useFrappeGetCall()`

### 3. Socket.IO Real-time Updates

**Backend Event Publishing:**
```python
frappe.publish_realtime(
    event="pr:new",           # Custom event name
    message={...},            # Event payload
    user=user['name']         # Targeted delivery
)
```

**Event Types Published by Backend:**
- `pr:new`, `pr:approved`, `pr:rejected`, `pr:vendorSelected`, `pr:delete`
- `po:amended`, `po:new`, `po:delete`
- `sr:vendorSelected`, `sr:approved`, `sr:delete`, `sr:amended`
- `payment:new`, `payment:approved`, `payment:fulfilled`, `payment:delete`
- `sb:vendorSelected`, `Rejected-sb:new`, `Delayed-sb:new`, `Cancelled-sb:new`

**Frontend Listener:** Frontend's `SocketInitializer.tsx` subscribes to these events

### 4. Firebase Cloud Messaging

**Setup:** `integrations/firebase/firebase_admin_setup.py`

**Flow:**
1. Backend stores FCM tokens in `Nirmaan Users.fcm_token`
2. Backend sends push notifications via `PrNotification()` helper
3. Frontend service worker handles background notifications
4. Configurable per-user via `push_notification` field

### 5. File Upload System

**Storage:** Frappe's native file attachment system

**Tracking:** `Nirmaan Attachments` doctype
- Fields: `project`, `associated_doctype`, `associated_docname`, `attachment_type`, `attachment` (file URL)
- Used for: PRs, POs, delivery notes, BOQs, invoices, payments, milestones

**Frontend Upload:** Uploads to `/api/method/upload_file`

## Backend Business Logic Highlights

### Auto-Approval Algorithm
**File:** `integrations/controllers/procurement_requests.py`

**Logic:**
1. **Immediate Auto-Approve:** If total PR value < ₹5,000
2. **Conditional Auto-Approve (with vendors selected):**
   - If total PO value < ₹20,000
   - AND it's not the 8th consecutive auto-approval
   - → Auto-approve AND generate PO
   - Counter resets after 8th approval (forces manual review)

### Historical Rate Calculation
**File:** `populate_target_rates.py`

**Algorithm:**
- Fetch approved quotations per item-unit combination
- **Single quote in last 3 months:** Use that rate
- **Multiple quotes in last 3 months:** Weighted average by quantity
- **No recent quotes:** Use latest historical quote
- Creates `Target Rates` records for frontend reference
- Runs daily via scheduler

### Workflow State Management

**PR Workflow States:**
- Pending → Approved → Vendor Selected → Vendor Approved → Closed
- Also: Rejected, Cancelled, Partially Approved

**Controlled By:**
- Frappe Workflow engine (configured in fixtures)
- Custom Python logic in `integrations/controllers/`
- Auto-transitions based on business rules

## Database Schema Patterns

### Field Type Strategy

1. **JSON Fields** - Flexible/evolving data structures
   - `procurement_list`, `category_list`, `rfq_data` in PRs
   - `project_work_packages`, `project_scopes` in Projects
   - `vendor_category` in Vendors

2. **Child Tables** - Normalized relational data
   - `order_list` (PR items) - modern approach
   - `payment_terms` (PO payment milestones)
   - `project_work_header_entries`

3. **Link Fields** - Foreign key relationships
   - `project` → Projects
   - `vendor` → Vendors
   - `vendor_address` → Address (Frappe core)

4. **Dynamic Links** - Polymorphic relationships
   - `Project Payments.document_type` + `document_name` (links to PO or SR)

### Doctype Relationship Flow

```
Projects (hub)
  ├─→ Procurement Requests
  │     ├─→ Quotation Requests
  │     │     └─→ Approved Quotations
  │     └─→ Procurement Orders
  │           ├─→ Delivery Notes
  │           ├─→ Project Invoices
  │           └─→ Project Payments
  │
  ├─→ Service Requests
  │     ├─→ Project Invoices
  │     └─→ Project Payments
  │
  ├─→ Project Estimates (BOQ)
  ├─→ Project Expenses
  └─→ Project Inflows
```

## Backend Architectural Decisions

### 1. Hybrid Data Storage
- **Child Tables:** Structured, queryable data (items, payment terms)
- **JSON Fields:** Flexible, UI-driven data (categories, RFQ metadata)
- **Migration Path:** Old PRs had `procurement_list` (JSON) → migrated to `order_list` (child table)

### 2. Permissions Model
- **Frappe Roles:** Standard role-based access control (RBAC)
- **Custom Permissions:** `Nirmaan User Permissions` for project-level isolation
- **Document-Level:** Workflow states control who can act on documents

### 3. Three-Channel Notification System
1. **In-app:** `Nirmaan Notifications` doctype (persistent storage)
2. **Real-time:** Socket.IO events (instant updates)
3. **Push:** Firebase Cloud Messaging (mobile/browser notifications)

### 4. Version Control Strategy
- Extensive use of Frappe's native `Version` doctype
- Custom `Nirmaan Versions` for business-specific tracking
- Audit trail for all critical documents (PRs, POs, SRs, estimates, payments)

### 5. Multi-tenancy Support
- Leverages Frappe's site-based multi-tenancy
- Each site = isolated database
- No custom multi-tenant logic required

### 6. Event-Driven Architecture
- Document lifecycle hooks trigger business logic
- Controllers separated from doctype files for better organization (`integrations/controllers/`)
- Real-time event publishing on state changes

## Backend Code Organization

### Naming Conventions
- **Doctypes:** CamelCase with spaces (e.g., `Procurement Requests`)
- **Python modules:** snake_case (e.g., `procurement_requests.py`)
- **API methods:** snake_case (e.g., `new_custom_pr`)
- **Follows Frappe conventions strictly**

### Controller Pattern
Each doctype has optional Python controller:
```
nirmaan_stack/doctype/procurement_requests/
  ├── procurement_requests.json        # Schema definition
  ├── procurement_requests.py          # Controller class (optional)
  ├── procurement_requests.js          # Client-side hooks (optional)
  └── test_procurement_requests.py     # Unit tests (optional)
```

**Controller Methods:**
- `validate()` - Pre-save validation
- `before_insert()`, `after_insert()` - Insert hooks
- `on_update()`, `before_save()` - Update hooks
- `on_trash()`, `after_delete()` - Delete hooks

### API Pattern
All frontend-facing methods use:
```python
@frappe.whitelist()
def method_name(param1, param2):
    # Business logic
    return {"message": "Success", "data": {...}}
```

**Common Patterns:**
- JSON parameter handling (accept both string and parsed)
- Transaction management (`frappe.db.begin()`, `frappe.db.commit()`, rollback on error)
- Permission bypass when needed (`ignore_permissions=True`)
- Error logging (`frappe.log_error()`)
- Standardized response format

## Common Development Tasks

### Creating a New Doctype

1. Create new doctype via Desk or CLI:
```bash
bench new-doctype "My Doctype"
```

2. Define fields in the JSON schema or via Desk UI
3. Add Python controller if business logic needed
4. Add to `hooks.py` if event handlers needed
5. Run migration:
```bash
bench migrate
```

### Adding a New API Endpoint

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

2. Frontend calls via:
```typescript
useFrappePostCall('nirmaan_stack.api.my_endpoint.my_method')
```

### Adding Document Lifecycle Hooks

1. Create handler in `integrations/controllers/`:
```python
# integrations/controllers/my_doctype.py
import frappe

def after_insert(doc, method):
    # Logic after document creation
    pass
```

2. Register in `hooks.py`:
```python
doc_events = {
    "My Doctype": {
        "after_insert": "nirmaan_stack.integrations.controllers.my_doctype.after_insert"
    }
}
```

### Adding Scheduled Task

1. Create task function in `tasks/`:
```python
# tasks/my_task.py
import frappe

def my_scheduled_task():
    # Task logic
    pass
```

2. Register in `hooks.py`:
```python
scheduler_events = {
    "daily": [
        "nirmaan_stack.tasks.my_task.my_scheduled_task"
    ]
}
```

### Publishing Real-time Events

```python
frappe.publish_realtime(
    event="custom:event_name",
    message={"data": "value"},
    user=user_id  # Optional: target specific user
)
```

Frontend listens via Socket.IO in `SocketInitializer.tsx`

## Important Notes

- **Frappe Framework Required**: This is a Frappe app, not a standalone Python application
- **Multi-tenancy**: Each site is isolated; use `frappe.get_site()` for site-specific logic
- **Permissions**: Respect role permissions; use `frappe.has_permission()` checks
- **Transactions**: Always use `frappe.db.commit()` after DB operations in whitelisted methods
- **Error Handling**: Use `frappe.throw()` for user-facing errors, `frappe.log_error()` for logging
- **Testing**: Run tests before committing changes
- **Migrations**: Document DB changes in patches under `patches/`
- **Frontend Integration**: Frontend at `frontend/` directory, builds to `public/frontend/`
- **Real-time Events**: Publish Socket.IO events for frontend updates
- **Rate Limiting**: Consider rate limiting for public APIs

## Backend Summary

The Nirmaan Stack backend is a **comprehensive construction ERP** built on Frappe Framework v15+ featuring:

- ✅ **57 custom doctypes** organized around procurement, projects, financials, master data
- ✅ **Sophisticated procurement workflow** with auto-approval, RFQ management, PO generation
- ✅ **Real-time collaboration** via Socket.IO and Firebase push notifications
- ✅ **Flexible data modeling** mixing child tables, JSON fields, and links
- ✅ **Automated workflows** for approvals, versioning, notifications
- ✅ **Financial tracking** for payments, invoices, expenses, inflows
- ✅ **Role-based access control** with project-level permissions
- ✅ **30+ whitelisted APIs** for frontend consumption
- ✅ **Scheduled background jobs** for rate calculations and status updates
- ✅ **Event-driven architecture** with document lifecycle hooks
- ✅ **Well-structured** following Frappe best practices

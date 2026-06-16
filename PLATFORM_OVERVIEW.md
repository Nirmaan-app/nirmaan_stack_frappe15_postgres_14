# Nirmaan Stack — Platform Overview

> A comprehensive reference document covering what the platform does, how it is built, its modules, and how they depend on each other.

---

## Table of Contents

1. [What is Nirmaan Stack?](#1-what-is-nirmaan-stack)
2. [Technology Stack](#2-technology-stack)
3. [System Architecture](#3-system-architecture)
4. [User Roles & Access Control](#4-user-roles--access-control)
5. [Module Overview](#5-module-overview)
6. [Module Deep Dives](#6-module-deep-dives)
   - [Projects](#61-projects)
   - [Procurement](#62-procurement)
   - [Service Requests (Work Orders)](#63-service-requests-work-orders)
   - [Delivery Challans & MIRs](#64-delivery-challans--mirs)
   - [Payments & Financials](#65-payments--financials)
   - [Material Usage Tracking](#66-material-usage-tracking)
   - [Design Tracking](#67-design-tracking)
   - [Progress Reporting](#68-progress-reporting)
   - [Vendors & Master Data](#69-vendors--master-data)
   - [Notifications & Collaboration](#610-notifications--collaboration)
   - [Users & Permissions](#611-users--permissions)
7. [Cross-Module Dependency Map](#7-cross-module-dependency-map)
8. [Data Flow: End-to-End Procurement](#8-data-flow-end-to-end-procurement)
9. [Background Jobs & Automation](#9-background-jobs--automation)
10. [Notification Architecture](#10-notification-architecture)
11. [Reports Module](#11-reports-module)

---

## 1. What is Nirmaan Stack?

**Nirmaan Stack** is a construction project management and procurement ERP. It is purpose-built for construction companies that need to manage multiple live projects simultaneously — handling everything from raising a material request on site, to getting vendor quotes, placing purchase orders, receiving materials, tracking payments, and monitoring project progress.

### Core Problem It Solves

Construction companies operate across many sites at once. Each site needs materials and services from many vendors, with multiple teams involved (site leads, procurement, accounts, management). Without a centralized system:
- Purchase decisions lack pricing benchmarks
- Payments get made without proper approval trails
- Deliveries are not tracked against what was ordered
- Management has no real-time visibility into project finances or progress

Nirmaan Stack centralises all of this into a single platform accessible by all teams simultaneously.

### What It Covers

| Domain | What it handles |
|---|---|
| **Procurement** | Material requests → vendor quotes → purchase orders |
| **Service Requests** | Contractor/labour work orders |
| **Projects** | Budget, status, zones, estimates, financial summary |
| **Deliveries** | Delivery Challans (DCs) and Material Inspection Reports (MIRs) |
| **Payments** | PO payment milestones, project payments, invoices |
| **Design** | Design phase tasks and tracking |
| **Progress** | Site progress reports with photos and manpower |
| **Reporting** | Cross-project financial and operational reports |

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend framework** | Frappe v15+ (Python 3.10+) | ORM, document model, API routing, workflow engine |
| **Database** | PostgreSQL v14.11 | Persistent data storage |
| **Cache** | Redis | API response caching, session management |
| **Frontend** | React 18 + TypeScript | Single-page application UI |
| **Real-time** | Socket.IO | Instant UI updates when documents change |
| **Push notifications** | Firebase Cloud Messaging (FCM) | Mobile push notifications |
| **File storage** | Frappe file system | Attachment storage (PDFs, images) |

### How the Layers Interact

```
Browser (React SPA)
       │
       │  REST API calls (frappe.call / useFrappePostCall)
       │  Real-time events (Socket.IO)
       ▼
Frappe Backend (Python)
       │
       ├── PostgreSQL (data)
       ├── Redis (cache)
       └── Firebase (push)
```

The React frontend is a single-page app served from `frontend.html`. It communicates with the backend exclusively through whitelisted Python API functions. There is no direct database access from the frontend.

---

## 3. System Architecture

### Backend Structure

```
nirmaan_stack/
├── doctype/          84 custom doctypes (data models)
├── api/              35+ whitelisted API endpoint files
├── integrations/
│   ├── controllers/  Document lifecycle hooks (on create, update, delete)
│   ├── firebase/     Push notification setup
│   └── Notifications/ Notification helper functions
├── tasks/            Scheduled background jobs (run daily)
├── patches/          Database migration scripts (v1.5 → v3.0)
├── fixtures/         Seed data (roles, workflows, categories)
├── www/              Web route entry point (serves React app)
└── hooks.py          App configuration: event wiring, scheduler
```

### Key Architectural Principles

**1. Doctypes as the data model**
Everything in the system is a "Doctype" — Frappe's equivalent of a database table with a defined schema. There are 84 custom doctypes. Each one maps to a database table.

**2. Lifecycle hooks for business logic**
When a document is created, updated, or deleted, Frappe fires events. Nirmaan hooks into these events in `integrations/controllers/` to run business logic — sending notifications, updating related records, triggering approvals. This keeps doctype files clean and logic centralised.

**3. Whitelisted APIs for complex operations**
For operations that span multiple doctypes (e.g., generating purchase orders from selected quotes), dedicated Python API functions in `api/` are called directly from the frontend. These are decorated with `@frappe.whitelist()`.

**4. Child Tables vs JSON Fields**
- **Child Tables**: Used when rows need to be individually queried or filtered (e.g., PO line items, payment terms)
- **JSON Fields**: Used for flexible, UI-driven data that is always read as a whole (e.g., RFQ metadata, service order details)

### Frontend Structure

```
frontend/src/
├── pages/            One directory per major feature/module
│   ├── projects/     Project detail, material usage, milestones
│   ├── procurement/  PR, PO, RFQ pages
│   ├── DeliveryChallansAndMirs/
│   ├── reports/
│   └── ...
├── components/       Shared UI components
├── types/            TypeScript interfaces mirroring doctypes
└── hooks/            Shared React hooks for data fetching
```

---

## 4. User Roles & Access Control

### Role Profiles

| Role | Typical User | Key Capabilities |
|---|---|---|
| **Nirmaan Admin** | System administrator | Full access to everything |
| **PMO Executive** | Project management office | Project management, approvals |
| **Project Lead** | Site/project manager | PR creation, progress reports, material tracking |
| **Project Manager** | Senior site manager | Similar to Project Lead |
| **Procurement Executive** | Procurement team | PR/PO/RFQ management, vendor coordination |
| **Accountant** | Finance team | Payments, invoices, financial reports |
| **Estimates Executive** | Estimation team | BOQ, target rates, material usage |
| **Design Lead / Executive** | Design team | Design tracker tasks |
| **HR Executive** | HR team | Read-only access to relevant data |

### Two-Level Access Control

**1. Role-based:** Roles determine which pages and actions a user can access. Enforced in both frontend (UI visibility) and backend (API validation).

**2. Project-level permissions:** The `Nirmaan User Permissions` doctype assigns users to specific projects. A Project Lead, for example, will only see their own projects in dropdowns and lists.

### Special Cases
- **CEO Hold** on a project can only be set/unset by one specific user (`nitesh@nirmaan.app`) — this is not role-based, it is hardcoded by email.
- **Administrator** is a special system user with a non-email name. It must be handled explicitly in user management operations.

---

## 5. Module Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          PROJECTS                                │
│              (Central hub — everything links here)              │
└────────────────────────────┬─────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  PROCUREMENT          SERVICE REQUESTS      DESIGN TRACKING
  (Materials)          (Services/Labour)     (Design phase)
        │
        ▼
   PO DELIVERY
  (DCs & MIRs)
        │
        ▼
  PAYMENTS &
  FINANCIALS
        │
        ▼
  MATERIAL USAGE
  (Tracking & Reports)
```

All modules either belong to a project or reference one. Projects are the root of everything.

---

## 6. Module Deep Dives

### 6.1 Projects

**What it is:** The central record in the system. Every PR, PO, payment, delivery, and report links back to a project.

**Key data on a project:**
- Name, customer, project type, start date
- Project value and customer PO details
- Zones (physical areas of the construction site)
- Google Drive links
- Status (Created → WIP → Completed / Halted / CEO Hold)
- Financial summary (aggregated from linked payments, invoices, inflows)

**Project statuses and their effects:**

| Status | Meaning | Effects |
|---|---|---|
| **Created** | Just set up, not yet active | Set automatically on creation; cannot be reassigned |
| **WIP** | Active, work in progress | Normal operations |
| **Completed** | Work done | Hidden from most dropdowns; financials still recordable |
| **Halted** | Paused | Hidden from most dropdowns; Design Tracker creation blocked |
| **CEO Hold** | Management hold | Full operational block; restricted to one authorized user |

**Dependencies:**
- All other modules (Procurement, Payments, Service Requests, Design, Progress) depend on Projects as a foreign key
- `Project Estimates` provides the BOQ (Bill of Quantities) used by the Material Usage tab for comparison

---

### 6.2 Procurement

**What it is:** The largest and most complex module. Manages the full lifecycle of purchasing materials for a project.

**The full workflow:**

```
1. PR Created         → Site team requests materials
2. PR Approved        → Management approves the request
3. RFQ Sent           → Quotes requested from multiple vendors
4. Quotes Received    → Vendors submit prices
5. Quote Selected     → Best quotes chosen per item/vendor
6. PO Generated       → One Purchase Order created per vendor
7. PO Dispatched      → Vendor ships goods
8. DC/MIR Created     → Delivery recorded on site (see Module 6.4)
9. Invoice Raised     → Vendor raises invoice
10. Payment Made      → Payment processed
```

**Key doctypes:**

| Doctype | Role |
|---|---|
| **Procurement Requests (PR)** | The material request. Contains a list of items needed. |
| **Quotation Requests (RFQ)** | Sent to vendors to collect pricing |
| **Approved Quotations** | Accepted price per item-vendor combination |
| **Selected Quotations** | Child table tracking which quotes were chosen |
| **Procurement Orders (PO)** | The actual purchase order. One per vendor. |
| **PO Payment Terms** | Payment milestones on each PO (e.g., 30% on delivery) |
| **Sent Back Category** | When a PR category is rejected, it enters this re-approval loop |

**PR States:**
`Pending` → `Approved` → `Vendor Selected` → `Vendor Approved` → `Partially Approved` / `Rejected` / `Cancelled` / `Closed`

**PO States:**
`Draft` → `Submitted` → `Partially Dispatched` → `Dispatched` → `Partially Delivered` → `Delivered` → `Amended` / `Cancelled`

**Auto-approval rules:**
- PRs under **₹5,000** are auto-approved instantly on creation
- POs under **₹20,000** (with vendors already selected) are auto-approved — but only up to 8 consecutive auto-approvals; the 9th is forced to manual review

**Sent Back flow:**
If a specific category within a PR is rejected (not the whole PR), a `Sent Back Category` record is created. The requestor must revise and resubmit just that category, which then goes through its own separate approval flow.

**PO amendments:**
POs can be amended after submission (e.g., price changes, quantity adjustments). Low-impact amendments (minor changes) can auto-approve. Higher-impact amendments require manual approval. Payment terms are adjusted using LIFO (Last In, First Out) logic.

**Dependencies:**
- Requires: Projects, Vendors, Items, Categories
- Feeds: PO Delivery Documents, Project Payments, Project Invoices, Approved Quotations (→ Target Rates)

---

### 6.3 Service Requests (Work Orders)

**What it is:** The equivalent of procurement but for services — contractors, labour, specialist work. Called "Work Orders" in the UI.

**Key difference from Procurement:** Service Requests have no RFQ or quotation process. A service order is created directly with a vendor and amount.

**States:** `Pending` → `Approved` → `Rejected` / `Cancelled`

**Finalization:**
Once approved, a Service Request can be "finalized" — this locks it from editing or deletion. Only Admin, PMO, Project Lead, or the original creator can finalize. Only Admin/PMO/PL can revert a finalization.

**SR Remarks:**
Role-based commenting system. Each role's comments are tagged (accountant_remark, procurement_remark, admin_remark). System-generated audit comments (for finalize/revert actions) are marked undeletable.

**Dependencies:**
- Requires: Projects, Vendors
- Feeds: Project Payments (service payments)

---

### 6.4 Delivery Challans & MIRs

**What it is:** Site-level delivery tracking. Records what materials actually arrived and whether they passed inspection.

**Two document types (both stored in `PO Delivery Documents`):**

| Type | Purpose | When created |
|---|---|---|
| **Delivery Challan (DC)** | Records what was physically delivered | When goods arrive on site |
| **Material Inspection Report (MIR)** | Records that delivered goods were inspected and accepted | After goods are checked |

**Each document records:**
- Which PO it belongs to
- Which items were delivered (subset of PO items)
- Quantity per item
- Reference number (from vendor's paperwork)
- Date
- Whether the client representative signed off
- A file attachment (PDF or photo of the physical document)
- For MIRs: which DC it corresponds to

**Important rule:** DCs and MIRs can only be created for POs that are in `Partially Dispatched`, `Partially Delivered`, or `Delivered` status.

**Stub documents:**
When the system migrated from an older attachment-only system, legacy records were imported as "stubs" (`is_stub = 1`) — they have the file but no item-level data. These are flagged in the UI with an "Items not recorded" warning and an "Update" button to prompt staff to fill in the missing details.

**MIR quantity mode:**
MIRs support a "just list items" mode where quantities are optional — useful when an inspector wants to log which items were checked without recording exact counts.

**Dependencies:**
- Requires: Procurement Orders (must be dispatched/delivered)
- Feeds: Material Usage tab (DC and MIR quantities per item), DC/MIR Reports

---

### 6.5 Payments & Financials

**What it is:** Tracks all money movement related to projects — outgoing (vendor payments), incoming (client payments), and overhead.

**Four financial record types:**

| Doctype | What it tracks |
|---|---|
| **Project Payments** | Payments made to vendors against POs or SRs |
| **Project Invoices** | Invoices received from vendors |
| **Project Inflows** | Payments received from the client |
| **Non Project Expenses** | Company overhead not tied to a specific project |

**PO Payment Terms:**
Each PO can have payment milestone terms (e.g., "30% advance, 40% on delivery, 30% on completion"). These are child table rows on the PO. When a Project Payment is created, the system automatically links it to the right payment term and advances its status.

**Payment term status lifecycle:**
`Created` → `Scheduled` (when due date is reached, via daily job) → `Approved` (when payment is approved) → `Paid` (when payment is marked paid)

If a payment is deleted, the linked term automatically reverts to its previous status.

**PO Adjustments:**
A separate reconciliation system (`PO Adjustments`) handles double-entry accounting for payment discrepancies. When a PO is revised (amended), an adjustment record is auto-created to track the financial difference. Manual resolution is also supported.

**Dependencies:**
- Requires: Projects, Procurement Orders, Service Requests, Vendors
- Feeds: Project financial summaries, PO payment term status

---

### 6.6 Material Usage Tracking

**What it is:** A per-project view that aggregates all material data into a single table — what was estimated, what was ordered, what arrived, and what was paid for.

**Two views:**
- **Item Wise:** One row per material item. Shows quantities and status across all POs.
- **PO Wise:** Grouped by Purchase Order. Expandable to see items within each PO.

**Columns per item:**

| Column | Source |
|---|---|
| Estimated Qty | Project Estimates (BOQ) |
| Ordered Qty | PO items |
| Delivered Qty | PO received_quantity field |
| DC Qty | Delivery Challans |
| MIR Qty | Material Inspection Reports |
| Remaining Qty | Remaining Items Report (high-value items only, >₹5,000) |
| Amount | PO item total |
| Delivery Status | Calculated: Fully / Partially / Pending / Not Ordered |
| Payment Status | Calculated from Project Payments |

**Orphan detection:** Items that appear in a DC or MIR but have no matching PO line item are flagged — this indicates a data inconsistency.

**Dependencies:**
- Requires: Projects, Procurement Orders, Project Estimates, PO Delivery Documents, Project Payments, Remaining Items Reports

---

### 6.7 Design Tracking

**What it is:** Tracks the design phase of a project — design tasks, deadlines, categories, and assigned designers.

**Structure:**
- **Design Tracker Categories** define the types of design work (e.g., structural, electrical)
- **Design Tracker Tasks** define specific tasks within each category
- **Project Design Tracker** is the per-project instance, with a status and phase
- Tasks within a tracker have deadlines, assigned designers, and completion status

**Restriction:** Design Trackers cannot be created for projects in `Halted`, `Completed`, or `CEO Hold` status.

**Dependencies:**
- Requires: Projects, Users (for assignment)

---

### 6.8 Progress Reporting

**What it is:** Site teams submit daily or periodic progress reports documenting what work was done, how many workers were present, and which milestones were completed.

**A progress report includes:**
- Report date and status
- **Manpower details:** Labour count by category (e.g., mason, helper, electrician)
- **Milestone status:** Which work milestones were completed, their progress percentage
- **Attachments:** Photos from site

**Work milestone hierarchy:**
```
Work Packages → Work Headers → Work Milestones → Scopes of Work → Milestones
```

This hierarchy defines the full breakdown of construction work. Project Work Milestones track the per-project status of each milestone.

**Manpower Reports:** A separate, more flexible report type using a JSON field for labour tracking data.

**Dependencies:**
- Requires: Projects, Work Packages/Milestones master data

---

### 6.9 Vendors & Master Data

**What it is:** The reference data that the rest of the system depends on.

**Key master data doctypes:**

| Doctype | What it stores |
|---|---|
| **Vendors** | Vendor profiles: name, city, GST number, categories they supply |
| **Customers** | Client companies: name, GST, contact details |
| **Items** | Material catalogue: item name, category, unit, current status |
| **Categories** | Item categories with tax rates and procurement package links |
| **Target Rates** | Historical benchmark prices per item (auto-calculated daily) |
| **Nirmaan Item Units** | Units of measurement (kg, m², bags, etc.) |
| **Pincodes** | Geographic data for address entry |
| **Expense Types** | Categories for expenses (project vs. non-project) |

**Target Rates (Pricing Intelligence):**
A daily background job calculates weighted average prices for each item based on the last 3 months of approved quotations. These serve as benchmarks when evaluating new vendor quotes.

**Item status rules:**
Items are automatically marked Active or Inactive based on their quote history. An item with no quotes and created more than 1 month ago is marked Inactive. An item with recent purchase history stays Active.

**Dependencies:**
- Vendors, Items, and Categories are prerequisites for Procurement
- Target Rates depend on Approved Quotations (generated by procurement)

---

### 6.10 Notifications & Collaboration

**What it is:** The system that keeps all users informed of relevant events in real time.

**Three notification channels:**

```
Document Event (e.g., PR approved)
           │
    ┌──────┼──────┐
    ▼      ▼      ▼
Firebase  In-App  Socket.IO
(mobile   (stored  (real-time
 push)    in DB)   UI update)
```

| Channel | Technology | Persistence | Use Case |
|---|---|---|---|
| **Firebase FCM** | Firebase Cloud Messaging | No | Mobile push when app is in background |
| **Nirmaan Notifications** | Stored in DB | Yes | In-app notification centre (bell icon) |
| **Socket.IO** | Real-time WebSocket | No | Live page updates without refresh |

**Events that trigger notifications:**

| Event | Who is notified |
|---|---|
| PR created | Procurement team + management |
| PR approved | Project lead |
| PR rejected | Requestor |
| PO created | Procurement + accountants |
| PO amended | Project leads |
| Payment created/approved | Admins, accountants |
| Service Request changes | Relevant role |

**Collaboration tools:**
- **Nirmaan Comments:** Threaded comments on any document
- **Nirmaan Attachments:** File attachments linked to any document
- **Nirmaan Versions:** Full audit trail — every state change on a document is recorded with before/after snapshots

**Dependencies:**
- Triggered by all major modules (Procurement, Payments, Service Requests)
- Requires: Users (for routing notifications to the right person)

---

### 6.11 Users & Permissions

**What it is:** User management extending Frappe's built-in User system with Nirmaan-specific fields and project-level access control.

**Two-layer user model:**

| Layer | Doctype | Purpose |
|---|---|---|
| Frappe User | `User` (core) | Authentication, login, password |
| Nirmaan User | `Nirmaan Users` | Role profile, FCM token, project assignment flag |

The two are always kept in sync. Creating a Frappe User auto-creates a Nirmaan User. Deleting a Nirmaan User cascades to delete the Frappe User.

**Project-level access:**
`Nirmaan User Permissions` records define which projects a user can see and operate on. A Project Lead assigned to Project A cannot see Project B's data in any list or dropdown.

**Role profiles (not Frappe's built-in roles):**
Nirmaan uses its own `role_profile` field on `Nirmaan Users` rather than relying solely on Frappe's permission system. This is checked in backend API validation.

**User creation pattern:**
User creation and email sending are separated — the user record is always created first, and the welcome email is attempted separately. This prevents email server failures from blocking user creation.

**Dependencies:**
- Required by all modules (every document has an owner)
- Project-level permissions affect all list views and dropdowns

---

## 7. Cross-Module Dependency Map

```
Master Data (Vendors, Items, Categories, Customers)
         │
         │ required by
         ▼
      PROJECTS ◄────────────────────────────────────────────┐
         │                                                  │
    ┌────┼────────────────────────────────┐                 │
    │    │                                │                 │
    ▼    ▼                                ▼                 │
PROCUREMENT    SERVICE REQUESTS      DESIGN TRACKER         │
    │               │                    │                  │
    │               │                    │ all link to ─────┘
    ▼               │
PO DELIVERY DOCS    │
    │               │
    └───────┬───────┘
            │
            ▼
     PROJECT PAYMENTS
     PROJECT INVOICES
     PROJECT INFLOWS
            │
            ▼
     FINANCIAL REPORTS
     MATERIAL USAGE

PROGRESS REPORTS ──────────── depends on → PROJECTS + MILESTONES MASTER

NOTIFICATIONS ─────────────── triggered by → ALL MODULES

AUDIT TRAIL (Nirmaan Versions) triggered by → ALL MODULES

TARGET RATES ──────────────── calculated from → APPROVED QUOTATIONS (Procurement)
```

---

## 8. Data Flow: End-to-End Procurement

This is the most complex flow in the system. Here is how a material purchase moves through end-to-end:

```
Step 1: PR CREATION
  Site team creates Procurement Request
  → Items listed with quantities and categories
  → If total < ₹5,000: auto-approved instantly
  → Otherwise: enters approval queue

Step 2: PR APPROVAL
  Management approves the PR
  → Status: Pending → Approved
  → Notification sent to procurement team

Step 3: RFQ
  Procurement sends Quotation Requests to vendors
  → One RFQ per vendor per category
  → Vendors submit prices

Step 4: QUOTE SELECTION
  Procurement reviews and selects best quotes
  → Selected Quotations child table updated
  → Status: Approved → Vendor Selected

Step 5: PO GENERATION
  generate_pos_from_selection() API called
  → Groups selected quotes by vendor
  → Creates one Procurement Order per vendor
  → Each PO has payment terms (milestones)
  → If PO total < ₹20,000: auto-approved (up to 8 consecutive)
  → PR status: Vendor Selected → Vendor Approved

Step 6: DISPATCH & DELIVERY
  Vendor ships materials
  → PO status: Submitted → Partially Dispatched → Dispatched

Step 7: DC CREATION
  Materials arrive on site
  → Delivery Challan created against the PO
  → Items and quantities recorded
  → File attachment uploaded
  → PO status: → Partially Delivered → Delivered

Step 8: MIR CREATION
  Materials inspected
  → Material Inspection Report created
  → Links back to the DC
  → Client sign-off recorded

Step 9: INVOICE
  Vendor raises invoice
  → Project Invoice recorded against PO

Step 10: PAYMENT
  Finance team processes payment
  → Project Payment created
  → Linked to PO payment term automatically
  → Payment term status: Scheduled → Approved → Paid

Step 11: TARGET RATE UPDATE (nightly)
  Daily job recalculates benchmark prices
  → Approved Quotation data → weighted average → Target Rates
  → Used for future quote comparison
```

---

## 9. Background Jobs & Automation

Three scheduled jobs run daily:

| Job | What it does |
|---|---|
| `populate_target_rates_by_unit` | Calculates weighted average item prices from last 3 months of approved quotes. Used as pricing benchmarks. |
| `update_payment_term_status` | Scans all PO payment terms. Any term whose due date has passed is moved from "Created" to "Scheduled". |
| `update_item_status` | Marks items as Active or Inactive based on their quote and purchase history. |

---

## 10. Notification Architecture

Every significant document event fires all three notification channels simultaneously. The backend hook:

1. Saves the document change (`frappe.db.commit()` called first to avoid race conditions)
2. Creates a `Nirmaan Notifications` record (persistent, shows in notification bell)
3. Sends Firebase push to the relevant user's FCM token (mobile)
4. Calls `frappe.publish_realtime()` with a structured event (Socket.IO — instant UI update)

**Event naming convention:** `{doctype}:{action}` — e.g., `pr:approved`, `po:new`, `payment:fulfilled`

**Events catalogue:**

| Module | Events |
|---|---|
| Procurement Requests | `pr:new`, `pr:vendorSelected`, `pr:approved`, `pr:rejected`, `pr:delete` |
| Procurement Orders | `po:new`, `po:amended`, `po:delete` |
| Service Requests | `sr:vendorSelected`, `sr:amended`, `sr:approved`, `sr:delete` |
| Sent Back Category | `{type}-sb:new`, `sb:vendorSelected`, `sb:delete` |
| Project Payments | `payment:new`, `payment:approved`, `payment:fulfilled`, `payment:delete` |

---

## 11. Reports Module

**What it is:** A cross-project reporting hub that gives management, finance, and procurement teams visibility into financial performance, vendor activity, procurement status, delivery tracking, and inventory — all in one place.

The Reports module is organised into **5 tabs**, each focused on a different operational domain. Access to tabs and individual reports is role-controlled.

---

### Tab Overview

| Tab | Focus | Who can access |
|---|---|---|
| **Projects** | Project-level financials and progress | Admin, PMO, Accountant, Project Lead, PM*, Procurement Executive* |
| **Vendors** | Vendor financial ledger | Admin, PMO, Accountant, Project Lead |
| **PO** | Purchase order status, invoicing, delivery reconciliation | Admin, PMO, Accountant, PM, Procurement Executive, Project Lead |
| **WO** (Work Orders) | Service request invoicing and payment tracking | Admin, PMO, Accountant, Procurement Executive, Project Lead |
| **DCs & MIRs** | Delivery Challan and MIR audit across all projects | Admin, PMO, Accountant, PM, Procurement Executive, Project Lead |

*PM and Procurement Executive have restricted access within some tabs (see below).

---

### Projects Tab (6 reports)

#### 1. Cash Sheet
The primary financial health report. One row per project showing:
- Total project value vs. amount invoiced to client
- Total inflows (money received) vs. total outflows (payments made)
- Current liabilities and cashflow gap
- PO value and SR value

**Used by:** Management for high-level financial review across all active projects.

#### 2. Inflow Report
All client payments received across projects, with date, amount, project, and customer. Filterable by date range, project, and customer.

#### 3. Outflow Report (Project)
All vendor payments and project expenses. Broken into two sub-views:
- **Project outflows:** Payments tied to specific projects
- **Non-project outflows:** Company overhead expenses not tied to any project

#### 4. Project Progress Report
Shows milestone completion status across active projects. Used by PMO to track construction progress at a high level.

#### 5. Inventory Report
Cross-project inventory showing materials on hand with max PO quote rates for cost estimation. Accessible to all roles including PM and Procurement Executive (in fact, these roles see *only* this report in the Projects tab).

---

### Vendors Tab (1 report)

#### Vendor Ledger
A financial summary per vendor across all projects:
- Total PO value (materials)
- Total SR/WO value (services)
- Total invoiced
- Total paid
- Balance payable (what is still owed)

**Used by:** Finance team to manage vendor payables.

---

### PO Tab (6 reports)

#### 1. Pending Invoices
POs that have been delivered but where the invoice has not yet been fully raised. Specifically: POs where `Amount Paid − Invoice Amount > ₹100`. Flags where vendor invoices are outstanding.

#### 2. PO with Excess Payments
POs where payments exceed the total PO value by more than ₹100. Flags overpayment situations that need investigation.

#### 3. Dispatched for 1+ Days
POs that have been marked as dispatched by the vendor but not yet received on site, for more than one day. Used to follow up on delayed deliveries. This is the **only PO report** visible to Project Managers.

#### 4. 2B Reconcile Report *(Admin & Accountant only)*
GST reconciliation report. Compares PO invoices against GSTR-2B (government GST portal data). Shows reconciliation status: Full, Partial, or None. Includes proof attachment status. Used exclusively by Finance for tax compliance.

#### 5. PO Attachment Reconciliation
Verifies that every PO has the expected supporting documents — invoices, DCs, MIRs, and payment confirmations. Shows counts of each document type per PO. Used for audit and compliance checks.

#### 6. DN > DC Quantity Report
Compares Delivery Note quantities against Delivery Challan quantities at the item level. Flags items where the delivery note shows more than what the DC records, indicating a data inconsistency between what was logged as dispatched and what was logged as received.

---

### WO Tab — Work Orders (3 reports)

Mirrors the PO tab but for Service Requests (contractor/labour work orders):

#### 1. Pending Invoices (WO)
Work Orders where the vendor invoice has not been fully raised relative to payments made.

#### 2. Excess Payments (WO)
Work Orders where payments exceed the agreed WO amount.

#### 3. 2B Reconcile Report (WO) *(Admin & Accountant only)*
GST reconciliation for service invoices. Same structure as the PO version.

---

### DCs & MIRs Tab (2 reports)

Both reports are cross-project views of all delivery documents in the system:

#### 1. DC Report
All Delivery Challans across every project. Shows:
- DC reference number and date
- Project, vendor, and PO it belongs to
- Items delivered (summary)
- Whether it is client-signed
- Whether it is a stub (legacy record with no items recorded)
- Whether the PO contains Critical PO categories

#### 2. MIR Report
Same structure as DC Report but for Material Inspection Reports. Additionally shows which DC the MIR corresponds to (`dc_reference`).

**Both reports are fully searchable, filterable by project/signed status/stub status/critical category, and CSV exportable.**

---

### Shared Features Across All Reports

**Filtering:**
- Full-text fuzzy search across key fields
- Faceted filters (project, vendor, status, category) — multi-select checkboxes
- Date range filters (creation date, payment date, delivery date, etc.)
- All filter state is saved to the URL — reports can be bookmarked or shared

**CEO Hold highlighting:**
Rows belonging to projects under CEO Hold are highlighted in amber across all reports, so management attention is immediately drawn to them.

**CSV Export:**
Every report supports CSV export. The export:
- Respects the current filter and sort state (exports what you see)
- Uses dynamic filenames (e.g., `ProjectReport_Cash_Sheet_15-Jan-2026.csv`)
- Formats amounts in Indian Rupee notation

**Data table features:**
- Column sorting (click any header)
- Column visibility toggle (show/hide columns)
- Pagination (50 rows per page default)
- Hover cards on complex cells (e.g., remarks, attachment lists, invoice breakdowns)

---

### Role-Based Report Access Summary

| Report | Admin | PMO | Accountant | Project Lead | PM | Procurement Exec |
|---|---|---|---|---|---|---|
| Cash Sheet | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Inflow Report | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Outflow Report | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Progress Report | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Inventory Report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vendor Ledger | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| PO Pending Invoices | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| PO Excess Payments | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Dispatched 1+ Days | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PO 2B Reconcile | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| PO Attachment Reconcile | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| DN > DC Qty | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| WO Pending Invoices | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| WO Excess Payments | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| WO 2B Reconcile | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| DC Report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MIR Report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Total: 17 distinct report views across 5 tabs.**

---

### Dependencies

The Reports module reads from virtually every other module:

| Report Group | Data Sources |
|---|---|
| Cash Sheet / Outflow / Inflow | Projects, Project Payments, Project Invoices, Project Inflows, Project Expenses, POs, SRs |
| Vendor Ledger | Vendors, POs, SRs, Project Invoices, Project Payments |
| PO Reports | Procurement Orders, Project Invoices, Project Payments, PO Delivery Documents |
| WO Reports | Service Requests, Project Invoices, Project Payments |
| DC / MIR Reports | PO Delivery Documents, Critical PO Tasks |
| Inventory Report | Remaining Items Reports, Project Estimates |
| DN > DC Report | Procurement Orders, PO Delivery Documents |

Reports are **read-only** — no data is created or modified from the Reports module. It is a pure aggregation layer.

---

*Document prepared from codebase analysis — March 2026*

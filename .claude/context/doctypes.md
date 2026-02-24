# Doctypes Reference

84 custom doctypes organized by domain.

## Procurement Workflow (Core)

| Doctype | Purpose |
|---------|---------|
| **Procurement Requests** | Material requisitions from project teams |
| **Procurement Orders** | Purchase orders to vendors |
| **Quotation Requests** | RFQs sent to vendors |
| **Approved Quotations** | Accepted vendor quotes |
| **Selected Quotations** | Chosen quotes for PO generation |
| **Sent Back Category** | Rejected PR categories requiring revision |
| **Procurement Packages** | Procurement categorization |

### Child Tables
- `Procurement Request Item Detail` - PR line items
- `Purchase Order Item` - PO line items
- `PO Payment Terms` - Payment milestone terms

## Projects & Planning

| Doctype | Purpose |
|---------|---------|
| **Projects** | Main project entity (hub for all data) |
| **Project Types** | Project categorization |
| **Project Work Packages** | Work breakdown structure |
| **Project Work Headers** | Work header entries |
| **Project Work Milestones** | Milestone tracking |
| **Project Estimates** | Budget estimates (BOQ) |

### Master Definitions
- `Work Packages` - Master work package definitions
- `Work Headers` - Master work header definitions
- `Work Milestones` - Master milestone definitions
- `Scopes of Work` - Scope definitions
- `Milestones` - Master milestone data
- `Project Work Package Category Make` - Category-make associations

## Financial Management

| Doctype | Purpose |
|---------|---------|
| **Project Payments** | Payments to vendors |
| **Vendor Invoices** | Centralized invoice store (PO + SR). Autoname: `VI-.YYYY.-.#####` |
| **Project Invoices** | Legacy invoice tracking (being replaced by Vendor Invoices) |
| **Project Expenses** | Project-related expenses |
| **Project Inflows** | Revenue/cash inflows |
| **Non Project Expenses** | Overhead expenses |
| **Expense Type** | Expense categorization |
| **Target Rates** | Historical rate benchmarks |

## Service Requests

| Doctype | Purpose |
|---------|---------|
| **Service Requests** | Service-based procurement workflow |

## Master Data

| Doctype | Purpose |
|---------|---------|
| **Vendors** | Vendor master with financial balances |
| **Vendor Category** | Vendor categorization |
| **Customers** | Customer master |
| **Items** | Item/product master |
| **Category** | Item categorization |
| **Makelist** | Item make/brand list |
| **Category Makelist** | Category-make associations |
| **Category BOQ Attachments** | BOQ document storage |
| **Nirmaan Item Units** | Unit of measurement |
| **Pincodes** | Geographic data |

## User Management

| Doctype | Purpose |
|---------|---------|
| **Nirmaan Users** | Extended user profiles with FCM tokens |
| **Nirmaan User Permissions** | Custom project-level permissions |

## Asset Management (HR)

| Doctype | Purpose |
|---------|---------|
| **Asset Category** | Categorization of assets (e.g., Laptop, Phone, Vehicle) |
| **Asset Master** | Asset inventory with details (serial number, condition, IT credentials) |
| **Asset Management** | Tracks asset assignments to users with declaration attachments |

### Asset Relationships
```
Asset Category
  └─→ Asset Master (via asset_category link)
        └─→ Asset Management (via asset link)
              └─→ Nirmaan Users (via asset_assigned_to link)
```

### Asset Master Fields
- `asset_name`, `asset_description`, `asset_condition`, `asset_serial_number`, `asset_value` (Currency)
- IT Asset Details: `asset_email`, `asset_email_password` (Password), `asset_pin` (Password)
- `current_assignee` (Link to Nirmaan Users, read-only, auto-synced from Asset Management)

### Frontend Route
- `/asset-management` (NOT `/assets` - conflicts with Frappe's static file serving)

## Design Tracker

| Doctype | Purpose |
|---------|---------|
| **Project Design Tracker** | Parent tracker per project with phase support (Onboarding, Handover) |
| **Design Tracker Zone** | Child table — zones within a tracker |
| **Design Tracker Category** | Child table — categories within zones |
| **Design Tracker Tasks** | Tasks within categories |
| **Design Tracker Task Child Table** | Child table — individual task entries with status, assignees, file links, approval proof |
| **Project TDS Setting** | TDS project configuration |
| **Project TDS Item List** | TDS item entries per project |
| **TDS Repository** | Master TDS data with item sync from Items doctype |

### Design Tracker Task Statuses
- Not Started, In Progress, Submitted, Approved, Not Applicable

### Key Fields (Design Tracker Task Child Table)
- `status`, `assigned_designers` (JSON), `file_link`, `approval_proof` (Attach)
- `last_submitted` (auto-set by lifecycle hook)

## Critical PO

| Doctype | Purpose |
|---------|---------|
| **Critical PO Category** | Category definitions with `critical_po_sub_category` for granular categorization |
| **Critical PO Items** | Items linked to critical PO categories |
| **Critical PO Tasks** | Task tracking for critical PO workflow |

## BOQ (Bill of Quantities)

| Doctype | Purpose |
|---------|---------|
| **BOQ** | Bill of quantities documents |
| **BOQ Item** | Child table — BOQ line items |

## Work Plan & Material Delivery

| Doctype | Purpose |
|---------|---------|
| **Work Plan** | Work plan tracking with `work_plan_remarks` field |
| **Material Delivery Plan** | Material delivery planning per project |

## Help & Training

| Doctype | Purpose |
|---------|---------|
| **Help Repository** | Loom video training content with title, description, video_link. Autoname: field:title. CRUD: Admin/PMO; Read: All roles |

## Documents & Collaboration

| Doctype | Purpose |
|---------|---------|
| **Nirmaan Attachments** | Legacy file attachment store. DC/MIR tracking now uses **PO Delivery Documents** doctype; old records migrated as stubs (`is_stub=1`) |
| **Nirmaan Comments** | Comment system |
| **Nirmaan Notifications** | In-app notification storage |
| **Nirmaan Versions** | Custom document versioning |

## Delivery & Tracking

| Doctype | Purpose |
|---------|---------|
| **PO Delivery Documents** | Structured DC/MIR tracking per PO (replaces ad-hoc Nirmaan Attachments queries). Autoname: `PDD-.YYYY.-.#####` |
| **DC Item** | Child table for PO Delivery Documents — item-level quantity tracking per DC/MIR |

### PO Delivery Documents Fields
- `procurement_order`, `project`, `vendor` (links)
- `type` (DC / MIR), `nirmaan_attachment` (link to file)
- `reference_number`, `dc_reference`, `dc_date`
- `is_signed_by_client`, `client_representative_name`
- `items` (DC Item child table)
- `is_stub` (flag for migrated legacy records)

### Other Delivery Attachments
- `Delivery Note Attachments` - Delivery documentation
- `PR Attachments` - PR-specific attachments
- `Milestone Attachments` - Milestone documentation

## Inventory & Reporting

| Doctype | Purpose |
|---------|---------|
| **Project Progress Reports** | Progress tracking |
| **Manpower Reports** | Labor tracking |
| **Remaining Items Report** | Inventory snapshot report per project. Autoname: `RIR-.YYYY.-.#####` |
| **Remaining Item Entry** | Child table for Remaining Items Report — per-item quantity tracking |

### Remaining Items Report Fields
- `project` (link), `report_date` (Date), `created_by` (link to Nirmaan Users)
- `declaration_accepted` (Check), `cooldown_bypass` (Check)
- `items` (Remaining Item Entry child table)

### Remaining Item Entry Fields
- `item_id`, `item_name`, `unit`, `category`, `quantity` (Float)
- Linked to parent `Remaining Items Report`

### Progress Report Child Tables
- `Project Progress Report Attachments`
- `Project Progress Report Manpower Details`
- `Project Progress Report Work Milestones`

## Financial Planning

| Doctype | Purpose |
|---------|---------|
| **Cashflow Plan** | Expected cash outflow/inflow planning per project |

### Cashflow Plan Fields
- `project`, `vendor`, `vendor_name` (links)
- `id_link` (link to PO/SR), `planned_date`, `planned_amount`
- `type` (Select: PO, WO, Misc, Inflow, New PO, New WO)
- `items`, `estimated_price`, `remarks`
- `critical_po_category`, `critical_po_task`

## Supporting

- `Customer PO Child Table` - Customer PO details (includes `customer_po_payment_terms` child table with expected date fields)
- `Task` - Task management
- `Auto Approval Counter Settings` - Auto-approval tracking
- `Map API` - Geolocation services
- `TDS Repository` - TDS data tracking with item sync from Items doctype (via `on_update` hook)

---

## Doctype Relationship Flow

```
Projects (hub)
  ├─→ Procurement Requests
  │     ├─→ Quotation Requests
  │     │     └─→ Approved Quotations
  │     └─→ Procurement Orders
  │           ├─→ PO Delivery Documents (DCs & MIRs)
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

## Field Type Patterns

### JSON Fields (Flexible/UI-driven)
- `procurement_list`, `category_list`, `rfq_data` in PRs
- `project_work_packages`, `project_scopes` in Projects
- `vendor_category` in Vendors

### Child Tables (Queryable/Relational)
- `order_list` (PR items) - modern approach
- `payment_terms` (PO payment milestones)
- `project_work_header_entries`

### Link Fields (Foreign Keys)
- `project` → Projects
- `vendor` → Vendors
- `vendor_address` → Address (Frappe core)

### Dynamic Links (Polymorphic)
- `Project Payments.document_type` + `document_name` (links to PO or SR)

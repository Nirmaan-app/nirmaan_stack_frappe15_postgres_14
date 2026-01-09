# Doctypes Reference

60 custom doctypes organized by domain.

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
| **Project Invoices** | Vendor invoices |
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

## Documents & Collaboration

| Doctype | Purpose |
|---------|---------|
| **Nirmaan Attachments** | File attachment system |
| **Nirmaan Comments** | Comment system |
| **Nirmaan Notifications** | In-app notification storage |
| **Nirmaan Versions** | Custom document versioning |

## Delivery & Tracking

- `Delivery Note Attachments` - Delivery documentation
- `PR Attachments` - PR-specific attachments
- `Milestone Attachments` - Milestone documentation

## Reporting

| Doctype | Purpose |
|---------|---------|
| **Project Progress Reports** | Progress tracking |
| **Manpower Reports** | Labor tracking |

### Child Tables
- `Project Progress Report Attachments`
- `Project Progress Report Manpower Details`
- `Project Progress Report Work Milestones`

## Supporting

- `Customer PO Child Table` - Customer PO details
- `Task` - Task management
- `Auto Approval Counter Settings` - Auto-approval tracking
- `Map API` - Geolocation services

---

## Doctype Relationship Flow

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

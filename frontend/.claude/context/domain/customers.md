# Customers Domain - Workflow Analysis

## Overview

The Customers module manages company/client entities that can be assigned to projects. Customers are central to the financial flow as they determine the source of project inflows and are linked to invoicing and payments.

**Key Relationship**: `Customer → Projects → Financials (Inflows, Payments, Invoices)`

---

## File Structure

```
src/pages/customers/
├── customers.tsx              # List page - DataTable with all customers
├── customer.tsx               # Detail page - Overview/Financials tabs
├── add-new-customer.tsx       # Create form (Sheet component, reusable)
├── edit-customer.tsx          # Edit form (Sheet component)
├── customers.constants.ts     # DocType config, search fields, column defs
├── CustomerOverview.tsx       # Overview tab - Details + Projects + Inflows
├── CustomerFinancials.tsx     # Financials tab - Summary + Payments + Orders
└── components/
    └── CustomersSummaryCard.tsx  # Total customers count card
```

---

## Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/customers` | `Customers` | List all customers with search/filter |
| `/customers/new-customer` | `NewCustomer` | Create new customer form |
| `/customers/:customerId` | `Customer` | Customer detail page with tabs |

**URL Params for detail page:**
- `?main=overview|financials` - Main tab selection
- `?tab=projects|payments-inflow|All Payments|All Orders` - Sub-tab selection

---

## Workflows

### 1. Customer List View (`customers.tsx`)

**Purpose**: Display searchable/filterable list of all customers

**Features**:
- Server-side pagination via `useServerDataTable`
- Columns: ID, Company Name, Contact Person, Phone, Email, Creation Date
- Search by: company_name (default), name, contact_person, email, phone
- Date filtering on creation/modified
- CSV export capability
- Summary card showing total customer count

**Navigation**: Click on Customer ID or Company Name → Customer Detail Page

---

### 2. Customer Creation (`add-new-customer.tsx`)

**Purpose**: Create new customer with linked address

**Form Schema** (Zod validation):
```typescript
{
  company_name: string (required, min 3 chars)
  company_gst: string (required, GST regex validated)
  company_contact_person?: string
  phone?: string (10 digits)
  email?: string (email format)
  company_address_line_1: string (required)
  company_address_line_2: string (required)
  company_city: string (auto-populated from pincode)
  company_state: string (auto-populated from pincode)
  company_pin: string (required, 6 digits)
}
```

**Data Flow**:
1. User enters pincode → Fetches from `Pincodes` doctype → Auto-fills city/state
2. On submit:
   - Creates `Address` document first
   - Creates `Customers` document with `company_address` linked to Address
   - If Customers creation fails → Deletes the Address (rollback)
3. Handles duplicate GST error (`CustomerGSTExistError`)

**Reusability**: Component accepts `navigation` prop - can be embedded in other forms via Sheet

---

### 3. Customer Detail Page (`customer.tsx`)

**Purpose**: Single customer view with Overview and Financials tabs

**Structure**:
```
┌─────────────────────────────────────────┐
│ Company Name              [Edit Icon]   │
├─────────────────────────────────────────┤
│ [Overview] [Financials]                 │  ← Main tabs (Ant Design Menu)
├─────────────────────────────────────────┤
│ Tab Content (lazy loaded)               │
└─────────────────────────────────────────┘
```

**Features**:
- Real-time updates via `useFrappeDocumentEventListener`
- URL state sync for tab navigation (browser back/forward works)
- Lazy loads Overview and Financials components

---

### 4. Customer Overview Tab (`CustomerOverview.tsx`)

**Purpose**: Display customer details and related entities

**Sections**:
1. **Customer Details Card**:
   - Company ID, Contact Person, Phone, Email, GST
   - Full address (fetched from linked Address document)

2. **Sub-tabs** (Ant Design Radio.Group):
   - **Projects**: Embedded `<Projects>` component filtered by `customerId`
   - **Payments Inflow**: Embedded `<InFlowPayments>` component filtered by `customerId`

---

### 5. Customer Financials Tab (`CustomerFinancials.tsx`)

**Purpose**: Financial summary and payment/order tracking

**API Call**: `nirmaan_stack.api.customers.customer_financials.get_customer_financial_details_api`

**Response Structure**:
```typescript
{
  projects: Projects[]
  project_inflows: ProjectInflows[]
  totals: {
    total_amount_paid: number      // Outflow to vendors
    total_inflow_amount: number    // Received from customer
    total_po_amount_with_gst: number
    total_sr_amount_with_gst: number
    total_amount_due: number       // Pending payments
  }
}
```

**Sections**:
1. **Summary Card**: 5 financial metrics (inflow clickable → dialog with details)

2. **Sub-tabs** (Ant Design Radio.Group):
   - **All Payments**: `<AllPayments>` filtered by customerId - shows payments done
   - **All Orders**: `<ProjectPaymentsList>` filtered by customerId - shows POs/SRs

---

### 6. Customer Edit (`edit-customer.tsx`)

**Purpose**: Update customer and address details

**Form**: Same fields as create, pre-populated from existing data

**Update Logic**:
- Compares current vs original values (`hasChanges()`)
- Only updates changed documents (Customers and/or Address)
- Maintains data consistency between linked documents

---

## Data Model

### Customers DocType
```typescript
interface Customers {
  name: string              // Auto-generated ID
  company_name: string
  company_address: string   // Link to Address doctype
  company_contact_person?: string
  company_phone?: string
  company_email?: string
  company_gst: string       // Unique constraint
  creation: string
  modified: string
}
```

### Related Documents
- **Address**: Linked via `company_address` field
- **Projects**: Link to Customers via `customer` field
- **Project Inflows**: Link to Customers via `customer` field

---

## Key Relationships

```
Customer
    │
    ├── Address (1:1) ─ company_address
    │
    ├── Projects (1:N) ─ customer field
    │       │
    │       ├── Project Inflows (1:N) ─ payment receipts
    │       │
    │       ├── Procurement Orders (1:N) ─ via project
    │       │
    │       └── Service Requests (1:N) ─ via project
    │
    └── Project Payments (via Projects)
```

---

## State Management

| Store/Context | Usage |
|---------------|-------|
| `useFrappeGetDoc` | Single customer data |
| `useFrappeDocumentEventListener` | Real-time updates |
| `useStateSyncedWithParams` | URL-synced tab state |
| `useSWRConfig.mutate` | Cache invalidation after CUD |

---

## Validation Rules

1. **GST Format**: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$`
2. **Phone**: Exactly 10 digits
3. **Pincode**: Exactly 6 digits, auto-validates against Pincodes doctype
4. **City/State**: Auto-populated, shows "Not Found" if pincode invalid

---

## Role-Based Access

Refer to `.claude/context/role-access.md` for complete matrix.

**Customer pages typically require**: Admin, PMO Executive, or Accountant roles

---

## Integration Points

1. **Projects Page**: Can filter by customer, shows customer-specific projects
2. **Inflow Payments**: Can filter by customer, used in Overview tab
3. **Project Payments/AllPayments**: Can filter by customer, used in Financials tab
4. **New Project Form**: Customer dropdown to assign customer to project

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `get_customer_financial_details_api` | Aggregated financial data for customer |
| Standard Frappe CRUD | Document operations |

---

## Important Notes

1. **Address Linking**: Always create Address before Customers; delete Address if Customers creation fails
2. **GST Uniqueness**: Backend enforces unique GST with custom exception `CustomerGSTExistError`
3. **Pincode Lookup**: Uses `Pincodes` doctype for city/state auto-fill
4. **Lazy Loading**: Overview and Financials components are React.lazy loaded
5. **Real-time**: Customer detail page listens for document changes via Frappe socket events

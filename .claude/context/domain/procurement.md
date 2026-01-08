# Procurement Domain

Detailed documentation for PR/PO/RFQ/Quotation workflows.

## Workflow Overview

```
PR Created → RFQ Sent → Quotes Received → Quote Selected → PO Generated → Delivery → Invoice → Payment
```

## Key APIs

| API | Purpose |
|-----|---------|
| `custom_pr_api.new_custom_pr()` | Create custom procurement requests |
| `custom_pr_api.resolve_custom_pr()` | Update/resolve custom PRs |
| `approve_vendor_quotes.generate_pos_from_selection()` | PO generation from selected quotes |
| `send_vendor_quotes` | RFQ distribution to vendors |
| `approve_reject_sb_vendor_quotes` | Sent-back quote handling |
| `reject_vendor_quotes` | Quote rejection logic |
| `approve_amend_po` | PO amendment approval |
| `handle_cancel_po` | PO cancellation |
| `po_merge_and_unmerge` | PO consolidation |

## Auto-Approval Rules

1. **PR < ₹5,000:** Immediate auto-approve
2. **PO < ₹20,000 (with vendors):**
   - Auto-approve + generate PO
   - Unless 8th consecutive (forces manual review)

## Doctype Relationships

```
Procurement Request
  ├─→ Quotation Request (RFQ)
  │     └─→ Approved Quotation
  │           └─→ Selected Quotation
  │
  └─→ Procurement Order (PO)
        ├─→ PO Payment Terms
        ├─→ Delivery Notes
        ├─→ Project Invoice
        └─→ Project Payment
```

## Sent Back Categories

When a PR category is rejected, it creates a `Sent Back Category` requiring:
- Revision by the requestor
- Re-submission for approval
- Separate approval flow

## PO Generation Logic

`approve_vendor_quotes.generate_pos_from_selection()`:
1. Groups selected quotes by vendor
2. Aggregates items across quotes
3. Creates payment terms
4. Generates PO with proper linking
5. Updates PR status

## State Transitions

### PR States
- `Pending` - Awaiting approval
- `Approved` - Ready for RFQ
- `Vendor Selected` - Quotes selected, awaiting vendor approval
- `Vendor Approved` - PO generated
- `Partially Approved` - Some categories approved
- `Rejected` - Declined
- `Cancelled` - Withdrawn
- `Closed` - Completed

### PO States
- `Draft` - Not yet submitted
- `Submitted` - Active PO
- `Amended` - Modified after submission
- `Cancelled` - Voided

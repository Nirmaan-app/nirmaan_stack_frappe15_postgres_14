# ADR 0043 — An Office Rent amount is the bill total incl. GST

**Status:** Accepted · 2026-11-05 (owner grilling) · Spec #1613

Every office landlord charges 18% GST on rent, and TDS (10%, 194-I) is taken on the rent without the GST. We
decided that HR types the **bill total incl. GST**, and the app derives the base rent (bill ÷ 1.18, to the paisa),
the GST (bill − base), the TDS (10% of the base) and what the landlord gets (bill − TDS). The tax record keeps
the base as its gross; the Expense keeps the GST and its amount becomes what the landlord gets. The tiers read
the bill. A reader will be surprised that the figure typed is not the figure taxed: that is on purpose.

## Considered options

- **Type the base rent and add GST** (rejected): the bill is the one figure HR has in hand, and the tiers should
  read the full cost to the company.
- **A Landlord GSTIN question, GST only when present** (rejected for now): every current landlord is registered;
  a landlord without one (reverse-charge GST) is out of scope until one exists.
- **Keep the old meaning for requests raised before this** (rejected): the 2026-10-28 production backup held no
  Office Rent request; the owner checks production once before release.

## Consequences

- `gross_amount` on a rent tax record is the base rent, not the bill: any reader wanting the bill adds the
  Expense's `gst_amount` (`withheld_expense_bill_sql`, `withheld_tds_of`).
- Office Rent expenses approved before this carry no GST and are not backfilled.

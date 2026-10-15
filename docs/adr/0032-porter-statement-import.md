# 32. The Porter Statement import creates expenses only after Porter's own invoices agree

Date: 2026-10-15

## Status

**Accepted** (owner grilling session 2026-10-15, Q1–Q36). Not yet built. Terms: `GLOSSARY.md` §
*Porter deliveries*. As-built detail will go in `.claude/context/domain/outflow-import.md` §
*Porter Statement — the fourth source*.

## Context

The bank-statement import skips every Porter wallet top-up on purpose (`bank_exclusions.py`, rule
`platform_porter`). A top-up only moves money into a wallet, so it pays nobody. The real Porter spend
happens inside the wallet and was meant to come from "the platforms' own payout reports, which are a
separate import". That import did not exist, so Porter delivery spend reached no project's outflow,
no CEO-Hold cashflow gap and no report.

Porter's monthly statement (CSV) has one line per delivery order. Each line names the **Porter
Invoice** that bills it: one consolidated tax invoice per city and billing entity, published as a PDF
at a public URL. The September 2026 file had 159 lines, 10 invoices, 158 completed orders and 1
cancelled order.

Three facts measured on that file shape every decision below:

1. **An invoice's total covers its completed orders only.** The cancelled ₹328 order is not on the
   Hyderabad invoice (₹613 = its 2 completed orders).
2. **Porter's GST is under reverse charge.** Each invoice says "GST payable by the service recipient
   under reverse charge mechanism". Its *Total Amount* is the fare before GST. Porter is never paid
   the GST; the company pays it to the government and normally claims it back.
3. **The PDF's text layer is scrambled by its font encoding**, so totals can only be read from the
   rendered page. The shared Gemini extractor (`services/extraction`) read all 10 invoices correctly
   (`gemini-3.8-flash`, 3 at a time, 4 min 20 s in all). The statement's row-by-row tax differs from
   the invoice's tax by up to ₹0.18 because of rounding.

## Decision

**Each completed Porter Order becomes one Project or Non-Project Expense, created directly at
*Paid*, and nothing is created unless every Porter Invoice in the file agrees with the statement.**
Like Cashbook (ADR-0015), this source creates and never settles.

- **The amount is the Porter fare, before GST.** Reverse-charge GST is kept on the Porter Order and
  is never added to the Expense. Adding it would overstate a cost that is claimed back, and would
  count it twice once the GST payment is imported through the bank statement's `GST` rule.
- **Porter's details live in two new doctypes, not in fields on the expenses.**
  - **Porter Invoice**: invoice number, both GSTINs, billing entity, city, link, the stored PDF,
    what Gemini read and the comparison result.
  - **Porter Order**: one per CRN, holding every order column of the statement.

  The Expense points at its order through a single `porter_order` Link, the way it already owns
  `request_id`. Marker fields would have put about 14 columns on both expense doctypes, repeated
  invoice-level values on up to 71 rows, and widened the approval queue's cross-ledger SQL. That runs
  against "a field only exists if the system reads it" (ADR-0016, expense-request-vs-expense).
- **The gate is all or nothing, and it cannot be overridden.**
  - **What each invoice is checked on:** invoice number, Porter GSTIN, customer GSTIN, fare and tax.
    Fare and tax must agree within ₹1.
  - **What counts:** the comparison is against the statement's *completed* orders only.
  - **When it fails:** one failing invoice blocks the whole file. Nobody can force Create, Admin
    included. The import can only be Discarded, and the statement corrected at source.
- **Project placement uses no curated list and no AI.** In order:
  1. The existing Won-only name matcher (`project_match`).
  2. Tolerance for typos and initials.
  3. A match against the project's site address. It may override a name only when most of a remark
     group's orders agree.
  4. Placements a person confirmed or rectified in earlier Porter imports.

  `Outflow Import Project Alias` is not used: it needs an edit every time a project is added. A
  Gemini call was rejected by the owner. A person reviews and edits placements by remark group
  before Create, and an unplaced order becomes a Non-Project Expense. September measured 144 of 158
  placed.
- **Corrections after import use Rectify**, not editing. Rectify replaces the Expense and keeps the
  old `Outflow Row Match` as reversed, because match rows are frozen after insert and an in-place
  project edit would leave the import's history naming the wrong project.

## Considered Options

- **Amount including GST.** Rejected for the reason above. It also contradicts what the Porter wallet
  actually paid.
- **Marker fields on both expense doctypes.** Rejected for the reason above.
- **Validate per invoice, and create the invoices that pass.** Rejected by the owner. A partly
  imported month is harder to reason about than a refused one.
- **One Expense per invoice per project (about 20 a month).** Rejected. It loses the order-level
  trail, and it cannot place orders of one invoice on different projects.

## Consequences

- Porter lines waiting for Create are **excluded from *Total Unreconciled Outflow*** and from Bulk
  Import's *Still open*. They are not bank money awaiting reconciliation. Without this, an import that
  failed or was never created would inflate that figure forever.
- An invoice's PDF is stored **once**, as a `File` attached to its Porter Invoice. Its Expenses share
  the URL. Extra `File` rows per Expense are forbidden: `frappe_gcp_attachment`'s `delete_from_cloud`
  deletes the stored object by key, with no check for other rows sharing it, so deleting any one copy
  would delete every Expense's invoice.
- `Material Transportation Charges` gains the Non-Project flag, as a fixture change, so all Porter
  spend shares one type.
- Validation depends on the shared `Document AI Settings` model. Switching it to a model that reads
  Porter invoices worse would make imports fail; it would never make them create wrong records.

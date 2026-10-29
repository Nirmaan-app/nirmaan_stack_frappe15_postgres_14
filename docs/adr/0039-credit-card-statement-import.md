# 39. The Credit Card Statement import records every card spend as a Non-Project Expense, and knows a statement by its holder

Date: 2026-10-25

## Status

**Accepted** (owner grilling session 2026-10-25). Not yet built. Terms: `GLOSSARY.md` § *Company
credit cards*.

## Context

The bank-statement import skips the credit card bill on purpose (`bank_exclusions.py`, rules
`credit_card_bill_payment` and `credit_facility_auto_debit`): "the card's own spends are recorded
separately". Nothing recorded them, so card spend reached no outflow figure, the same gap Porter had
before ADR-0032.

The company has two ICICI corporate cards, each with one holder and one PDF statement a month. The
2026-10-01 statement (period 2026-09-02 to 2026-10-01) has 47 lines: 40 spends and 7 credits. The
spends total ₹1,37,584.99 and the credits ₹2,76,821.73, equal to the paisa to the statement's own
*Purchases / Charges* and *Payments / Credits*. Every line has a unique SerNo.

## Decision

A fifth Bulk Import source, *Credit Card Statement*. Like Cashbook and Porter, it **creates and
never settles**.

1. **Every card spend becomes one *Paid* Non-Project Expense, with no vendor.** A card never pays
   for a project's work, so there is no project placement, no project picker on Review and no
   Rectify. A wrong type is fixed by editing the Expense; a wrong line by Unreconcile.
2. **A statement is known by its card holder and billing period, not by a card number.** The
   statement's details block names the holder and the company but prints no card number; the
   numbers appear only as headings inside the transaction list, and the payments sit under a
   different number (the account) from the spends (the card). The upload reads the holder and the
   company name, refuses a statement not issued to Stratos Infra Technologies, and refuses a
   second statement for the same holder and period. Lines are also known by SerNo, so a line is
   never imported twice.
3. **The totals gate is all or nothing, with no override.** Parsed spends must equal *Purchases /
   Charges* and parsed credits *Payments / Credits*, to the paisa. The PDF is read by plain code;
   the gate is what keeps that code honest. A password-locked PDF is refused with a message asking
   for the unlocked file.
4. **Credits are sorted by rule.** Payments into the card (auto-debit, UPI and other payments
   received, auto-debit returns) and cashback are system skips, each with its reason. A merchant
   credit with a spend of the same merchant and the same amount on the same statement is a *Paired
   card refund*: both lines are skipped, one credit cancelling the latest spend before it. Any other
   merchant credit is an *Unpaired card credit*, kept open with the choices a bank credit has.
5. **The expense type is suggested from the live Non-Project type list, never a hard-coded map.**
   First a type a person confirmed for the same merchant on an earlier statement; else Gemini picks
   one from the live list; else, when unsure or naming a type not on the list, *Misc. Expenses*.
   Every suggestion is editable on Review. The type's form fields are left empty, as Cashbook and
   Porter leave them.
6. **What each Expense gets:** the line amount; the transaction date; *payment_by* the holder;
   *payment_ref* "{transaction details} - {SerNo}"; description "Card spend at {merchant},
   {holder}'s card"; a link to its Credit Card Statement.
7. **Steps:** Upload → Review → Create, Discard allowed before Create. Admin, Accountant Lead and
   Accountant (the existing Bulk Import gate).
8. **Invoices.** Each card Expense waits in a new *Credit Card* sub-tab of Vendor Invoice Recon →
   *Pending Invoices Upload*, until an invoice file is attached (number and date optional), or an
   Admin or Accountant Lead marks it *No invoice* with a reason.
9. Card lines are excluded from *Total Unreconciled Outflow* and *Still open* (they are not bank
   lines), and get their own *Credit Card* tab in Import History.

## Considered options

- **Card number as the statement's identity.** Rejected: it is not in the details block, and the
  two numbers printed in the list would make "which one is the card" a parser guess.
- **Project or Non-Project per spend, as Porter does.** Rejected by the owner: card spend is company
  overhead (travel, food, software), so a project picker would only invite wrong placements.
- **A fixed merchant → type table.** Rejected: types are added and renamed in the live system (44
  Non-Project types live against 35 in the fixture), and a table would go stale silently.

## Consequences

- If one holder is ever given a second company card, their two statements for a month collide on
  identity. Revisit this ADR then, rather than loosening the check.
- A second card issuer needs its own reader, and therefore its own source string, as a second bank
  does (outflow-import Q24).

## Amendment A (2026-10-27) — a password-locked PDF is opened with its password

**Status:** Accepted. Amends decision 3 (its last sentence) and spec #1565 story 3 ("the system never asks
for or keeps a card password"). Every other decision is unchanged.

**Why.** ICICI sends the statement PDF password-locked, so refusing a locked file meant every statement had
to be unlocked outside the app before upload. The owner asked for a password field when the PDF is locked,
and for the stored PDF to have no password.

**Decision.**

- A locked PDF uploaded without a password is refused with *"This PDF is password-locked. Enter its password
  and upload again."*; Upload then shows a PDF password field. A wrong password is refused with *"That
  password did not open this PDF. Check it and upload again."* Both refusals save nothing, as every other
  refusal does. The screen recognises them by those exact sentences (`card_pdf.py` ↔ `creditCardImport.ts`,
  pinned by test).
- The password opens the file in memory for that one request. It is never saved to any record, never logged
  and never returned; the endpoint pops it from the request form as soon as it reads it.
- The PDF stored on the Credit Card Statement is an unlocked copy: the same pages written again with no
  encryption. An upload that was not locked is stored as uploaded.
- There is no remembered password: each locked statement needs its password typed again.
- The field also shows **before** the first upload, as soon as a picked PDF looks locked (it carries an
  `/Encrypt` entry, read in the browser by `pdfLooksLocked`), so a locked statement is uploaded once. That
  check is only a hint: the server still decides, and Upload stays enabled with the field empty, since a PDF
  encrypted with an owner password only carries the entry yet opens without one. After either refusal above,
  the field must be filled.

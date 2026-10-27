# 33. A Payee is one bank account; payments and Expenses carry their own pay-to account

Date: 2026-10-14

## Status

**Proposed** 2026-10-14 (owner grilling session). **Revised 2026-10-15** (second grilling session):
Payees became an address book, and every payment and Expense now holds its own copy of the account
(decisions 4, 5 and 9; the Inactive status, the lock and the Linked Expenses list are gone). The first
version was built on the unmerged branch `spec/1420` (#1420–#1432); the revision is reworked there.

## Context

Bank details lived only on the `Vendors` doctype: one account per vendor, in five flat fields
(`account_name`, `account_number`, `ifsc`, `bank_name`, `bank_branch`). Expenses had nowhere to say
who gets the money or which account to pay. A Project Expense could link a vendor, but only 0.6%
did. A Non-Project Expense could not link anyone, and the payee lived only as free text in
`description`. The accountant paying an expense had to guess or ask, and the ICICI / Cashfree
upload files always skipped expenses as "(no vendor)".

## Decision

1. **A Payee is one bank account with its holder's name:** account holder name, account number,
   IFSC, bank and branch. No two Payees share an account number and IFSC. The bank fields move off
   `Vendors` and are deleted there. All their readers are moved in the same release:
   - the Bulk Import vendor index and Tier 1
   - refund suggestions
   - the bank upload files
   - the PO "bank details missing" gate
   - the vendor duplicate check
2. **A Vendor links to at most one Payee. One Payee may serve several Vendors.** Live data has 8
   account numbers shared by 19 vendors, and in every case the IFSC is the same. Each is one
   company listed as a vendor once per branch or state (Keywest Geogrid ×3, Safex Fire ×3, D.S.
   Ductofab ×3, Caryaire ×2, …). The migration makes one Payee per shared account and keeps the
   longest holder name, and it lists those 8 Payees for the owner to check.
3. **A Payee with no Vendor is paid only through Expenses.** Payees have no kind (Employee,
   Business, …) in v1. The Payees page shows what each Payee is linked to instead.
4. **A Payee is edited in place.** When its holder moves banks, the account number and IFSC are
   edited; there is no *Inactive* status and no lock. Whoever may edit a vendor's bank details may
   edit them, and the holder name follows the same rule. Every edit is recorded (`track_changes`).
   Editing a Payee that serves several vendors first names them all. A Payee no vendor links to may
   be deleted by Accountant, Accountant Lead or Admin. Renaming a Vendor asks whether its Payee's
   holder name should follow.
5. **Expenses name whoever is paid through their pay-to account.** Each expense type says whether
   it is *Required*, *Optional* or *Not asked*. The person raising the Expense Request picks an
   existing Payee or adds a new one, which fills in the request's pay-to account, and approval
   copies it onto the Expense. Expense Request and Project Expense keep their optional `vendor`
   field: naming a vendor copies the vendor's Payee, and the raiser cannot type another account
   while a vendor is named.
   Every Payee has an account number and IFSC. Someone paid by cash or cheque with no account on
   record is not a Payee. Their name stays in the expense description, and a Cheque keeps a typed
   name for them. Expense types paid that way are set to *Optional* or *Not asked*.
6. **Creating a Vendor suggests the best-matching existing Payees.** It shows everything each one
   is already linked to, and asks "are you sure?" before linking.
7. **The account number is typed twice** (number + confirm), and paste is disabled on both fields.
8. **A Payees page lists every Payee.** Accountant, Accountant Lead and Admin manage Payees there.
   Procurement keeps editing a vendor's bank details from the vendor screens, which now save to
   its Payee. A Payee's page shows its overview and the vendors linked to it; it does not list
   payments or Expenses, since none points at it.
9. **Every PO / Work Order payment, Expense Request and Expense holds its own pay-to account**
   (holder name, account number, IFSC, bank, branch), and none links to a Payee. It is copied when
   the record is raised, so the raiser sees where the money goes before submitting: a PO / WO
   payment from its vendor's Payee, an expense from the Payee picked. On an Expense Request or
   Expense the raiser may change it until approval; after that Accountant, Accountant Lead or Admin,
   until it is paid. A PO / WO payment's is never edited by hand, keeping the rule that a PO / WO
   payment is not editable in the app. **Revised 2026-10-16:** if its vendor's Payee has changed
   since the copy, or it has no copy, it is not rejected and raised again: when it is put in a bank
   file or marked paid it takes the vendor's current account, so the copy records the account
   actually paid; the payer sees the change first. From *Reconciliation Pending* or *Paid* the screens
   no longer let it change; this is a screen rule only, and the server enforces none of these
   edit rules (owner, 2026-10-15), like the other edit-by-status rules. Every change is
   recorded (`track_changes`). An account number typed by hand anywhere is typed twice, paste
   disabled. The bank upload files and Bulk Import Tier 1 read the record's own pay-to account.
   Existing records: unpaid ones are copied from today's Payee; paid ones are filled from their
   matched bank line where it holds an account number, and otherwise left blank, never guessed.
10. **Which rows can be paid (2026-10-16).** A row is *Ineligible* when there is nowhere to send
    its money: a PO / WO payment with no copy whose vendor has no Payee, or an Expense of a
    *Required* type with no pay-to account. The payment screens don't let it be ticked, exported or
    marked paid. An Expense of an *Optional* / *Not asked* type with no account, and any cheque
    payment, is *kept out of the bank file* but can be marked paid. Screen rules, like decision 9.

This replaces the 2026-08-18 rule in `.claude/context/domain/expenses.md` that a request asks for no
payee bank details.

## Considered options

- **Keep bank details on Vendor and add Payee only for non-vendors.** Rejected: that leaves two
  places to look for an account, forever.
- **Records link to a Payee and the Payee is locked once paid** (this ADR's first version,
  2026-10-14). Dropped on review: PO / WO payments stored nothing, so their history moved with the
  vendor; the lock needed an *Inactive* status, a new Payee per bank change and a Linked Expenses
  list just to know whether a Payee had been paid. Copying the account onto each record keeps
  history true with none of that.
- **A Payee is a person who holds many bank accounts, with one default.** First chosen, then
  dropped in the same session. "Which of this vendor's accounts?" is guesswork for whoever raises
  or pays a PO payment. It also forces either duplicate accounts or one Payee per company for the
  19 vendors that share accounts. The cost of the chosen shape is that a person's old and new
  accounts are not linked.

## Not in v1: read this before extending

These were weighed and deliberately left out of v1. They are gaps, not oversights.

### No verification of bank accounts

v1 trusts what was typed. Typing the number twice with paste disabled catches typos only. It does
not prove the account belongs to the payee, anyone raising an expense can add a new Payee, and
anyone who may edit a vendor's bank details may change its Payee's account (decision 4). The pay-to
account copy keeps the past true but does not protect the next payment. The risk is money sent to a
wrong or fraudulent account; the payer's "account changed" warning is the only check in v1.

Options considered for later:

- **Proof document + Verify button (the recommended first step).** The person adding a Payee
  uploads a cancelled cheque or a passbook / statement page. An Accountant, Accountant Lead or
  Admin compares it with what was typed and presses *Verify*, and the app records who and when.
  An unverified Payee cannot go into the ICICI / Cashfree upload file or be marked done until it
  is verified, and the pay screen offers a one-click verify. Payees migrated from `Vendors` start
  verified, since they already passed the Razorpay IFSC lookup in the vendor form.
- **Penny drop.** A bank-verification service sends ₹1 and returns the registered account-holder
  name. It is stronger but costs per check and adds a new outside service. Today the only bank
  service the app calls is the Razorpay IFSC lookup (`api/bank_details.py`).

### No name-only payees

Cash and cheque payees with no bank account are not Payees, so expenses paid to them carry the
payee only as text. That text cannot be searched for or matched.

## Amendment A (2026-10-20) — who changes an Expense's pay-to account, enforced on the server

Owner ruling for spec #1494 story 50. It narrows decision 9 for an Expense (a Project Expense or a
Non-Project Expense); an Expense Request and a PO / WO payment keep decision 9 as written.

- Before *Paid*, only an Accountant or the Accountant Lead changes an Expense's pay-to account. Admin
  does not.
- At *Reconciliation Pending* and *Paid*, nobody changes it: it says where the money went.
- The server enforces this, which replaces "a screen rule only" in decision 9 for an Expense.
  `services/expense_decision.assert_may_edit` refuses the change through Change account and through a
  document save (`LOCKED_FIELDS` at Reconciliation Pending). The edit dialog and Record Payment read
  the same answer from `get_expense_edit_access`. The row's other fields keep the story-50 edit rule.

# 33. A Payee is one bank account; Vendors and Expenses point at a Payee

Date: 2026-10-14

## Status

**Proposed** 2026-10-14 (owner grilling session). Not built yet.

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
4. **Changing banks means a new Payee.** The old one is marked *Inactive* and cannot be picked
   again. Once anything has been paid to a Payee, its account number and IFSC are locked. Its
   holder name can still be corrected by Accountant, Accountant Lead or Admin, with a
   confirmation step. Renaming a Vendor asks whether its Payee's holder name should follow, or a
   new Payee is needed.
5. **Expenses name a Payee.** Each expense type says whether its payee is *Required*, *Optional* or
   *Not asked*. The person raising the Expense Request picks an existing Payee or adds a new one,
   and approval carries it onto the Expense. An Accountant may change it before paying. Expense
   Request and Project Expense keep their optional `vendor` field. Picking a vendor fills in its
   Payee, and the two must agree. A vendor can't be read back from a Payee, because one Payee can
   serve several vendors.
   Every Payee has an account number and IFSC. Someone paid by cash or cheque with no account on
   record is not a Payee. Their name stays in the expense description, and a Cheque keeps a typed
   name for them. Expense types paid that way are set to *Optional* or *Not asked*.
6. **Creating a Vendor suggests the best-matching existing Payees.** It shows everything each one
   is already linked to, and asks "are you sure?" before linking.
7. **The account number is typed twice** (number + confirm), and paste is disabled on both fields.
8. **A Payees page lists every Payee.** Accountant, Accountant Lead and Admin manage Payees there.
   Procurement keeps editing a vendor's bank details from the vendor screens, which now save to
   its Payee.

This replaces the 2026-08-18 rule in `.claude/context/domain/expenses.md` that a request asks for no
payee bank details.

## Considered options

- **Keep bank details on Vendor and add Payee only for non-vendors.** Rejected: that leaves two
  places to look for an account, forever.
- **A Payee is a person who holds many bank accounts, with one default.** First chosen, then
  dropped in the same session. "Which of this vendor's accounts?" is guesswork for whoever raises
  or pays a PO payment. It also forces either duplicate accounts or one Payee per company for the
  19 vendors that share accounts. The cost of the chosen shape is that a person's old and new
  accounts are not linked.

## Not in v1: read this before extending

These were weighed and deliberately left out of v1. They are gaps, not oversights.

### No verification of bank accounts

v1 trusts what was typed. Typing the number twice with paste disabled catches typos only. It does
not prove the account belongs to the payee, and anyone raising an expense can add a new Payee. The
risk is money sent to a wrong or fraudulent account.

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

### PO and Work Order payments do not record which Payee they paid

v1 pays a vendor's PO or Work Order to **the Payee the vendor links to at the time**. It stores no
Payee on `Project Payments`. Expenses do store their Payee (decision 5), so the two kinds of payment
are deliberately uneven.

What this loses:

- **History can lie.** Once a vendor is moved to a new Payee, every old payment looks as if it was
  paid to the new account. In a "we paid you / no you didn't" dispute, the app cannot show which
  account was paid.
- **No one-off accounts.** "Pay this one into my other account" can only be done by moving the
  vendor to another Payee, which changes how all of its old payments read.

What softens it: once a payment is matched in Bulk Import, the bank line (`Outflow Import Row`)
holds the account number that was really paid. That does not cover ICICI lines, which carry no
account number, or payments that are approved but not yet matched.

The fix for later is a link from `Project Payments` to the Payee, filled with the vendor's Payee
when the payment is created. Payments made before that link exists will have no Payee stored, so
adding it sooner leaves a smaller gap.

### Bulk Import matches a vendor's current Payee only

Tier 1 matches a bank line's account + IFSC against the Payee the vendor links to *now*. Suppose a
vendor is paid from Payee P1, and is then moved to Payee P2 before the statement is imported. That
line will not reach Tier 1, so it is matched by hand. The owner chose this over keeping a history
of each vendor's past Payees. If late lines become common, add that history and match against
every Payee the vendor has had.

### No name-only payees

Cash and cheque payees with no bank account are not Payees, so expenses paid to them carry the
payee only as text. That text cannot be searched for or matched.

### No link between a person's old and new Payee

Each Payee is one account, so "Ramesh's old SBI account" and "Ramesh's new HDFC account" are two
unrelated Payees. Reports by person, and merging duplicate Payees, are out of v1.

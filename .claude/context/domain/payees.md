# Payees

A **Payee** is one bank account the company pays into, with its holder's name. Vendors and expenses point
at one. Decision record: `docs/adr/0033-payee-is-one-bank-account.md` (read its "Not in v1" section before
extending this). Glossary: root `GLOSSARY.md` § Payees (*Payee*, *Inactive*, *Locked*, *Expense payee*).
Spec #1420; the Payee record, the Payee module and the Payees page are #1422.

## Load-bearing invariants

- **One owner.** Every Payee rule lives in the Payee module, `services/payees/`. Screens and other
  modules call it and re-state none of its rules:
  - `rules.py` (pure): cleaning what was typed (`parse_details`), what makes details complete
    (`details_problem`), the duplicate refusal's wording, `PAYEE_STATUSES`, `PAID_STATUSES`.
  - `writer.py`: `create_payee` is the only code that creates a Payee. It checks no role: each
    calling endpoint checks who may add a Payee from that screen. The one other creator is
    `backfill_payee`, for the #1424 patch only: bank and branch as recorded on the vendor, no lookup.
  - `links.py`: what a Payee is linked to, "paid" and last paid (`PAYEES_WITH_LINKS_SQL`,
    `payee_summaries`, `is_paid`, `payee_for_vendor`).
  - `ifsc.py`: the IFSC lookup (Razorpay), the app's only outside bank service.
  - `matching.py` (pure): which Payees look like a vendor. *Strong match*: a vendor linked to the
    Payee has the same PAN; *Name only*: no PAN agrees but the names read alike. Strong first.
  - `choosing.py`: a vendor's Payee. `suggest_for_vendor` (Active Payees only), `payee_choices`
    (links + last payment, for the confirmation), `assert_pickable` (an Inactive Payee can't be
    newly picked), `choose_payee` (an existing Payee or new details through `create_payee`).
- **A vendor's bank account is its Payee.** Vendor creation (`api/create_vendor_and_address`) takes
  an existing Payee or new bank details and writes none of the old vendor bank fields.
- **No two Payees share an account number + IFSC**, compared on `normalized_account`: the account
  number without spaces, dashes or leading zeros, exactly as Bulk Import compares a bank line
  (`services/outflow_import/normalize.normalize_account` owns that rule). The `validate` controller
  (`integrations/controllers/payee.py`) refuses a duplicate on every write path and names the existing
  Payee; a unique constraint on `(normalized_account, ifsc)` backs it up.
- **Every Payee has a holder name, an account number and an IFSC.** Bank and branch come from the IFSC
  lookup when the Payee is created, never from the caller, and a lookup that finds nothing refuses the
  Payee. The lookup does not run on later saves.
- **A vendor's bank account is read from its current Payee, everywhere** (#1427): Bulk Import's vendor
  index and Tier 1, refund suggestions and the payment autofill's holder-name check all read
  `links.vendor_accounts`. A line paid to a vendor's previous Payee reaches no Tier 1 (ADR-0033).
- **Paid** means money has left *Approved* for the Payee: a Project Payment of a vendor linked to it
  now, or an expense linked to it, at *Reconciliation Pending* or *Paid*. A PO / WO payment stores no
  Payee (ADR-0033 "Not in v1"), so a vendor's payments count for the Payee it links to today.
- **Linked expenses** are `Project Expenses` and `Non Project Expenses` naming the Payee, at any
  status. An Expense Request is not counted until approval carries its Payee onto an expense.
- **Who:** the Payees page and its endpoints (`api/payees/`) are Admin, Accountant and Accountant Lead
  only (`services/role_profiles.PAYEE_MANAGE_PROFILES`, mirrored in `frontend/src/constants/roles.ts`).
  The vendor screens' Payee step (`api/payees/vendor_payee`, `api/create_vendor_and_address`) is
  for whoever may create a vendor (`VENDOR_PAYEE_PROFILES`). Anyone who can raise an Expense
  Request searches and adds Payees only through the request's endpoints
  (`api/expense_requests/payees.py`, #1429), which call the same `create_payee`.
- **Expense payee** (#1429): an expense type's *Who gets paid* (`Expense Type.payee_rule`) is
  *Required*, *Optional* or *Not asked* (default). A request or expense with a vendor is paid into
  that vendor's Payee and no other; *Not asked* stores none; an Inactive Payee can't be newly
  picked, but a record already holding it keeps it. One owner: `services/payees/expense_rules.py`
  (pure) applied by `services/payees/expense_payee.py`. Approval copies the request's Payee onto the
  Expense; an Expense's Payee changes until it is *Paid* (`change_expense_payee`).

## Where things are

| What | Where |
|---|---|
| Doctype `Payee` (`PYE-####`) | `nirmaan_stack/doctype/payee/` |
| Payee links | `payee` (Link to Payee) on `Vendors`, `Expense Request`, `Project Expenses`, `Non Project Expenses` |
| Add Payee endpoints | `api/payees/add_payee.py`: `add_payee`, `check_payee`, `lookup_ifsc` |
| Payees list endpoint | `api/payees/list_payees.get_payees` (data-table contract; the tab is the filter `["tab", "=", …]`) |
| Test fixture | `api/payees/payee_fixture.PayeeFixture`: offline IFSC lookups, purges every test Payee; `class_payee` for a `setUpClass` |
| A vendor's account (Bulk Import, autofill) | `services/payees/links.vendor_accounts` (#1427) |
| Vendor bank details → Payees (#1424) | `patches/v3_0/move_vendor_bank_details_to_payees.py` (re-runnable; its docstring holds the grouping, fallback and skip rules); test `api/payees/test_vendor_payees_patch.py` |
| Frontend fields + dialog | `components/payees/` (`PayeeBankFields`, `usePayeeBankForm`, `AddPayeeDialog`) |
| Expense payee rules (#1429) | `services/payees/expense_rules.py` (pure: Required / Optional / Not asked, vendor's Payee, Inactive), `services/payees/expense_payee.py` (`request_payee_for`, `assert_pickable`, `change_expense_payee`), `services/payees/search.py` (`search_active_payees`) |
| Expense Request picker endpoints | `api/expense_requests/payees.py` (`search_payees`, `check_request_payee`, `add_request_payee`, `get_vendor_payee`), gated on `access.can_raise_requests` |
| Frontend picker | `components/payees/PayeePicker.tsx` + `usePayeeChoice.ts` (pick or add new; reused by Change payee) |
| Frontend rules | `utils/payees/payeeForm.ts`, `utils/payees/payeeRoutes.ts` (`payeeHref`) |
| Payees page | `pages/payees/PayeesPage.tsx`, route `/payees` |
| Vendor Payee endpoints | `api/payees/vendor_payee.py`: `suggest_vendor_payees`, `get_payee_choice`, `check_vendor_payee` |
| Vendor Payee step (frontend) | `components/payees/VendorPayeeSection` + `useVendorPayeeChoice`, `PayeeSuggestionsPanel`, `UsePayeeDialog`, `vendorPayeeApi`; wording in `utils/payees/payeeChoice.ts` |

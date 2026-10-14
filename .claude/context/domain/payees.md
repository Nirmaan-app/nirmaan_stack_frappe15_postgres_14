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
    `edit_holder_name` and `set_status` (Active / Inactive) are the only edits.
  - `links.py`: what a Payee is linked to, "paid" and last paid (`PAYEES_WITH_LINKS_SQL`,
    `payee_summaries`, `is_paid`, `payee_for_vendor`), and one Payee's page (`payee_page`:
    `linked_vendors`, `linked_expenses`, `holder_name_changed_on`).
  - `guard.py`: the refusals `validate` controllers run on every write path (`check_payee_save`,
    `check_payee_pick`).
  - `ifsc.py`: the IFSC lookup (Razorpay), the app's only outside bank service.
  - `matching.py` (pure): which Payees look like a vendor. *Strong match*: a vendor linked to the
    Payee has the same PAN; *Name only*: no PAN agrees but the names read alike. Strong first.
  - `choosing.py`: a vendor's Payee. `suggest_for_vendor` (Active Payees only), `payee_choices`
    (links + last payment, for the confirmation), `assert_pickable` (the vendor form's early
    refusal of an Inactive Payee; `guard.check_payee_pick` is the every-path one), `choose_payee` (an existing Payee or new details through `create_payee`).
- **A vendor's bank account is its Payee.** Vendor creation (`api/create_vendor_and_address`) takes
  an existing Payee or new bank details and writes none of the old vendor bank fields. Every screen
  that shows or checks a vendor's bank details (hover card, detail popover, the PO / WO
  payment-request gate, the bank file, the vendor list) reads the vendor's Payee through
  `services/payees/vendor_account.vendor_accounts`, gated by Vendors read, not Payee read. So do
  Bulk Import's vendor index (Tier 1, refund suggestions) and the payment autofill's holder-name check
  (#1427): a line paid to a vendor's previous Payee reaches no Tier 1 (ADR-0033).
- **No two Payees share an account number + IFSC**, compared on `normalized_account`: the account
  number without spaces, dashes or leading zeros, exactly as Bulk Import compares a bank line
  (`services/outflow_import/normalize.normalize_account` owns that rule). The `validate` controller
  (`integrations/controllers/payee.py`) refuses a duplicate on every write path and names the existing
  Payee; a unique constraint on `(normalized_account, ifsc)` backs it up.
- **Every Payee has a holder name, an account number and an IFSC.** Bank and branch come from the IFSC
  lookup when the Payee is created, never from the caller, and a lookup that finds nothing refuses the
  Payee. The lookup does not run on later saves.
- **Paid** means money has left *Approved* for the Payee: a Project Payment of a vendor linked to it
  now, or an expense linked to it, at *Reconciliation Pending* or *Paid*. A PO / WO payment stores no
  Payee (ADR-0033 "Not in v1"), so a vendor's payments count for the Payee it links to today.
- **Locked**: once a Payee is paid, its account number and IFSC never change. The Payee `validate`
  controller refuses the change on every write path (`guard.check_payee_save`); nothing stores the
  lock, it is `is_paid` asked at save time.
- **Holder name**: only Admin, Accountant and Accountant Lead (`PAYEE_MANAGE_PROFILES`) may change
  it, refused as the session user by the same controller on every write path, locked or not. The
  edit leaves a Version row (`ignore_version=False`): "Holder name last changed" reads it.
- **Inactive**: an Inactive Payee can't be newly picked. `integrations/controllers/payee_links.validate`
  on `Vendors`, `Expense Request`, `Project Expenses` and `Non Project Expenses` refuses a save whose
  `payee` changed to an Inactive Payee (`guard.check_payee_pick`); a record already pointing at it
  keeps it through any later save. A new expense inserted with an Inactive Payee (for example by
  approval carrying a request's Payee) is a new pick and is refused.
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
| A vendor's account (Bulk Import, autofill) | `services/payees/vendor_account.vendor_accounts()` (no argument: every vendor with a Payee) (#1427) |
| Vendor bank details → Payees (#1424) | `patches/v3_0/move_vendor_bank_details_to_payees.py` (re-runnable; its docstring holds the grouping, fallback and skip rules); test `api/payees/test_vendor_payees_patch.py` |
| Frontend fields + dialog | `components/payees/` (`PayeeBankFields`, `usePayeeBankForm`, `AddPayeeDialog`) |
| Expense payee rules (#1429) | `services/payees/expense_rules.py` (pure: Required / Optional / Not asked, vendor's Payee, Inactive), `services/payees/expense_payee.py` (`request_payee_for`, `assert_pickable`, `change_expense_payee`), `services/payees/search.py` (`search_active_payees`) |
| Expense Request picker endpoints | `api/expense_requests/payees.py` (`search_payees`, `check_request_payee`, `add_request_payee`, `get_vendor_payee`), gated on `access.can_raise_requests` |
| Frontend picker | `components/payees/PayeePicker.tsx` + `usePayeeChoice.ts` (pick or add new; reused by Change payee) |
| Frontend rules | `utils/payees/payeeForm.ts`, `utils/payees/payeeRoutes.ts` (`payeeHref`) |
| Payees page | `pages/payees/PayeesPage.tsx`, route `/payees` |
| One Payee's page (#1423) | `pages/payees/PayeePage.tsx`, route `/payees/:payeeId`; endpoints `api/payees/payee_page.py` (`get_payee`, `edit_holder_name`, `set_payee_status`); `components/payees/EditHolderNameDialog`; rules `utils/payees/payeePage.ts` |
| Vendor Payee endpoints | `api/payees/vendor_payee.py`: `suggest_vendor_payees`, `get_payee_choice`, `check_vendor_payee` |
| A vendor's account on screens (#1428) | `api/payees/vendor_accounts.py`: `get_vendor_payee_accounts`, `get_vendor_list`; frontend `components/payees/vendorPayeeAccount.ts` (`useVendorPayeeAccount`, `useVendorPayeeGate`) |
| Vendor Payee step (frontend) | `components/payees/VendorPayeeSection` + `useVendorPayeeChoice`, `PayeeSuggestionsPanel`, `UsePayeeDialog`, `vendorPayeeApi`; wording in `utils/payees/payeeChoice.ts` |

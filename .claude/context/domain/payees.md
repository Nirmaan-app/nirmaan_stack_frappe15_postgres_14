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
    `edit_holder_name` and `set_status` (Active / Inactive) are the only edits. A duplicate reaches a
    screen as data through `duplicate_verdict` (before submit) and `unless_duplicate` (on submit,
    rolling back); every endpoint that adds a Payee answers through them.
  - `links.py`: what a Payee is linked to, "paid" and last paid (`PAID_ROWS_SQL`, the one "paid"
    union every paid / last paid / times paid read selects from; `PAYEES_WITH_LINKS_SQL`,
    `payee_summaries`, `is_paid`), and one Payee's page (`payee_page`: `linked_vendors`,
    `linked_expenses`, `holder_name_changed_on`).
  - `vendor_account.py`: THE vendor -> Payee read (`payee_for_vendor`, `vendor_account` for one vendor
    with `other_vendors`, `vendor_accounts` for many). Nothing else reads `Vendors.payee` to find a
    vendor's account.
  - `versions.py`: facts read from Version history ("holder name last changed", "linked since",
    "Named by") are read through `last_field_change` / `changed_field_pattern`. Payee, Vendors and
    both expense doctypes have `track_changes`, so every save that changes a field writes the row.
  - `guard.py`: the refusals `validate` controllers run on every write path (`check_payee_save` on
    the Payee; `check_payee_links` on every record linking one). No screen or API can skip them.
  - `ifsc.py`: the IFSC lookup (Razorpay), the app's only outside bank service.
  - `matching.py` (pure): which Payees look like a vendor. *Strong match*: a vendor linked to the
    Payee has the same PAN; *Name only*: no PAN agrees but the names read alike. Strong first.
  - `choosing.py`: a vendor's Payee. `suggest_for_vendor` (Active Payees only), `payee_choices`
    (links + last payment, for the confirmation), `assert_pickable` (the vendor form's early
    refusal of an Inactive Payee; `guard.check_payee_pick` is the every-path one; both ask
    `rules.pick_problem`), `choose_payee` (an existing Payee or new details through `create_payee`)
    and `link_vendor` (Change account: an existing vendor to another Payee, by `choose_payee`,
    refusing the one it has).
- **A vendor's bank account is its Payee.** Vendor creation (`api/create_vendor_and_address`) takes
  an existing Payee or new bank details. `Vendors` has no bank fields: #1432 deleted the five
  (`account_name`, `account_number`, `ifsc`, `bank_name`, `bank_branch`), and with them the screen-only
  account-number duplicate rule; the Payee uniqueness on the server replaced it. The DB columns stay
  (migrate never drops a column) only so the #1424 patch can still read them on a site that has not run it;
  no code reads them otherwise. A vendor the patch skipped (live: VEN-Service-0281, an account number and
  no IFSC) keeps that number only in the orphaned column and the patch log: its page says "No bank account
  yet", and PO / WO payment requests are blocked until someone adds bank details. Every screen
  that shows or checks a vendor's bank details (hover card, detail popover, the PO / WO
  payment-request gate, the bank file, the vendor list) reads the vendor's Payee through
  `services/payees/vendor_account.vendor_accounts`, gated by Vendors read, not Payee read. So do
  Bulk Import's vendor index (Tier 1, refund suggestions) and the payment autofill's holder-name check
  (#1427): a line paid to a vendor's previous Payee reaches no Tier 1 (ADR-0033). On the
  vendor page (#1426) the Account Details card shows the vendor's Payee and how many other vendors
  share it (`vendor_account.vendor_account`); Change account / Add bank details go through
  `api/payees/vendor_payee.change_vendor_payee` (`choosing.link_vendor`), and the other vendors on
  the old Payee keep it. One vendor's account is ONE SWR key on the screens
  (`vendorPayeeAccount.vendorAccountKey`, over `get_vendor_account`): the card, the rename prompt,
  the hover card, the detail popover and the payment-request gate all read it, so revalidating it
  after Change account updates every one. The edit-vendor form has no bank fields. Renaming a vendor
  with a Payee asks keep / update the holder name / new bank details / decide later; "update the
  holder name" is the Payees-page holder-name edit, so the holder-name rule (Accounts and Admins) holds.
- **No two Payees share an account number + IFSC**, compared on `normalized_account`: the account
  number without spaces, dashes or leading zeros, exactly as Bulk Import compares a bank line
  (`services/outflow_import/normalize.normalize_account` owns that rule). The `validate` controller
  (`integrations/controllers/payee.py`) refuses a duplicate on every write path and names the existing
  Payee; a unique constraint on `(normalized_account, ifsc)` backs it up.
- **Every Payee has a holder name, an account number and an IFSC.** Bank and branch come from the IFSC
  lookup when the Payee is created, never from the caller, and a lookup that finds nothing refuses the
  Payee. The lookup does not run on later saves.
- **Paid** means money has left *Approved* for the Payee: a Project Payment of a vendor linked to it
  now, or an expense linked to it, at *Reconciliation Pending* or *Paid* (`rules.PAID_STATUSES`, which
  is `services/settlement.SETTLED_STATUSES`). The same set locks a Payee, fixes an expense's Payee
  (Change payee, the save guard) and says "paid" in Record Payment's box. A PO / WO payment stores no
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
  keeps it through any later save. Carrying a link is not a new pick: approval puts the request's
  Payee on its expense even if it went Inactive since, and a Payee that comes from the record's
  vendor is never a new pick, on requests (of any type) and expenses alike. The request dialog's
  read-only vendor-Payee box shows an "Inactive" badge, so the raiser and the reviewer see it.
- **Linked expenses** are `Project Expenses` and `Non Project Expenses` naming the Payee, at any
  status. An Expense Request is not counted until approval carries its Payee onto an expense.
- **Who:** the Payees page and its endpoints (`api/payees/`) are Admin, Accountant and Accountant Lead
  only (`services/role_profiles.PAYEE_MANAGE_PROFILES`, mirrored in `frontend/src/constants/roles.ts`).
  The vendor screens' Payee step (`api/payees/vendor_payee`, `api/create_vendor_and_address`) is
  for whoever may create a vendor (`VENDOR_PAYEE_PROFILES`). Anyone who can raise an Expense
  Request searches and adds Payees only through the request's endpoints
  (`api/expense_requests/payees.py`, #1429), which call the same `create_payee`.
- **Expense payee** (#1429): an expense type's *Who gets paid* (`Expense Type.payee_rule`) is
  *Required*, *Optional* or *Not asked* (default). A request or Project Expense with a vendor is
  paid into that vendor's Payee and no other (filled in when blank); *Not asked* ignores a Payee the
  raiser sent and stores none, except that a request naming a vendor carries the vendor's Payee, so
  the accountant sees who to pay; an Inactive Payee can't be newly picked, but a record already
  holding it keeps it. One owner: `services/payees/expense_rules.py` (pure: `request_payee`,
  `follow_vendor`, `paid_expense_problem`), applied on EVERY save by `guard.check_payee_links`
  (the request endpoints pass the Payee sent straight through). There is no second copy: Change
  payee (`expense_payee.change_expense_payee`) sets the Payee and saves the expense, so the hook
  decides. Each rule is asked only on insert or when `payee`, `vendor` or the type changes, so older
  records still re-save. Approval copies the request's Payee onto the Expense, and so follows the
  vendor's Payee as it is at approval.
  - **Paid**: once a request or expense is paid (Reconciliation Pending or Paid) its Payee is fixed,
    and a vendor change does NOT move it: the money already went to that account. Correcting the
    vendor on a paid Project Expense saves with the stored Payee. The vendor / Payee match applies
    only to unpaid records.
  - **Changing the vendor** on an unpaid record: a Payee left as it was follows the new vendor's
    Payee (none when it has none). **Clearing the vendor** (empty / *Others (No Vendor)*) clears a
    Payee that was the old vendor's; any other Payee stays. The type's rule then applies as for any
    record with no vendor.
  - **Required on an expense**: a *Required* type's expense can't have its Payee taken away (Change
    payee, Desk, a vendor change). Inserting one with none is allowed: approval of a request from
    before payees, and Bulk Import. Any type's expense may be given a Payee by Accounts, *Not asked*
    included: whoever pays it names the account.
  - **Who changes an expense's Payee**: Accounts and Admins (`PAYEE_MANAGE_PROFILES`), on any save.
    The one exemption is a vendor edit (`vendor_changed`): anyone who may edit the expense changes its
    Payee only by changing its vendor, and then only to that vendor's own Payee, or to none when the
    vendor is cleared. Naming any other Payee in the same save is still Accounts' call.
  - **Vendors**: only `VENDOR_PAYEE_PROFILES` set or change `Vendors.payee`, on any save. Making a
    vendor with no Payee needs no such role.
- **Paid to** (#1431): who a row the accountant pays is paid to is resolved in one place,
  `services/payees/paid_to.py`: a PO / WO payment into its vendor's Payee now, an expense into its own
  Payee. "Payment need to paid"'s Paid to column (the approval queue's `paid_to`), Export for Payment
  (read again at export through `api/payees/expense_payee.get_paid_to`) and Record Payment's
  "Pay ₹X to" box (`expense_pay_to`) all read it; no screen re-derives it. A row with no Payee is left
  out of the bank file, never sent with a blank account. Change payee in Record Payment is Accounts only
  (`api/payees/expense_payee.change_expense_payee`).

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
| Expense payee rules (#1429) | `services/payees/expense_rules.py` (pure: Required / Optional / Not asked, vendor's Payee, Inactive), `services/payees/expense_payee.py` (`payee_rule`, `change_expense_payee`), `services/payees/search.py` (`search_active_payees`) |
| Expense Request picker endpoints | `api/expense_requests/payees.py` (`search_payees`, `check_request_payee`, `add_request_payee`), gated on `access.can_raise_requests`; the picked vendor's Payee is `useVendorAccount` (`get_vendor_account`, Vendors read) |
| Frontend picker | `components/payees/PayeePicker.tsx` + `usePayeeChoice.ts` (pick or add new; reused by Change payee) |
| Frontend rules | `utils/payees/payeeForm.ts` (form rules, `newPayeeProblem`, `bankLine`), `utils/payees/expensePayee.ts`, `utils/payees/payeeRoutes.ts` (`payeeHref`); pinned to the server's by the shared cases `services/payees/payee_rules_cases.json` (F1: `test_rules.py` / `test_expense_rules.py` and `payeeForm.test.ts` / `expensePayee.test.ts` run the same cases) |
| Payees page | `pages/payees/PayeesPage.tsx`, route `/payees` |
| One Payee's page (#1423) | `pages/payees/PayeePage.tsx`, route `/payees/:payeeId`; endpoints `api/payees/payee_page.py` (`get_payee`, `edit_holder_name`, `set_payee_status`); `components/payees/EditHolderNameDialog`; rules `utils/payees/payeePage.ts` |
| Vendor Payee endpoints | `api/payees/vendor_payee.py`: `suggest_vendor_payees`, `get_payee_choice`, `check_vendor_payee`; `get_vendor_account`, `change_vendor_payee` (#1426) |
| A vendor's account on screens (#1428) | `api/payees/vendor_accounts.py`: `get_vendor_payee_accounts`, `get_vendor_list`; frontend `components/payees/vendorPayeeAccount.ts` (`useVendorAccount`, `useVendorPayeeGate`). The gate blocks a PO / WO payment request until the vendor is KNOWN to have a Payee: while it loads and when the read fails too (`utils/payees/vendorAccount.vendorPayeeGateProblem`); used by the PO payment terms card, the PO / WO request dialog and the Credits page's request dialog |
| Paying: Paid to, bank file, Record Payment (#1431) | `services/payees/paid_to.py`; endpoints `api/payees/expense_payee.py` (`get_paid_to`, `get_expense_payee`, `search_payees`, `change_expense_payee`); frontend `components/payees/ExpensePayToBox`, `ChangeExpensePayeeDialog`, `expensePayeeApi`; wording `utils/payees/paidTo.ts`; file builder `pages/ProjectPayments/bankUploadFile.ts` |
| Vendor page account card + rename prompt (#1426) | `pages/vendors/components/VendorAccountCard`, `VendorRenameFlow`; `components/payees/ChangeVendorAccountDialog`, `VendorRenamePrompt`; wording in `utils/payees/vendorAccount.ts`; test `api/payees/test_vendor_account.py` |
| Vendor Payee step (frontend) | `components/payees/VendorPayeeSection` + `useVendorPayeeChoice`, `PayeeSuggestionsPanel`, `UsePayeeDialog`, `vendorPayeeApi`; wording in `utils/payees/payeeChoice.ts` |

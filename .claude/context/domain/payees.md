# Payees

A **Payee** is one bank account the company pays into, with its holder's name: an address book entry.
Vendors point at one; nothing paid points back at it. Decision record:
`docs/adr/0033-payee-is-one-bank-account.md` (revised 2026-10-15; read its "Not in v1" section before
extending this). Glossary: root `GLOSSARY.md` § Payees (*Payee*, *Pay-to account*, *Expense payee*).
Spec #1420; the Payee record, the Payee module and the Payees page are #1422.

## Load-bearing invariants

- **One owner.** Every Payee rule lives in the Payee module, `services/payees/`. Screens and other
  modules call it and re-state none of its rules:
  - `rules.py` (pure): cleaning what was typed (`parse_details`), what makes details complete
    (`details_problem`), the duplicate refusal's wording, `PAID_STATUSES`.
  - `writer.py`: `create_payee` is the only code that creates a Payee. It checks no role: each
    calling endpoint checks who may add a Payee from that screen. The one other creator is
    `backfill_payee`, for the #1424 patch only: bank and branch as recorded on the vendor, no lookup.
    `edit_payee` is the only edit (#1435): holder name, account number and IFSC, in place, the
    duplicate rule applied with the Payee itself left out, the IFSC looked up again only when it
    changes. `delete_payee` refuses while any vendor links to it, naming every one
    (`rules.payee_in_use_problem`, `frappe.LinkExistsError`). A duplicate reaches a
    screen as data through `duplicate_verdict` (before submit) and `unless_duplicate` (on submit,
    rolling back); every endpoint that adds or edits a Payee answers through them (`duplicate_verdict` takes
    `exclude`, the Payee being edited).
  - `links.py`: the vendors a Payee serves (`PAYEES_WITH_LINKS_SQL`, `payee_summaries`: its fields
    and `vendors`, the count), and one Payee's page (`payee_page`: `linked_vendors`,
    `holder_name_changed` and `account_changed`, each `{on, by}` from `last_changed`: when and by
    whom, the account being its number or IFSC). A Payee has no linked expenses, "last paid" or "times paid" (#1434).
  - `vendor_account.py`: THE vendor -> Payee read (`payee_for_vendor`, `vendor_account` for one vendor
    with `other_vendors`, `vendor_accounts` for many). Nothing else reads `Vendors.payee` to find a
    vendor's account.
  - `versions.py`: facts read from Version history ("holder name last changed", "linked since",
    "Named by") are read through `last_field_change` / `changed_field_pattern`. Payee, Vendors and
    both expense doctypes have `track_changes`, so every save that changes a field writes the row.
  - `guard.py`: the refusals `validate` controllers run on every write path (`check_payee_links` on
    every record linking a Payee). No screen or API can skip them. A Payee's own save has none beyond
    completeness and the duplicate refusal (#1434).
  - `ifsc.py`: the IFSC lookup (Razorpay), the app's only outside bank service.
  - `matching.py` (pure): which Payees look like a vendor. *Strong match*: a vendor linked to the
    Payee has the same PAN; *Name only*: no PAN agrees but the names read alike. Strong first.
  - `choosing.py`: a vendor's Payee. `suggest_for_vendor`, `payee_choices` (its linked vendors, for
    the confirmation), `choose_payee` (an existing Payee, refused when there is no such Payee, or new
    details through `create_payee`) and `link_vendor` (Use a different payee: an existing vendor to another Payee, by `choose_payee`,
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
  share it (`vendor_account.vendor_account`). Edit bank details (#1435) edits the vendor's own Payee
  in place through `api/payees/vendor_payee.edit_vendor_payee` (`writer.edit_payee`), so every vendor
  on it follows; Use a different payee / Add bank details go through
  `api/payees/vendor_payee.change_vendor_payee` (`choosing.link_vendor`), and the other vendors on
  the old Payee keep it. One vendor's account is ONE SWR key on the screens
  (`vendorPayeeAccount.vendorAccountKey`, over `get_vendor_account`): the card, the rename prompt,
  the hover card, the detail popover and the payment-request gate all read it, so revalidating it
  after Edit bank details or Use a different payee updates every one. The edit-vendor form has no bank fields. Renaming a vendor
  with a Payee asks keep / update the holder name / new bank details / decide later; "update the
  holder name" is Edit bank details started with the new name (`edit_vendor_payee`), open to anyone
  in `VENDOR_PAYEE_PROFILES` (#1435). The Payee itself carries no holder-name role rule (#1434).
- **No two Payees share an account number + IFSC**, compared on `normalized_account`: the account
  number without spaces, dashes or leading zeros, exactly as Bulk Import compares a bank line
  (`services/outflow_import/normalize.normalize_account` owns that rule). The `validate` controller
  (`integrations/controllers/payee.py`) refuses a duplicate on every write path and names the existing
  Payee; a unique constraint on `(normalized_account, ifsc)` backs it up.
- **Every Payee has a holder name, an account number and an IFSC.** Bank and branch come from the IFSC
  lookup when the Payee is created, never from the caller, and a lookup that finds nothing refuses the
  Payee. It runs again only when `writer.edit_payee` changes the IFSC; a plain save never looks up.
- **Paid** means money has left *Approved*: a record at *Reconciliation Pending* or *Paid*
  (`rules.PAID_STATUSES`, which is `services/settlement.SETTLED_STATUSES`). It says "paid" in Record
  Payment's box. It never locks a Payee.
- **A Payee is edited in place** (#1434, ADR-0033 decision 4): no status (Active / Inactive), no lock
  once paid, and no role rule on its holder name. The Payee `validate` controller refuses only
  incomplete details and a duplicate; anyone allowed to save the Payee may change its holder name,
  account number or IFSC, paid or not. Every edit leaves a Version row (`track_changes`;
  `edit_payee` saves with `ignore_version=False`): the Payee page's "Holder name last changed" and
  "Account last changed" (when and by whom) read it. Who may reach an edit is decided by each
  screen's endpoint: the Payees page's Edit and Delete are Accounts only, the vendor screens' Edit
  bank details is `VENDOR_PAYEE_PROFILES`. Editing a Payee several vendors share first names them all
  on screen (`utils/payees/payeeEdit.sharedPayeeWarning`). A Payee no vendor links to may be deleted
  (Payees page only); records already raised keep their own copy of the account.
- **A Payee is linked to vendors only.** The Payees list counts its vendors and its tabs are *All* and
  *No vendor* (no vendor links to it: used only for expenses, or not at all). The Payee page shows
  Payee Overview and Linked Vendors; the vendor "use an existing payee" confirmation lists the vendors
  already linked; the Payee pickers (`search.find_payees`) order matches by holder name. None of them
  shows expense counts, "last paid" or "times paid".
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
  the accountant sees who to pay. One owner: `services/payees/expense_rules.py` (pure: `request_payee`,
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
  "Pay ₹X to" box (`expense_pay_to`) all read it; no screen re-derives it. A row with no Payee is
  left out of the bank file, never sent with a blank account. Change payee in Record Payment is Accounts only
  (`api/payees/expense_payee.change_expense_payee`).

## Where things are

| What | Where |
|---|---|
| Doctype `Payee` (`PYE-####`) | `nirmaan_stack/doctype/payee/` |
| Payee links | `payee` (Link to Payee) on `Vendors`, `Expense Request`, `Project Expenses`, `Non Project Expenses` |
| Add Payee endpoints | `api/payees/add_payee.py`: `add_payee`, `check_payee`, `lookup_ifsc` |
| Payees list endpoint | `api/payees/list_payees.get_payees` (data-table contract; the tab is the filter `["tab", "=", "all" \| "no_vendor"]`) |
| Test fixture | `api/payees/payee_fixture.PayeeFixture`: offline IFSC lookups, purges every test Payee; `class_payee` for a `setUpClass` |
| A vendor's account (Bulk Import, autofill) | `services/payees/vendor_account.vendor_accounts()` (no argument: every vendor with a Payee) (#1427) |
| Vendor bank details → Payees (#1424) | `patches/v3_0/move_vendor_bank_details_to_payees.py` (re-runnable; its docstring holds the grouping, fallback and skip rules); test `api/payees/test_vendor_payees_patch.py` |
| Frontend fields + dialog | `components/payees/` (`PayeeBankFields`, `usePayeeBankForm`, `AddPayeeDialog`) |
| Expense payee rules (#1429) | `services/payees/expense_rules.py` (pure: Required / Optional / Not asked, vendor's Payee), `services/payees/expense_payee.py` (`payee_rule`, `change_expense_payee`), `services/payees/search.py` (`find_payees`, by holder name) |
| Expense Request picker endpoints | `api/expense_requests/payees.py` (`search_payees`, `check_request_payee`, `add_request_payee`), gated on `access.can_raise_requests`; the picked vendor's Payee is `useVendorAccount` (`get_vendor_account`, Vendors read) |
| Frontend picker | `components/payees/PayeePicker.tsx` + `usePayeeChoice.ts` (pick or add new; reused by Change payee) |
| Frontend rules | `utils/payees/payeeForm.ts` (form rules, `newPayeeProblem`, `bankLine`), `utils/payees/expensePayee.ts`, `utils/payees/payeeRoutes.ts` (`payeeHref`); pinned to the server's by the shared cases `services/payees/payee_rules_cases.json` (F1: `test_rules.py` / `test_expense_rules.py` and `payeeForm.test.ts` / `expensePayee.test.ts` run the same cases) |
| Payees page | `pages/payees/PayeesPage.tsx`, route `/payees` |
| One Payee's page (#1423, #1435) | `pages/payees/PayeePage.tsx`, route `/payees/:payeeId`; endpoints `api/payees/payee_page.py` (`get_payee`, `edit_payee`, `delete_payee`); `components/payees/EditPayeeDialog` (shared with the vendor screens' `EditVendorPayeeDialog`), `pages/payees/components/DeletePayeeDialog`; rules `utils/payees/payeePage.ts` (tabs), `utils/payees/payeeEdit.ts` (edit form, shared-Payee warning, delete block, last-changed line) |
| Vendor Payee endpoints | `api/payees/vendor_payee.py`: `suggest_vendor_payees`, `get_payee_choice`, `check_vendor_payee`; `get_vendor_account`, `change_vendor_payee` (#1426); `edit_vendor_payee` (#1435) |
| A vendor's account on screens (#1428) | `api/payees/vendor_accounts.py`: `get_vendor_list`; frontend `components/payees/vendorPayeeAccount.ts` (`useVendorAccount`, `useVendorPayeeGate`). The gate blocks a PO / WO payment request until the vendor is KNOWN to have a Payee: while it loads and when the read fails (`utils/payees/vendorAccount.vendorPayeeGateProblem`); used by the PO payment terms card, the PO / WO request dialog and the Credits page's request dialog |
| Paying: Paid to, bank file, Record Payment (#1431) | `services/payees/paid_to.py`; endpoints `api/payees/expense_payee.py` (`get_paid_to`, `get_expense_payee`, `search_payees`, `change_expense_payee`); frontend `components/payees/ExpensePayToBox`, `ChangeExpensePayeeDialog`, `expensePayeeApi`; wording `utils/payees/paidTo.ts`; file builder `pages/ProjectPayments/bankUploadFile.ts` |
| Vendor page account card + rename prompt (#1426, #1435) | `pages/vendors/components/VendorAccountCard`, `VendorRenameFlow`; `components/payees/ChangeVendorAccountDialog` (Use a different payee), `EditVendorPayeeDialog` (Edit bank details, Update the holder name), `VendorRenamePrompt`; wording in `utils/payees/vendorAccount.ts`; test `api/payees/test_vendor_account.py` |
| Vendor Payee step (frontend) | `components/payees/VendorPayeeSection` + `useVendorPayeeChoice`, `PayeeSuggestionsPanel`, `UsePayeeDialog`, `vendorPayeeApi`; wording in `utils/payees/payeeChoice.ts` |

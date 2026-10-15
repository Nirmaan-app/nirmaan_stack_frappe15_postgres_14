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
  - `guard.py`: what `validate` controllers do on every write path (`check_payee_links`, on
    `Vendors`, `Expense Request` and `Project Expenses`): fill a record's pay-to account from its
    vendor, and refuse a vendor's Payee set by the wrong role. A Payee's own save has nothing beyond
    completeness and the duplicate refusal (#1434).
  - `pay_to.py` (#1436, #1437): a record's own **pay-to account**. `copy_payee_account(doc, payee)` is
    THE copy of a Payee's account into a record's five `pay_to_*` fields; every copier calls it
    (`copy_vendor_account`, Change payee, the request endpoints, the payments' save rule). `copy_pay_to`
    carries one record's copy onto another as it is (approval; a split payment's remainder);
    `fill_from_vendor` is the request / Project Expense save rule, `fill_payment_from_vendor` the
    `Project Payments` one; `pay_to_account` serves a copy to a screen.
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
  (#1427). Tier 1 reads that index only for a payment with no pay-to copy; a payment with one is
  matched on its copy, so a line paid to a vendor's previous account still reaches it (#1440). On the
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
- **Expense payee** (#1429, reworked by #1436): an expense type's *Who gets paid*
  (`Expense Type.payee_rule`) is *Required*, *Optional* or *Not asked* (default). These are SCREEN
  rules (#1436): the request dialog blocks sending a *Required* type with no account
  (`utils/payees/expensePayee.whoGetsPaidProblem`); the server refuses nothing about who gets paid.
  - **The pay-to account**: `Expense Request`, `Project Expenses` and `Non Project Expenses` hold
    `pay_to_account_name`, `pay_to_account_number`, `pay_to_ifsc`, `pay_to_bank_name`,
    `pay_to_bank_branch`, a copy of a Payee's account (`pay_to.copy_payee_account`). Editing or
    deleting the Payee changes no copy. The old `payee` link is written alongside until #1438.
  - **Picked or added**: the request endpoints copy the Payee sent (`create.apply_pay_to`); an edit
    with `keep_pay_to` leaves the copy as it is. With a vendor named the Payee sent is ignored.
  - **A vendor named** (request or Project Expense, every write path): the save copies the vendor's
    Payee when the record has no copy and whenever the vendor changes (`pay_to.fill_from_vendor`), a
    fill, never a refusal. Once the record is paid (`rules.PAID_STATUSES`) nothing is copied: the copy
    says where the money went. Clearing the vendor leaves the copy as it was.
  - **Approval** copies the request's copy onto the Expense as it is (`pay_to.copy_pay_to`), even when
    the vendor's Payee has changed since; the Expense's save fills from the vendor only when the
    request carried none.
  - **Not refused on the server** (#1436, owner 2026-10-15): a *Required* type with no account, a
    vendor and an account that disagree, a change after payment, a change by someone outside
    Accounts. Who may change a copy, and until when, are screen rules (ADR-0033 decision 9).
- **A PO / Work Order payment's pay-to account** (#1437): `Project Payments` holds the same five
  `pay_to_*` fields. Its `validate` (`integrations/controllers/project_payments`) copies the vendor's
  Payee when a payment is INSERTED with no copy (`pay_to.fill_payment_from_vendor`), so every creator
  gets one: the PO term and Credits requests (`create_project_payment`), the Work Order request
  (`create_payment_request_for_service`), PO Adjustment payments (`_payment_utils._create_project_payment`,
  whose `from_adjustment` flag skips only the doctype class's hooks, not this one) and a payment
  recorded directly (`createDoc`). A split remainder (`services/payment_split.split_payment`: CEO
  part-approval, partial settlement) is inserted carrying its parent's copy (`copy_pay_to`). A copy is
  never re-copied: editing the vendor's Payee, or saving the payment again, leaves it. A vendor with no
  Payee leaves it blank (no refusal; the request dialogs' gate blocks that case). The request dialogs
  (PO terms, Work Order, Credits) show the vendor's account read-only before submit
  (`components/payees/RequestPayToAccount`, same SWR key as the gate).
- **Records raised before the pay-to account** (#1441): `patches/v3_0/backfill_pay_to_accounts`, after
  the vendor-move patch, fills blank copies only (safe to re-run). An unpaid (not *Reconciliation
  Pending* / *Paid*) PO / Work Order payment or Project Expense naming a vendor, and a *Pending
  Approval* request naming one, take the vendor's Payee (`pay_to.copy_vendor_account`). A paid payment
  or expense takes the account number, IFSC and beneficiary name of the latest (`added_on`) *Settled*
  `Outflow Row Match` line that holds an account number; bank and branch stay blank (no IFSC lookup).
  Everything else stays blank: a paid record is never filled from its vendor. The writes are raw (no
  hook re-copies, no Version row), so "who set the account" reads the raiser, else the vendor.
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
| Payee links | `payee` (Link to Payee) on `Vendors`; on `Expense Request`, `Project Expenses`, `Non Project Expenses` written alongside the pay-to account until #1438 removes it |
| Pay-to account (#1436, #1437) | `pay_to_account_name`, `pay_to_account_number`, `pay_to_ifsc`, `pay_to_bank_name`, `pay_to_bank_branch` on `Expense Request`, `Project Expenses`, `Non Project Expenses`, `Project Payments`; `services/payees/pay_to.py`; tests `api/payees/test_payee_link_guard.py`, `api/expense_requests/test_expense_requests.py` (`TestExpenseRequestPayee`), `api/payees/test_payment_pay_to.py` (every payment creator, split remainder, Payee edit) |
| Add Payee endpoints | `api/payees/add_payee.py`: `add_payee`, `check_payee`, `lookup_ifsc` |
| Payees list endpoint | `api/payees/list_payees.get_payees` (data-table contract; the tab is the filter `["tab", "=", "all" \| "no_vendor"]`) |
| Test fixture | `api/payees/payee_fixture.PayeeFixture`: offline IFSC lookups, purges every test Payee; `class_payee` for a `setUpClass` |
| A vendor's account (Bulk Import, autofill) | `services/payees/vendor_account.vendor_accounts()` (no argument: every vendor with a Payee) (#1427) |
| Vendor bank details → Payees (#1424) | `patches/v3_0/move_vendor_bank_details_to_payees.py` (re-runnable; its docstring holds the grouping, fallback and skip rules); test `api/payees/test_vendor_payees_patch.py` |
| Pay-to backfill (#1441) | `patches/v3_0/backfill_pay_to_accounts.py` (re-runnable; its docstring holds the sources and hook reasoning); test `api/payees/test_pay_to_backfill_patch.py` |
| Frontend fields + dialog | `components/payees/` (`PayeeBankFields`, `usePayeeBankForm`, `AddPayeeDialog`) |
| Expense payee rules (#1429, #1436) | `services/payees/expense_rules.py` (pure: the Required / Optional / Not asked options; the rules are the screen's), `services/payees/expense_payee.py` (`payee_rule`, `change_expense_payee`), `services/payees/search.py` (`find_payees`, by holder name) |
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

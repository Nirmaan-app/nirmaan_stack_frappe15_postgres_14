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
    (`copy_vendor_account`, Change account, the request endpoints, the payments' save rule). `copy_pay_to`
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
  for whoever may create a vendor (`VENDOR_PAYEE_PROFILES`). Anyone who can raise at least one
  expense type (since #1506 the ledgers' `create` no longer counts: no person holds it) searches
  and adds Payees only through the request's endpoints
  (`api/expense_requests/payees.py`, #1429, gated by `access.can_name_expense_payee`), which call the
  same `create_payee`.
- **Expense payee** (#1429, reworked by #1436): an expense type's *Who gets paid*
  (`Expense Type.payee_rule`) is *Required*, *Optional* or *Not asked* (default). These are SCREEN
  rules (#1436): the request dialog blocks sending a *Required* type with no account
  (`utils/payees/expensePayee.whoGetsPaidProblem`); the server refuses nothing about who gets paid.
  - **The pay-to account**: `Expense Request`, `Project Expenses` and `Non Project Expenses` hold
    `pay_to_account_name`, `pay_to_account_number`, `pay_to_ifsc`, `pay_to_bank_name`,
    `pay_to_bank_branch`, a copy of a Payee's account (`pay_to.copy_payee_account`). Editing or
    deleting the Payee changes no copy. No request or expense links a Payee (#1438 removed the
    `payee` field from all three), so Frappe's link check never stops a Payee's delete over one.
  - **Picked or added**: the request endpoints copy the Payee sent (`pay_to.apply_picked_payee`); an
    edit with `keep_pay_to` leaves the copy as it is. With a vendor named the Payee sent is ignored. A
    Payee that does not exist is refused (`frappe.DoesNotExistError`), so nothing is saved.
  - **A Direct Expense** (#1471; GLOSSARY *Direct Expense (retired)*): retired by #1506 with its
    endpoint, its two Add Expense dialogs and `whoGetsPaidView`. Every expense names who gets paid
    through New Expense, as a request; an old Direct Expense keeps the account it was recorded with.
  - **A vendor named** (request or Project Expense, every write path): the save copies the vendor's
    Payee when the record has no copy and whenever the vendor changes (`pay_to.fill_from_vendor`), a
    fill, never a refusal. Once the record is paid (`rules.PAID_STATUSES`) nothing is copied: the copy
    says where the money went. Clearing the vendor leaves the copy as it was.
  - **Approval** copies the request's copy onto the Expense as it is (`pay_to.copy_pay_to`), even when
    the vendor's Payee has changed since; the Expense's save fills from the vendor only when the
    request carried none.
  - **Not refused on the server** (#1436, owner 2026-10-15): a *Required* type with no account, a
    vendor and an account that disagree, a change after payment, a change by someone outside
    Accounts. Who may change a copy, and until when, are screen rules (ADR-0033 decision 9), except on
    an Expense: `expense_decision.assert_may_edit` refuses a change to its `pay_to_*` fields except by
    Accounts before Reconciliation Pending (ADR-0033 Amendment A).
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
- **Paid to** (#1431, #1438, #1463): who a row the accountant pays is paid to is resolved in one place,
  `services/payees/paid_to.py`: every row into its own pay-to account, except an Approved PO / WO
  payment that switches to its vendor's current account (below). "Payment need to paid"'s Paid to column (the approval
  queue's `paid_to`, from the `pay_to_*` columns it selects), Export for Payment (read again at export
  through `api/payees/paid_to.get_paid_to`) and Record Payment's "Pay ₹X to" box (`pay_to_box`, for
  an expense and for a PO / WO payment) all read it; no screen re-derives it. An answer is
  `{account, missing, payee_rule, switch_to, by_cheque, vendor_has_no_account}`; `account` is always the row's own copy; `missing` is
  `payment_has_no_account` (no copy and nothing to switch to) or `expense_has_no_account`; `payee_rule` is every expense's type rule,
  with or without an account (null on a payment); `by_cheque` is a row a cheque pays: a PO / WO
  payment whose Mode of Payment is Cheque (`cheque_payments.is_cheque`), or any payment or expense
  on a Cheque that is not Cancelled (`cheques.lines.live_cheques_of`, one query per paid doctype,
  so a cheque made from the Cheques report for an Online payment, or for an expense, is caught);
  `vendor_has_no_account` is an Approved PO / WO payment holding its own copy while its vendor has
  no Payee now: it is paid into the copy, and the Paid to cell and the "Pay ₹X to" box say "The
  vendor has no bank account on record now. Paid to the account it was raised with."
  (`paidTo.VENDOR_HAS_NO_ACCOUNT_NOW`). A row with none is left out of the bank file with a
  reason, never sent with a blank account, and the export toast names a left-out expense by its
  description and amount, never its ID; the Cashfree beneficiary is the copy's holder name. The
  "Payment Done / Reconciliation Pending" and "Reconciliation Done" tabs show the same Paid to column,
  read-only (spec stories 56/60): the account the money went into. The box's "Set by" is the
  latest Version change to the copy's holder name, account number or IFSC, else the request's raiser
  (when the request holds the same account), else "copied from the vendor".
  - **Paid into the vendor's current account** (#1463, ADR-0033 decision 9 revised 2026-10-16;
    replaces #1439's "reject it and raise it again"): an Approved (`settlement.STATUS_APPROVED`; not
    Requested, CEO Pending or Rejected, which are not being paid, nor a paid one) PO / WO
    payment with a vendor has `switch_to` = the vendor's account now when its copy holds another
    account, compared as (`normalize.normalize_account`, `normalize.normalize_ifsc`), or when it holds
    no copy and the vendor has a Payee (`paid_to.vendor_account_to_take`, THE rule; #1464's
    eligibility extends `paid_to._answer`). A holder-name, bank or branch change switches nothing; a
    vendor with no Payee gives nothing to switch to (the payment keeps its copy, or is
    `payment_has_no_account`); an expense, a payment not Approved and a `by_cheque` payment (#1464: a
    cheque pays no account, so none is taken for it, at export or at Mark as Paid) never switch. The Paid to cell and its
    CSV say "Will be paid into the vendor's current account: X. Was Y." (`paidTo.paidToCell`); the
    "Pay ₹X to" box shows the vendor's account with Copy buttons and the old one as "Was"; Mark as
    Paid's confirmation names each switching row (`paidTo.switchLine`). **Writing it:**
    `api/payees/paid_to.take_vendor_accounts` (POST, Frappe write permission on each payment) calls
    `services/payees/take_vendor_account.take_vendor_accounts`, which takes `payments: [{name, shown}]`
    (`shown`: the `switch_to` the screen showed for that payment, or null), locks each payment and
    skips one no longer Approved (answered in `skipped` with its status, never a refusal: one stale row
    must not block the batch). It re-reads the rule under the lock and compares each fresh `switch_to`
    with `shown` by `paid_to.account_key` (normalised account number and IFSC, the switch rule's own
    comparison): on any difference it refuses the whole call, "The account for <PO> has changed since
    the page loaded. Refresh and try again.", and writes nothing (GLOSSARY *Pay-to account*: the payer is told
    before the account is replaced). Otherwise it writes each `switch_to`
    (`pay_to.set_pay_to`) with a document save (`ignore_version=False`), so the switch is in the
    payment's Version history with who and when (the box's "Set by" then reads "Changed by"). It
    answers `{taken: [{name, paid_to}], skipped: [{name, status}]}`, each `paid_to` the answer the write
    acted on: `switch_to` is exactly the account written, else `account` is the one kept. Callers send
    EVERY PO / WO payment they pay. Mark as Paid (row and bulk) reads paid-to again when it opens its
    confirmation (so the confirmation names each switching row from a fresh read, and leaves out a row
    become Ineligible or held, naming why: `paidTo.unpayableReason`), sends each payment with the
    switch the confirmation showed, marks nothing if the call fails, and leaves the skipped rows out of
    the marking (`paidTo.leaveOutSkipped`), naming them in the toast (`paidTo.describeSkipped`, which
    the export's toast shares). Export for Payment sends each
    payment the file would pay with the switch its Paid to cell showed as the page loaded it
    (`BankFileRow.shownSwitchTo`, `bankUploadFile.shownSwitches`) before saving the file (no file if it
    fails), then builds the file from its answer without the skipped ones
    (`bankUploadFile.withTakenAccounts`, through `leaveOutSkipped`), so the file pays exactly the account
    each payment records; it says how many were switched (`describeSwitched`). Whenever a skip or a
    switch makes it refetch the list, it clears the ticks first, even when no file was saved
    (`bankUploadFile.afterExport`): ticks are kept by row position. A PO / WO payment's account is still never edited by hand.
  - **Which rows can be paid** (#1464, ADR-0033 decision 10, GLOSSARY *Ineligible* / *Kept out of the
    bank file*; a screen rule): `paidTo.rowEligibility(paid_to, expense_type)` is THE rule, read from
    the paid-to answer so the queue and the export (read again) agree. *Payable*: an account, or a
    `switch_to`. *Kept out of the bank file*: any `by_cheque` row, a payment or an expense (with or
    without an account; in the file it would be paid twice), and an expense of an Optional / Not asked type with no
    account (card or cash): tickable and markable paid, left out of the file, and the export toast
    names them per reason (`describeLeftOut`). *Ineligible*: a PO / WO payment with no account and
    nothing to switch to ("Vendor has no bank account. Add it on the vendor page."), or an expense of
    a Required type with none ("<type> requires an account. Add it with the Edit pencil."): no tick
    box (`queueRowActions.canPayQueueRow`, which also refuses a held row; select-all skips it), Mark
    as Paid disabled with the reason on hover, the Paid to cell says the reason, and bulk Mark as
    Paid drops a stale tick on it. An unpaid `by_cheque` row's Paid to cell reads "Paid by cheque". The
    server refuses none of this. Adding the vendor's account or the expense's makes the row payable on
    the next load.
  - **Change account** (Record Payment, an expense only; also the expense Edit dialogs' *Who gets
    paid*, below): copies a picked or added Payee's account
    onto the expense, overwriting its copy (`expense_payee.change_expense_account`; the save leaves a
    Version row: who and when). The endpoint (`api/payees/paid_to.change_expense_account`) asks
    the expense edit rule for the `pay_to_*` fields (`expense_decision.assert_may_edit`, spec #1494:
    Accounts until the expense is paid, nobody once Paid; its save ignores permissions, so that check
    is the boundary) and refuses a PO / WO payment. The screen offers it from the same answer
    (`get_expense_edit_access`, read through `utils/payees/paidTo.mayChangeExpenseAccount` at the
    `pay_to_box`'s `status`), on an unpaid expense with no vendor (`paidTo.canChangeExpenseAccount`). A PO / WO payment's copy
    is never edited by hand: it follows its vendor's account when paid (above). The dialog names the expense by
    its description (`pay_to_box`'s `description`, `paidTo.expenseTitle`), words its type's rule
    (`paidTo.changeAccountRuleLine`) and offers Remove account only when the type is not *Required*
    (`paidTo.canRemoveExpenseAccount`, a screen rule).
  - **Who gets paid in the expense Edit dialogs** (#1465; the pencil on the Payments queue and on
    the expense pages): Change account inside the edit, wherever the server's edit answer lets the
    viewer change the `pay_to_*` fields at the expense's status (`paidTo.editDialogPayTo` ->
    `mayChangeExpenseAccount`): Accounts, until it is paid. The raiser's own case (#1472, a Direct
    Expense while Requested) is gone: no person creates a ledger row any more, and the server refuses
    anyone outside Accounts (spec #1494 story 50). Payees are searched and added through the Accounts
    endpoints, and the save goes through Change account's endpoint, which leaves the Version row
    "Set by" reads.
    Same picker and rule wording; it saves with Save Changes:
    the pick is resolved first (a new Payee is added, a duplicate stops the save), the fields are
    updated, then the Payee is copied (`components/payees/ExpenseEditPayTo`,
    `useChangeExpenseAccount`, which the Change account dialog saves through too). Remove account is
    staged and applied on save. With a vendor named in the form, the vendor's account shows read-only
    with "set Vendor to Others (No Vendor)" to pay someone else.
  - **Payment autofill** (`api/payment_autofill._build_vendor_match`) compares a receipt's
    beneficiary with the payment's own holder name (`pay_to_account_name`) and the vendor's name. The
    cheque photo check (`match_payee_to_vendor`) still reads the vendor's current Payee: a cheque has
    no copy.

## Ways money leaves

Every path that pays a payment or an expense, or sends it to the bank. A rule about whether something may
be paid (a hold, *Ineligible*, *Kept out of the bank file*, a new flag) holds only where it is enforced,
so a change to such a rule checks every line below (`CODING_STANDARDS.md` § Writing backend Python,
*Rules about whether money may be paid*). Lifecycle: `Approved -> Reconciliation Pending -> Paid`
(`services/settlement.py`); money is gone from Reconciliation Pending on. Paths are under `frontend/src/`
and `nirmaan_stack/`. As of 2026-10-25:

1. **Mark as Paid, row and bulk** ("Payment need to paid" tab): `pages/ProjectPayments/update-payment/AccountantTabs.tsx`
   (`openMarkPaid`, `handleMarkPaid`). A payment goes `Approved -> Reconciliation Pending` by a REST `updateDoc`;
   an expense by `api/approvals/expense_actions.decide_expenses` (`mark_done`). Rules: payments get
   `payment_hold.validate_hold`, the cheque validators and `take_vendor_accounts` on the server; expenses get
   `expense_decision.can_mark_paid` (roles) only. *Ineligible* and held rows are refused in the browser only
   (`config/queueRowActions.canPayQueueRow`, `utils/payees/paidTo.rowEligibility`).
2. **Fulfil Payment** (a payment): `pages/ProjectPayments/update-payment/UpdatePaymentDialog.tsx` ->
   `api/payments/project_payments.update_payment_request` (`_fulfil_payment`). `Approved` or `Reconciliation Pending
   -> Paid` with a UTR. Rules: status gate, `services/cheques/decide.pay_alone_problem`, UTR uniqueness, `validate_hold`
   on save. No *Ineligible* check; it still accepts `Approved`, skipping Reconciliation Pending.
3. **Record Payment / Mark as Paid** (an expense): `pages/ProjectExpenses/components/UpdatePaymentDetailsDialog.tsx`,
   `pages/NonProjectExpenses/components/UpdatePaymentDetailsDialog.tsx` -> `expense_decision.decide` (`mark_paid`).
   `Approved` or `Reconciliation Pending -> Paid`. Rules: `can_mark_paid`, required date, reference and proof. No
   cheque, hold or *Ineligible* check.
4. **Export for Payment** (ICICI / Cashfree file): `pages/ProjectPayments/bankUploadFile.ts` (`buildBankFile`),
   from AccountantTabs. No status change; writes each PO / WO payment's vendor account through
   `take_vendor_accounts` (skips one no longer Approved), then builds the file. Rules: `rowEligibility` leaves out
   *Ineligible*, `by_cheque` and card / cash rows, in the browser; a held row is kept out only because it cannot be
   ticked (`buildBankFile` does not check the hold).
5. **Bulk Import settle** (a bank line settles a record): `api/outflow_import/expenses.py` (`settle_row`,
   `allocate_row`, `settle_row_partial`, `settle_expense`), `api/outflow_import/link_lines.py` ->
   `services/outflow_import/settle.py` (`settle_payment`, `link_lines_to_expense`). `Reconciliation Pending -> Paid`
   only (`ledgers.SETTLEABLE_STATUSES`). Rules: `require_outflow_access`, status re-read under the lock,
   `pay_alone_problem`, the amount window. The hold cannot apply (a payment is held only while Approved).
6. **Bulk Import creates a Paid expense**: `settle.create_expense_from_row`, from `expenses.create_expense`,
   `cashbook.confirm_cashbook_import`, `porter_create.create_porter_expenses`, `porter_rectify.rectify_porter_rows`.
   Inserts an expense at `Paid`. Rules: `require_outflow_access` only.
7. **Cheque cleared by the bank import**: `api/outflow_import/review.py` -> `services/cheques/bank_import.clear_from_line`
   -> `services/cheques/status.clear` (`_pay`; old-type cheques also `old_type_clear.settle_lines`). The cheque's
   payments go `Reconciliation Pending -> Paid`, first brought forward from Requested / CEO Pending / Rejected. Rules:
   `clear_problem` refuses a held payment, the bank line must match, `validate_paid_by_clear`.
8. **Cheque payment approved**: `services/cheque_payments.move_to_reconciliation` / `to_reconciliation` (from the
   payment create and approve endpoints, `bulk_actions`, `cheques/decide.py`, and `set_payment_hold` on release).
   `Approved -> Reconciliation Pending` with no Mark as Paid. Rules: skips a held payment; `refuse_lone_approval`.
9. **Pay TDS**: `api/tds_challan/pay_tds.py` (`pay_tds`, `create_challan_and_pay` -> `_apply`). Payment TDS
   Deduction `Pending -> Paid` by `db.set_value` (no `validate`). Rules: write permission on both doctypes.
10. **PO Adjustment / credit transfer** (book entries): `api/po_adjustments/adjustment_logic.execute_adjustment`,
    `_payment_utils._transfer_credit` / `_create_project_payment`. Inserts Project Payments at `Paid` (an Ad-hoc
    entry also a Paid Project Expense, `ignore_permissions`). Rules: no role check on the server; Vendor Hold in the
    browser only.
11. **Desk / REST edit, and an "Add Payment" created as Paid**: Project Payments' `status` is free text and many
    roles hold write, so a hand edit or REST insert can set `Paid` directly; only `validate_hold`, the cheque
    validators, `before_insert`'s over-total check and the Work Order limit apply. The SPA's old Add Payment
    dialogs that insert at `Paid` (`project-payments-list.tsx`, `approved-sr.tsx`, `TransactionDetailsCard.tsx`,
    `approved-sr/hooks/useSRPaymentManager.ts`) have no live trigger. Expenses: `guard_hand_save` refuses a hand
    status change or a non-Requested insert.

Not exits: Expense Request approval (`expense_requests/convert.create_ledger_row` never sets Paid), Vendor Refunds
(money in), payment splits (the paid half goes through line 5), Revert to Approved and Unreconcile (money back).

## Where things are

| What | Where |
|---|---|
| Doctype `Payee` (`PYE-####`) | `nirmaan_stack/doctype/payee/` |
| Payee links | `payee` (Link to Payee) on `Vendors` only; requests and expenses hold a copy (#1438 removed their link; Frappe keeps the old column) |
| Pay-to account (#1436, #1437) | `pay_to_account_name`, `pay_to_account_number`, `pay_to_ifsc`, `pay_to_bank_name`, `pay_to_bank_branch` on `Expense Request`, `Project Expenses`, `Non Project Expenses`, `Project Payments`; `services/payees/pay_to.py`; tests `api/payees/test_payee_link_guard.py`, `api/expense_requests/test_expense_requests.py` (`TestExpenseRequestPayee`), `api/payees/test_payment_pay_to.py` (every payment creator, split remainder, Payee edit) |
| Add Payee endpoints | `api/payees/add_payee.py`: `add_payee`, `check_payee`, `lookup_ifsc` |
| Payees list endpoint | `api/payees/list_payees.get_payees` (data-table contract; the tab is the filter `["tab", "=", "all" \| "no_vendor"]`) |
| Test fixture | `api/payees/payee_fixture.PayeeFixture`: offline IFSC lookups, purges every test Payee; `class_payee` for a `setUpClass` |
| A vendor's account (Bulk Import, autofill) | `services/payees/vendor_account.vendor_accounts()` (no argument: every vendor with a Payee) (#1427) |
| Vendor bank details → Payees (#1424) | `patches/v3_0/move_vendor_bank_details_to_payees.py` (re-runnable; its docstring holds the grouping, fallback and skip rules); test `api/payees/test_vendor_payees_patch.py` |
| Pay-to backfill (#1441) | `patches/v3_0/backfill_pay_to_accounts.py` (re-runnable; its docstring holds the sources and hook reasoning); test `api/payees/test_pay_to_backfill_patch.py` |
| Frontend fields + dialog | `components/payees/` (`PayeeBankFields`, `usePayeeBankForm`, `AddPayeeDialog`) |
| Who gets paid reaching the Expense (moved from the retired Direct Expense suite, #1506) | test `api/expense_requests/test_one_door.py` |
| Expense payee rules (#1429, #1436) | `services/payees/expense_rules.py` (pure: the Required / Optional / Not asked options; the rules are the screen's), `services/payees/expense_payee.py` (`change_expense_account`), `services/payees/search.py` (`find_payees`, by holder name) |
| Expense payee picker endpoints | `api/expense_requests/payees.py` (`search_payees`, `check_request_payee`, `add_request_payee`), gated on `access.can_name_expense_payee` (can raise at least one type); the picked vendor's Payee is `useVendorAccount` (`get_vendor_account`, Vendors read) |
| Frontend picker | `components/payees/PayeePicker.tsx` + `usePayeeChoice.ts` (pick or add new; reused by Change account) |
| Frontend rules | `utils/payees/payeeForm.ts` (form rules, `newPayeeProblem`, `bankLine`), `utils/payees/expensePayee.ts`, `utils/payees/payeeRoutes.ts` (`payeeHref`); pinned to the server's by the shared cases `services/payees/payee_rules_cases.json` (F1: `test_rules.py` / `test_expense_rules.py` and `payeeForm.test.ts` / `expensePayee.test.ts` run the same cases) |
| Payees page | `pages/payees/PayeesPage.tsx`, route `/payees` |
| One Payee's page (#1423, #1435) | `pages/payees/PayeePage.tsx`, route `/payees/:payeeId`; endpoints `api/payees/payee_page.py` (`get_payee`, `edit_payee`, `delete_payee`); `components/payees/EditPayeeDialog` (shared with the vendor screens' `EditVendorPayeeDialog`), `pages/payees/components/DeletePayeeDialog`; rules `utils/payees/payeePage.ts` (tabs), `utils/payees/payeeEdit.ts` (edit form, shared-Payee warning, delete block, last-changed line) |
| Vendor Payee endpoints | `api/payees/vendor_payee.py`: `suggest_vendor_payees`, `get_payee_choice`, `check_vendor_payee`; `get_vendor_account`, `change_vendor_payee` (#1426); `edit_vendor_payee` (#1435) |
| A vendor's account on screens (#1428) | `api/payees/vendor_accounts.py`: `get_vendor_list`; frontend `components/payees/vendorPayeeAccount.ts` (`useVendorAccount`, `useVendorPayeeGate`). The gate blocks a PO / WO payment request until the vendor is KNOWN to have a Payee: while it loads and when the read fails (`utils/payees/vendorAccount.vendorPayeeGateProblem`); used by the PO payment terms card, the PO / WO request dialog and the Credits page's request dialog |
| Paying: Paid to, bank file, Record Payment (#1431, #1438, #1463) | `services/payees/paid_to.py`, `services/payees/take_vendor_account.py`; endpoints `api/payees/paid_to.py` (`get_paid_to`, `take_vendor_accounts`, `get_pay_to_box`, `search_payees`, `change_expense_account`); frontend `components/payees/PayToBox` (expense and PO / WO Record Payment dialogs), `ChangeExpenseAccountDialog`, `paidToApi`; wording and screen rule `utils/payees/paidTo.ts`; file builder `pages/ProjectPayments/bankUploadFile.ts`; tests `api/payees/test_paid_to.py`, `paidTo.test.ts`, `bankUploadFile.test.ts` |
| Vendor page account card + rename prompt (#1426, #1435) | `pages/vendors/components/VendorAccountCard`, `VendorRenameFlow`; `components/payees/ChangeVendorAccountDialog` (Use a different payee), `EditVendorPayeeDialog` (Edit bank details, Update the holder name), `VendorRenamePrompt`; wording in `utils/payees/vendorAccount.ts`; test `api/payees/test_vendor_account.py` |
| Vendor Payee step (frontend) | `components/payees/VendorPayeeSection` + `useVendorPayeeChoice`, `PayeeSuggestionsPanel`, `UsePayeeDialog`, `vendorPayeeApi`; wording in `utils/payees/payeeChoice.ts` |

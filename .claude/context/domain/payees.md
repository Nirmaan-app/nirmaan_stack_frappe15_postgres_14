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
    calling endpoint checks who may add a Payee from that screen. `edit_holder_name` and
    `set_status` (Active / Inactive) are the only edits.
  - `links.py`: what a Payee is linked to, "paid" and last paid (`PAYEES_WITH_LINKS_SQL`,
    `payee_summaries`, `is_paid`, `payee_for_vendor`), and one Payee's page (`payee_page`:
    `linked_vendors`, `linked_expenses`, `holder_name_changed_on`).
  - `guard.py`: the refusals `validate` controllers run on every write path (`check_payee_save`,
    `check_payee_pick`).
  - `ifsc.py`: the IFSC lookup (Razorpay), the app's only outside bank service.
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

## Where things are

| What | Where |
|---|---|
| Doctype `Payee` (`PYE-####`) | `nirmaan_stack/doctype/payee/` |
| Payee links | `payee` (Link to Payee) on `Vendors`, `Expense Request`, `Project Expenses`, `Non Project Expenses` |
| Add Payee endpoints | `api/payees/add_payee.py`: `add_payee`, `check_payee`, `lookup_ifsc` |
| Payees list endpoint | `api/payees/list_payees.get_payees` (data-table contract; the tab is the filter `["tab", "=", …]`) |
| Test fixture | `api/payees/payee_fixture.PayeeFixture`: offline IFSC lookups, purges every test Payee |
| Frontend fields + dialog | `components/payees/` (`PayeeBankFields`, `usePayeeBankForm`, `AddPayeeDialog`) |
| Frontend rules | `utils/payees/payeeForm.ts`, `utils/payees/payeeRoutes.ts` (`payeeHref`) |
| Payees page | `pages/payees/PayeesPage.tsx`, route `/payees` |
| One Payee's page (#1423) | `pages/payees/PayeePage.tsx`, route `/payees/:payeeId`; endpoints `api/payees/payee_page.py` (`get_payee`, `edit_holder_name`, `set_payee_status`); `components/payees/EditHolderNameDialog`; rules `utils/payees/payeePage.ts` |

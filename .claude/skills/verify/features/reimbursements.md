# Reimbursements

The Reimbursements page (#1737, ADR-0040 Amendment C) holds every step of a claim: HR decides on Pending Approval,
an Admin on Pending L1 Approval, the CEO on Pending CEO Approval, and Accounts pays on Payment need to be paid and
reconciles on Reconciliation Pending, until the claim shows on Reconciliation Done / Paid. A claim carries its
Non-Project Expense's status by the same name, and that expense no longer shows in Project Payment & Expense. A
Project Manager may raise at most ₹2,000 of claims in a calendar month. The server side is `api/reimbursements/`
(`queue.py` for the tabs, `review.py` for HR's decisions, `claims.py` for raise and the cap) and
`services/reimbursements/`; L1, CEO and Mark as Paid go through Payments' own `decide_expenses`.

Last walked (walk_reimbursements.py): 2026-11-24 UTC at 153adc0d2, passed.

## Sub-features

- `tabs` the tabs each role sees: CEO 8, Admin 7 (no Pending CEO Approval), HR 4, Accountant 5, anyone else only
  Reimbursement Raised By Me.
- `cap` a Project Manager's raise dialog says how much is left this month and refuses a claim past ₹2,000; the server
  refuses the same.
- `hr` HR ticks claims and approves them together (a claim whose month reaches ₹2,000 goes to Pending L1 Approval), and
  rejects one with a reason.
- `status` after each step the claim's status equals its expense's (Requested, CEO Pending, Approved, Reconciliation
  Pending, Paid), read from the DB.
- `payments` a claim's expense is not listed in Project Payment & Expense › All Payments, and its Type facet's Non
  Project Expense count = the DB's Non-Project Expenses less the claim-linked ones, with no Reimbursement option.
- `l1` an Admin approves on Pending L1 Approval: ₹60,000 goes on to CEO Pending, ₹2,500 to Approved.
- `delete` an Admin deletes a Rejected claim from All; claims not Rejected have no Delete.
- `ceo` only the CEO has Pending CEO Approval; their approval makes the claim Approved.
- `action` the Accountant's Action Center lists the claim's expense tagged Reimbursement and opens Payment need to be
  paid searched to the claim, on all months.
- `month` the month picker's tiles, and a claim raised last month listed once All is picked. The tab's badge counts
  every month while the list opens on this month (a "should" check, known since the #1737 walk).
- `pay` Export for Payment reads ICICI - XXXX3327; Mark as Paid moves the claim to Reconciliation Pending.
- `reconcile` Mark Reconciled takes a receipt, UTR and date and makes the claim Paid, listed on Reconciliation Done /
  Paid.

## How to get to it (user POV)

- Sidebar `Reimbursements`. Each role opens on its own step's tab: CEO Pending CEO Approval, Admin Pending L1
  Approval, HR Pending Approval, Accountant Payment need to be paid, anyone else Reimbursement Raised By Me.
- `Raise Reimbursement` (top right) opens the raise dialog.
- Project Payments: sidebar `Project Payment & Expense` › `All Payments`.
- Action Center: the Accountant's Dashboard › `<n> Expenses` › the `Non-Project` group › the item.

## Driving it with drive.py

- **Whole walk.** `python3 -I BIN/walk_reimbursements.py <env> <out dir>`. `setup` picks an unlocked user per role
  (clearing an HR user's asset declaration or audit as that user, on the env only), gives the claimant and the
  Project Manager their own bank account, and raises four claims stamped `Walk <stamp> ...`; the rest walks them.
  Parts: `setup`, `tabs`, `cap`, `hr`, `payments`, `l1`, `admin_delete`, `ceo`, `action`, `pay`, `reconcile`, run in
  that order (each needs the claims where the part before left them; `<out dir>/state.json` keeps them). A part run
  leaves the stamp alone.
- **Tabs.** `get_by_role("tablist", name="Reimbursement tabs")`; a tab's name is its label and count
  (`Reconciliation Done / Paid 1`), matched by regex.
- **Rows.** `tbody tr` filtered by the claim ID; its buttons are named `Approve <ID>`, `Reject <ID>`, `Delete <ID>`,
  `Mark as Paid`, `Mark Reconciled`. Ticked rows show the `Selected claims` group (Approve, Reject, Export for Payment).
- **Dialogs.** Decisions, Mark as Paid and Delete are `alertdialog`s; a monthly-limit box is a checkbox to tick.
  Mark Reconciled's dialog takes the receipt first (`input[type=file]`), then shows `#payment_ref_update_pd` and
  `#payment_date_update_pd`.

## Gotchas

- The claims table searches by Title, not ID: search the walk's stamped titles.
- A "/" in a regex passed to Playwright breaks the selector: `Reconciliation Done / Paid` is matched with `.`.
- Every HR user on the 2026-11-17 template holds an asset with a declaration to sign and a monthly audit to send, so
  the app locks them until both are done.
- The Payments search box reads the expense's description, which ends in `[<claim ID>]`; an expense ID finds nothing.
- The Action Center's tab is named `<count> Expenses` (count first), and the sidebar has its own `Expenses`.
- Mark Reconciled's dialog is titled "Record Payment & Mark as Reconciled" and its button says Mark as Reconciled.

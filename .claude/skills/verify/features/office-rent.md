# Office Rent

An HR Executive raises an Office Rent expense for the landlord's bill incl. 18% GST, and sees before submitting
"Bill = Rent + GST 18% − TDS 10% → Landlord gets". Admin, then the CEO (above ₹50,000) approve it in the approve
dialog, which shows the same five figures. On the CEO's approval the server splits it once: the tax record keeps
the base rent and its 10% TDS (194-I), the Expense keeps the GST and its amount becomes what the landlord gets
(spec #1613, ADR-0043). The Accountant reads the TDS register, pays the landlord from the payments queue, and
reads the split on the Expenses list, the request page and the Non-Project Expenses report.

## Sub-features

- `rent-preview` the New Expense form's line under the Amount: `Bill ₹1,18,000 = Rent ₹1,00,000 + GST 18% ₹18,000
  − TDS 10% ₹10,000 → Landlord gets ₹1,08,000`.
- `rent-approve` the Approve Payments row and the approve dialog's breakdown (Bill, Rent, GST 18%, TDS 10%,
  Landlord gets) and caption "10% TDS (194-I) on the rent will be withheld on approval"; a bill from ₹15,000 needs
  Admin, and above ₹50,000 then the CEO.
- `rent-split` after the approval that lands on Approved: Expense amount ₹1,08,000, `gst_amount` ₹18,000; one
  `Payment TDS Deduction`: gross ₹1,00,000, 10%, ₹10,000, 194-I, the landlord's name and PAN.
- `rent-register` the TDS register (Reports > Payment) row: Gross Amount ₹1,00,000 (switch it on in the View
  menu), TDS ₹10,000. The register has no Section column on screen.
- `rent-pay` the payments queue reads the bill with "To be paid ₹1,08,000"; Mark Reconciled says "Pay ₹1,08,000 to"
  the landlord's account.
- `rent-lists` the Expenses list's Amount cell, the request page ("Raised for ₹1,18,000") and the Non-Project
  Expenses report (Paid rows only) draw the split.

## How to get to it (user POV)

- HR Executive / HR Lead: sidebar `Expenses` -> `New Expense` -> type `Office Rent`.
- Admin, the CEO: sidebar `Project Payment & Expense` (opens on Approve Payments) -> the row's `Approve`.
- Accountant: sidebar `Reports` -> `Payment` (the TDS register); sidebar `Project Payment & Expense` -> `Payment
  need to paid` -> `Mark as Paid`, then `Payment Done / Reconciliation Pending` -> `Mark Reconciled`; sidebar
  `Expenses` -> `All` -> the request link; `Reports` -> `Projects` -> report type `Payments Report (Non-Project)`.

## Driving it with drive.py

Preconditions:

- `DEVENV script <task> BIN/office_rent_seed.py` once per env: it adds two made-up unlocked users
  (`walk-hr@example.com` HR Executive, `walk-accountant@example.com` Accountant; every copied HR Executive and
  Accountant holds an asset, so the access gate locks them), a made-up landlord Payee (`Walk Landlord Account`),
  and Frappe's Home file folder when the env DB lacks it (else every upload fails, "Could not find Folder: Home").
- A password on the env DB for those two, an Admin (`admins@nirmaan.app` on the 2026-10-28 template) and the
  CEO (`nitesh@nirmaan.app`, `constants/authorized_users.CEO_AUTHORIZED_USER`): `DEVENV run <task> set-password`.
- HR Executive is on Records without review (Expense Settings), so the request becomes its Expense on submit.

- **Whole walk.** `python3 BIN/walk_office_rent.py --task <task> --password <pw>` (`--hr`, `--admin`, `--ceo`,
  `--accountant` override the users). It raises a new ₹1,18,000 rent per run (its Office Location carries the
  run's stamp), asserts every screen's text and its DB row (`BIN/office_rent_db.py`, saved as `*.db.json`), and
  exits 1 on any miss. Evidence: one folder per user, steps `01`–`10`.
- **Expense type picker.** A react-select: click `#new_expense_type`, type `Office Rent`, click the option
  `Office Rent Non-Project` (Enter picks the first type, not the typed one).
- **The form's answers.** Rent Month is `input[type=month]` (`2026-10`); Office Location and Landlord Name are the
  dialog's text inputs after `#payee_search`; Landlord PAN is the textbox named `ABCPK1234D`.

## Gotchas

- The New Expense dialog, the approve dialog and the pay dialog are `alertdialog`s, not `dialog`s.
- A list row draws its breakdown after its own data: wait for `Landlord gets` in the row before reading it.
- Tab names with a `/` (`Payment Done / Reconciliation Pending`) need the slash escaped in a Python regex.
- The register's View menu trigger is a `div[aria-haspopup=menu]`, not a button.
- The sentence on an existing site still reads "(10% TDS will be deducted)": Office Rent's form lives in each
  site's DB, and only a new site's seed carries the GST sentence (spec #1613, owner to decide a patch).
- The Non-Project Expenses report lists Paid rows only; the standalone page's tab is hidden in Expenses.

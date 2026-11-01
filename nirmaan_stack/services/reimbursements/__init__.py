"""The Reimbursement module: a Nirmaan user's claim to be repaid money they spent for work.

A Reimbursement is money of its own, never an Expense Request and never an Expense: it counts in no
financial figure and the bank-statement import does not match it. Domain doc:
`.claude/context/domain/reimbursements.md`; glossary: root `GLOSSARY.md` § Reimbursements.

* `rules.py` (pure) -- who decides a claim, and when it may be edited or deleted.
* `access.py` -- the same rules answered for a logged-in user (role profiles).
* `receipts.py` -- merging a claim's PDFs and pictures into one PDF, and storing its files.

The claimant's own bank account is a Payee rule, so it lives in `services/payees/own_accounts.py`.
"""

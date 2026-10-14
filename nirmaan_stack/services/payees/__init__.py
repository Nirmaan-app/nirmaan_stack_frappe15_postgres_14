"""The Payee module (spec #1420, ADR-0033): the one place that owns Payee rules.

* `rules` (pure) -- `parse_details`, `details_problem`, `duplicate_problem`, `locked_change_problem`,
  `status_change_problem`, `inactive_pick_problem`, `PAYEE_STATUSES`, `PAID_STATUSES`.
* `writer` -- `create_payee` (the only creator), `edit_holder_name`, `set_status`, `existing_payee`,
  `assert_not_duplicate`, `DuplicatePayeeError`.
* `links` -- `payee_summaries` / `payee_summary`, `is_paid`, `payee_for_vendor`,
  `PAYEES_WITH_LINKS_SQL`, `payee_page` (`linked_vendors`, `linked_expenses`, `holder_name_changed_on`).
* `guard` -- what `validate` controllers refuse on every write path: `check_payee_save` (Locked, the
  holder-name role), `check_payee_pick` (Inactive can't be newly picked).
* `ifsc` -- `lookup_ifsc` (refuses an IFSC it can't find), `fetch_ifsc` (the HTTP call tests patch).
* `expense_rules` (pure) / `expense_payee` -- the Expense payee: an expense type's Required / Optional
  / Not asked, the vendor's Payee, Inactive (`request_payee_for`, `change_expense_payee`).
* `search` -- `search_active_payees`, for the Expense Request's picker.
* `matching` (pure) -- `rank_payees`, `name_similarity`: which Payees look like a vendor.
* `choosing` -- `suggest_for_vendor`, `payee_choices` / `payee_choice`, `assert_pickable`,
  `choose_payee`: a vendor's Payee.
* `vendor_account` -- `vendor_accounts`: a vendor's bank account (its Payee), for screens, Bulk
  Import's vendor index and the payment autofill.
* `paid_to` -- `paid_to_rows`, `paid_to_for`, `expense_pay_to`: who a payment or expense row is paid to.

Import from the submodule (`from nirmaan_stack.services.payees.writer import create_payee`).
Invariants: `.claude/context/domain/payees.md`.
"""

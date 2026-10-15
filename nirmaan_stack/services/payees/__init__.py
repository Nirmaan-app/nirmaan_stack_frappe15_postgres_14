"""The Payee module (spec #1420, ADR-0033): the one place that owns Payee rules.

A Payee is an address book entry (#1434): no status, no lock once paid, no holder-name role, and
nothing paid points back at it.

* `rules` (pure) -- `parse_details`, `details_problem`, `duplicate_problem`, `PAID_STATUSES`
  (= `settlement.SETTLED_STATUSES`).
* `writer` -- `create_payee` (the only creator), `edit_holder_name`, `existing_payee`,
  `assert_not_duplicate`, `DuplicatePayeeError`; a duplicate as data for a screen
  (`duplicate_verdict`, `unless_duplicate`).
* `links` -- `payee_summaries` / `payee_summary` (with the vendor count), `PAYEES_WITH_LINKS_SQL`,
  `payee_page` (`linked_vendors`, `holder_name_changed_on`).
* `versions` -- the Version rows read as history: `last_field_change`, `changed_field_pattern`.
* `guard` -- what `validate` controllers refuse on every write path: `check_payee_links` (a vendor's
  Payee, an expense type's Who gets paid, an expense's Payee fixed once paid and changed only by
  Accounts, who sets a vendor's Payee).
* `ifsc` -- `lookup_ifsc` (refuses an IFSC it can't find), `fetch_ifsc` (the HTTP call tests patch).
* `expense_rules` (pure) / `expense_payee` -- the Expense payee: an expense type's Required / Optional
  / Not asked, the vendor's Payee (`follow_vendor`), paid (`payee_rule`, `change_expense_payee`).
* `search` -- `find_payees`, for every Payee picker, by holder name.
* `matching` (pure) -- `rank_payees`, `name_similarity`: which Payees look like a vendor.
* `choosing` -- `suggest_for_vendor`, `payee_choices` / `payee_choice`, `choose_payee`,
  `link_vendor`: picking a vendor's Payee.
* `vendor_account` -- THE vendor -> Payee read: `payee_for_vendor`, `vendor_account` (one vendor, with
  `other_vendors`), `vendor_accounts` (many, for screens, Bulk Import's vendor index, the autofill).
* `paid_to` -- `paid_to_rows`, `paid_to_for`, `expense_pay_to`: who a payment or expense row is paid to.

Import from the submodule (`from nirmaan_stack.services.payees.writer import create_payee`).
Invariants: `.claude/context/domain/payees.md`.
"""

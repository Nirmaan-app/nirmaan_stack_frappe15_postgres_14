"""The Payee module (spec #1420, ADR-0033): the one place that owns Payee rules.

A Payee is an address book entry (#1434): no status, no lock once paid, no holder-name role, and
nothing paid points back at it.

* `rules` (pure) -- `parse_details`, `details_problem`, `duplicate_problem`, `PAID_STATUSES`
  (= `settlement.SETTLED_STATUSES`).
* `writer` -- `create_payee` (the only creator), `edit_payee` (holder name, account number, IFSC, in
  place, #1435), `delete_payee` (only while no vendor links to it), `existing_payee`,
  `assert_not_duplicate`, `DuplicatePayeeError`; a duplicate as data for a screen
  (`duplicate_verdict`, `unless_duplicate`).
* `links` -- `payee_summaries` / `payee_summary` (with the vendor count), `PAYEES_WITH_LINKS_SQL`,
  `payee_page` (`linked_vendors`, `last_changed`: when and by whom the holder name / account changed).
* `versions` -- the Version rows read as history: `last_field_change`, `changed_field_pattern`.
* `guard` -- what `validate` controllers do on every write path: `check_payee_links` (a record naming
  a vendor copies the vendor's Payee into its pay-to account; who sets a vendor's Payee).
* `pay_to` -- a record's own pay-to account: `copy_payee_account` (THE copy), `copy_vendor_account`,
  `copy_pay_to`, `fill_from_vendor`, `pay_to_account`, `PAY_TO_FIELDS`.
* `ifsc` -- `lookup_ifsc` (refuses an IFSC it can't find), `fetch_ifsc` (the HTTP call tests patch).
* `expense_rules` (pure) / `expense_payee` -- an expense type's Required / Optional / Not asked (screen
  rules); `change_expense_account` (Record Payment's Change account overwrites an expense's copy).
* `search` -- `find_payees`, for every Payee picker, by holder name.
* `matching` (pure) -- `rank_payees`, `name_similarity`: which Payees look like a vendor.
* `choosing` -- `suggest_for_vendor`, `payee_choices` / `payee_choice`, `choose_payee`,
  `link_vendor`: picking a vendor's Payee.
* `vendor_account` -- THE vendor -> Payee read: `payee_for_vendor`, `vendor_account` (one vendor, with
  `other_vendors`), `vendor_accounts` (many, for screens, Bulk Import's vendor index, the autofill).
* `paid_to` -- `paid_to_rows`, `paid_to_for`, `pay_to_box`: who a payment or expense row is paid to,
  always its own pay-to account (#1438).

Import from the submodule (`from nirmaan_stack.services.payees.writer import create_payee`).
Invariants: `.claude/context/domain/payees.md`.
"""

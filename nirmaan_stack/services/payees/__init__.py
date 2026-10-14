"""The Payee module (spec #1420, ADR-0033): the one place that owns Payee rules.

* `rules` (pure) -- `parse_details`, `details_problem`, `duplicate_problem`, `PAYEE_STATUSES`,
  `PAID_STATUSES`.
* `writer` -- `create_payee` (the only creator), `existing_payee`, `assert_not_duplicate`,
  `DuplicatePayeeError`.
* `links` -- `payee_summaries` / `payee_summary`, `is_paid`, `payee_for_vendor`,
  `PAYEES_WITH_LINKS_SQL`.
* `ifsc` -- `lookup_ifsc` (refuses an IFSC it can't find), `fetch_ifsc` (the HTTP call tests patch).

Import from the submodule (`from nirmaan_stack.services.payees.writer import create_payee`).
Invariants: `.claude/context/domain/payees.md`.
"""

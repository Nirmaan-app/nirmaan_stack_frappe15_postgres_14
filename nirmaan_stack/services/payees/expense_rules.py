# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An expense type's *Who gets paid* (spec #1420 tickets #1429, #1436, ADR-0033).

PURE MODULE -- no `frappe`, no database.

Each **expense type** says whether a request names who gets paid (`Expense Type.payee_rule`):

* *Required* -- the request can't be sent without a pay-to account.
* *Optional* -- it can be left blank (costs sometimes paid by card or cash).
* *Not asked* -- the request shows no payee field. The default.

These are SCREEN rules (#1436, owner 2026-10-15): the request dialog blocks sending
(`frontend/src/utils/payees/expensePayee.whoGetsPaidProblem`); the server refuses none of them. What
the server does is copy accounts: a picked Payee's, or a named vendor's (`services/payees/pay_to`).
"""

REQUIRED = "Required"
OPTIONAL = "Optional"
NOT_ASKED = "Not asked"
#: Pinned to `Expense Type.payee_rule`'s options by test. `NOT_ASKED` is the field's default.
PAYEE_RULES = (REQUIRED, OPTIONAL, NOT_ASKED)

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""What a Link refusal must and must not say, shared by the Link refusal tests (#1601, #1606, #1611).

A test helper, not a test module: imported by `test_cashbook_link_holds_txn_id`, `test_link_to_its_own_expense` and
`test_link_refusals_told_in_words`, so the words a refusal must never show are listed once.
"""

import frappe

from nirmaan_stack.services.outflow_import.import_created_expense import IMPORT_CREATED_EXPENSE_INDEX
from nirmaan_stack.services.outflow_import.settled_target_index import SETTLED_TARGET_INDEX

# The raw database error's words. A Link refusal by either match index reaches the person as a sentence, so none of
# these may appear in it. Built from the two index constants, so a renamed index is still caught.
RAW_DATABASE_WORDS = (
    "UniqueViolation",
    "duplicate key",
    "IntegrityError",
    SETTLED_TARGET_INDEX,
    IMPORT_CREATED_EXPENSE_INDEX,
)


def assert_no_raw_database_words(case, message: str) -> None:
    """Fail `case` when `message` shows any of `RAW_DATABASE_WORDS`."""
    for word in RAW_DATABASE_WORDS:
        case.assertNotIn(word, message)


def assert_refused_in_words(case, attempt, exc_class, names) -> str:
    """Run `attempt`, expect it refused with `exc_class` in words naming every one of `names` and showing none of
    `RAW_DATABASE_WORDS`, and return the sentence. Commits after the refusal, as the request's end would, so the
    caller's checks read the database as the person's next request does."""
    with case.assertRaises(exc_class) as refused:
        attempt()
    frappe.db.commit()
    message = str(refused.exception)
    assert_no_raw_database_words(case, message)
    for name in names:
        case.assertIn(name, message)
    return message

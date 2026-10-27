# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The comment an expense created from a bank line carries.

PURE MODULE -- standard library only, no `frappe`; `test_import_comment.TestPurity` holds it there.

WHAT IT IS FOR
    Nobody opening an expense form sees the `Outflow Row Match` that ties it to its bank line, so
    the expense says where it came from in its own `comment`: `Imported from <batch>`. The
    reconciliation dialog also lets the person type a comment of their own. A typed comment is kept
    WITH the note, never instead of it, so the record always says which import made it.

⚠️ THE FIELD IS 140 CHARACTERS. `comment` is a Data field on both expense ledgers, and the database
    refuses anything longer with an error that names neither the field nor the import. A composed
    comment that would not fit is refused here first, in words a person can act on.
"""

#: The width of `comment` on `Project Expenses` and `Non Project Expenses` (a Data field).
COMMENT_MAX_LENGTH = 140

_SEPARATOR = " · "


def import_comment(typed: str | None, batch: str) -> str:
    """The comment to store: the typed text, then the import note; or the note alone."""
    note = f"Imported from {batch}"
    text = (typed or "").strip()
    return f"{text}{_SEPARATOR}{note}" if text else note


def import_comment_problem(typed: str | None, batch: str) -> str | None:
    """Why this typed comment cannot be stored, or `None` when it fits."""
    if len(import_comment(typed, batch)) <= COMMENT_MAX_LENGTH:
        return None
    room = COMMENT_MAX_LENGTH - len(import_comment(None, batch)) - len(_SEPARATOR)
    return f"The comment is too long. Keep it to {room} characters."

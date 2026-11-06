# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Which database failure is which: "another reviewer wrote to this transfer first" (issue #1246),
and "this unique index refused the write" (#1588, #1606; moved here at #1611, ADR-0010).

PURE MODULE -- no frappe, no DB, no request context. Each function answers one question about an
exception object, so the endpoint that translates a refusal and the tests that pin it read one
definition.

⚠️ `is_concurrent_writer_refusal` RECOGNISES EXACTLY ONE FAILURE, AND THE NARROWNESS IS THE POINT. Whatever it says yes to is
told to a reviewer as "another user may have already resolved this transfer" -- a harmless race.
Say yes to a genuinely different fault and that fault is reported as harmless, confidently, on a
screen that settles money. So every near-miss is deliberately OUTSIDE:

  * `InFailedSqlTransaction` -- what the same race looks like with the row lock removed (ADR-0020
    Amendment B2), but ALSO what any statement raises after any earlier swallowed error. It carries
    no cause, so it must not be given one.
  * `DeadlockDetected` -- the serialization failure's own sibling under `TransactionRollbackError`.
    A deadlock can be two unrelated writers. That is why the test below is on the CLASS and never on
    the shared parent.

⚠️ THE CHECK IS `isinstance`, NOT `pgcode`, AND BOTH MEAN SQLSTATE 40001. psycopg2 raises a
server's 40001 as exactly `SerializationFailure` (its errors module maps each SQLSTATE to one
class). `pgcode` is filled in only for an error that came off the wire, so a class check is the one
that a test can exercise without a second connection -- and it is the same fact.
"""

from psycopg2.errors import SerializationFailure, UniqueViolation

__all__ = ["is_concurrent_writer_refusal", "is_unique_refusal_by_index"]


def is_concurrent_writer_refusal(exc: BaseException) -> bool:
    """True only for Postgres refusing this transaction because another one updated the row first.

    Under the REPEATABLE READ isolation Frappe runs each session at (Amendment B1), that is what the
    losing reviewer's `FOR UPDATE` row read raises once the winner commits. Nothing is written by
    the loser; the refusal itself is correct and is not relaxed anywhere -- only its wording is.
    """
    return isinstance(exc, SerializationFailure)


def is_unique_refusal_by_index(exc: BaseException, index_name: str) -> bool:
    """True only for a `UniqueViolation` whose constraint is `index_name`. Follows the cause chain and Frappe's
    wrapping (`UniqueValidationError(doctype, name, exc)`). Read by `import_created_expense` and
    `settled_target_index`, so their two refusals are recognised one way: by the index's NAME, never by the
    error's class alone, so no other unique key is ever relabelled."""
    seen = set()
    pending = [exc]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, UniqueViolation):
            diag = getattr(current, "diag", None)
            if getattr(diag, "constraint_name", None) == index_name:
                return True
        pending.extend([current.__cause__, current.__context__])
        pending.extend(arg for arg in getattr(current, "args", ()) if isinstance(arg, BaseException))
    return False

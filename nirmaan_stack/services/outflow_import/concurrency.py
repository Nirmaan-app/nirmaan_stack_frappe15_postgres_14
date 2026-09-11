# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Which database failure means "another reviewer wrote to this transfer first" (issue #1246).

PURE MODULE -- no frappe, no DB, no request context. It answers one question about an exception
object, so the endpoint that translates the refusal and the tests that pin it read one definition.

⚠️ IT RECOGNISES EXACTLY ONE FAILURE, AND THE NARROWNESS IS THE POINT. Whatever this says yes to is
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

from psycopg2.errors import SerializationFailure

__all__ = ["is_concurrent_writer_refusal"]


def is_concurrent_writer_refusal(exc: BaseException) -> bool:
    """True only for Postgres refusing this transaction because another one updated the row first.

    Under the REPEATABLE READ isolation Frappe runs each session at (Amendment B1), that is what the
    losing reviewer's `FOR UPDATE` row read raises once the winner commits. Nothing is written by
    the loser; the refusal itself is correct and is not relaxed anywhere -- only its wording is.
    """
    return isinstance(exc, SerializationFailure)

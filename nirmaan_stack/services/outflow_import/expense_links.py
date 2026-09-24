# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Is this expense fully linked? The one home of that answer (ADR-0027, #1296).

An expense (Project Expenses or Non Project Expenses) may be settled by many bank lines. Each link
is one live `Settled` `Outflow Row Match` slip, and the expense's **linked total** is the SUM of
those slips' `target_amount` -- always read from the slips, never stored and never incremented.

Two halves, deliberately in one module:

  * `load_expense_links` -- ONE database aggregate: the linked total and the date of the latest
    linked line. It reads, never writes, and takes no request context.
  * `derive_expense_status` / `remaining_balance` -- PURE. Given the expense's amount and those
    two facts they return Paid or Reconciliation Pending, the payment date, and what is left.
  * The three REFUSAL builders (#1302) -- also pure. They are rules 1-3 of the four document rules
    `integrations/controllers/expense_bank_links.py` applies on every save and delete; rule 4 is
    `derive_expense_status` itself. Each returns the sentence a person should read, or `None`.

⚠️ THE ₹5 WINDOW IS `amounts.AMOUNT_TOLERANCE`, THE SAME ONE THE MATCHER POOL AND THE SETTLE GUARD
READ. A copy here would let an expense read Paid that the settle guard still thinks has room, or
the other way round.

⚠️ NOT A B1 `PURE_MODULES` ENTRY, because the aggregate lives here too (the ticket puts both in one
services module). The decision functions below it touch no database and are unit-tested without
bench (`test_expense_links.py`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import re

import frappe

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.amounts import (
    AMOUNT_TOLERANCE,
    amounts_match,
    rupees,
    to_decimal,
)
from nirmaan_stack.services.outflow_import.ledgers import PAID, RECONCILIATION_PENDING

__all__ = [
    "ExpenseLinks",
    "ExpenseStatus",
    "amount_below_links_refusal",
    "bulk_id_of",
    "delete_while_linked_refusal",
    "derive_expense_status",
    "lines_fit",
    "linked_totals_join",
    "list_expense_lines",
    "one_line_fits",
    "load_expense_links",
    "load_linked_totals",
    "paid_while_short_refusal",
    "remaining_balance",
]

# Spelled here rather than imported from `api/`: a service never reaches up into the api layer.
_MATCH_DOCTYPE = "Outflow Row Match"
_ROW_DOCTYPE = "Outflow Import Row"


@dataclass(frozen=True)
class ExpenseLinks:
    """What an expense's live slips add up to."""

    linked_total: Decimal
    latest_line_date: date | None
    # How many live slips make up the total -- the picker's "25 lines", and what tells a settle
    # whether the expense will end with exactly one slip (the 1:1 extras, ADR-0027 Q13).
    line_count: int = 0


@dataclass(frozen=True)
class ExpenseStatus:
    """The status an expense's links make it, and the payment date that goes with it."""

    status: str
    payment_date: date | None


def remaining_balance(amount, linked_total) -> Decimal:
    """`amount - linked_total`: how much of the expense no bank line has covered yet."""
    return to_decimal(amount) - to_decimal(linked_total)


def lines_fit(remaining, lines_total) -> bool:
    """Whether bank lines totalling `lines_total` may be linked to an expense with `remaining` left.

    ⚠️ ONE-SIDED, UNLIKE `amounts_match`. Lines BELOW what is left fit -- that is a part-fill, and the
    expense stays Reconciliation Pending (Q19). Only lines exceeding it by more than
    `AMOUNT_TOLERANCE` are refused, and then ALL of them are (Q16). The same ₹5 the status reads, so
    lines that squeeze in are exactly the lines that make the expense Paid.
    """
    return to_decimal(lines_total) - to_decimal(remaining) <= AMOUNT_TOLERANCE


def one_line_fits(amount, links: ExpenseLinks, line_amount) -> bool:
    """Whether ONE bank line may be settled against this expense from Decide (ADR-0027 Q17, #1299).

    ⚠️ TWO RULES, CHOSEN BY WHETHER THE EXPENSE HAS LINES YET. With none, the line must equal the
    whole amount within ₹5 -- the 1:1 settle exactly as it always was, refusal included. With some, the
    line is measured against what is LEFT and may part-fill it (`lines_fit`), which is the late line of
    a run this exists for. Decide does not START a run: a first line that only part-fills a fresh
    expense goes through "Link N to one expense", where the person sees the run's total first.

    ONE predicate for the picker's `suggested` flag and for `settle_row`'s refusal, so the screen can
    never offer a pick the write refuses, or hide one it would take.
    """
    if not links.line_count:
        return amounts_match(amount, line_amount)
    return lines_fit(remaining_balance(amount, links.linked_total), line_amount)


# An ICICI bulk-transfer id as it sits in a line's narration: `MMT/IMPS/<ref>/BULD75978325/<name>/..`.
# ⚠️ THE SAME SHAPE `contains_guard._BATCH_ID` REFUSES AS A REFERENCE PIECE, deliberately: that guard
# ignores it because it is shared by every line of a run, which is exactly why it names the run here.
# `bulkIdOf` in the frontend's `linkLinesView.ts` spells it too, pinned by `linkLinesParity.test.ts`.
_BULK_ID = re.compile(r"\bBULD\d+\b")


def bulk_id_of(texts) -> str | None:
    """The one bulk id every given narration carries, or `None`.

    ⚠️ `None` WHEN THE LINES DISAGREE OR ANY LINE HAS NONE. The id is written as a many-line expense's
    reference (Q10), and a reference naming one run on an expense that also holds lines from another
    would point a reconciler at the wrong statement. Blank is honest; a guess is not.
    """
    found = set()
    for text in texts:
        ids = set(_BULK_ID.findall(text or ""))
        # ⚠️ A NARRATION CUT AT THE COLUMN WIDTH REPEATS THE ID TRUNCATED (`.../BULD67453750  /NAME/
        # BULD67`, measured in `parser.py`). A prefix of another id on the same line is that stub.
        ids = {i for i in ids if not any(o != i and o.startswith(i) for o in ids)}
        if len(ids) != 1:
            return None
        found |= ids
    return found.pop() if len(found) == 1 else None


def derive_expense_status(amount, links: ExpenseLinks) -> ExpenseStatus:
    """Paid when the linked total reaches the amount within ₹5; otherwise Reconciliation Pending.

    ⚠️ ONLY A SHORTFALL KEEPS IT PENDING. A linked total ABOVE the amount is not reachable -- linking
    is refused past what is left + ₹5, and the amount cannot be edited below the linked total -- so
    it is read as Paid rather than inventing a third state for a case the rules already close. The
    same one-sided reading as `allocation.is_fully_allocated`, and listed beside it in `amounts.py`.

    Paid carries the date of the latest linked line; Reconciliation Pending carries no date.
    """
    if remaining_balance(amount, links.linked_total) > AMOUNT_TOLERANCE:
        return ExpenseStatus(status=RECONCILIATION_PENDING, payment_date=None)
    return ExpenseStatus(status=PAID, payment_date=links.latest_line_date)


# --- the four document rules (ADR-0027 Q11/Q22, #1302) ------------------------------------------
#
# PURE. Each returns the sentence a person should read, or `None` when the rule is satisfied. The
# controller in `integrations/controllers/expense_bank_links.py` loads the links, calls these and
# throws; rule 4 is `derive_expense_status` above, which already existed for the settle.
#
# ⚠️ EVERY ONE OF THEM IS ASKED ONLY WHEN THE EXPENSE HAS LIVE SLIPS, and that gate is the whole
# safety of the change: an expense no bank line has touched -- which is nearly all of them -- must
# behave exactly as it did before this feature existed. The gate lives in the controller, once,
# rather than being repeated as a `line_count` test inside each rule.
#
# ⚠️ THEY NAME **Bulk Import Transactions** AND **Unreconcile** BY THEIR SCREEN NAMES. These
# refusals surface on the old expense pages and in Desk, where the reader has no idea a bank
# statement is involved; a refusal that does not say where to go is a dead end.


def _bank_lines(count: int) -> str:
    """`1 bank line` / `25 bank lines` -- the count is in every one of these sentences."""
    return f"{count} bank line" + ("" if count == 1 else "s")


def amount_below_links_refusal(name: str, amount, links: ExpenseLinks) -> str | None:
    """RULE 1. The amount may not sit below what the bank lines already add up to.

    ⚠️ IT TESTS THE VALUE, NOT THE CHANGE. A save that leaves the expense claiming less money than
    its own lines moved is wrong whoever caused it, so this asks the same question of an amount edit,
    a Desk save and a Data Import row. Nothing can reach it from the link side -- linking is refused
    past what is left -- so in practice only an edit can trip it.

    The same ₹5 the linking guard allows, in the same direction: an amount ₹5 under the linked total
    is the rounding the settle window already tolerates, not a shortfall.
    """
    if remaining_balance(amount, links.linked_total) >= -AMOUNT_TOLERANCE:
        return None
    return (
        f"{rupees(links.linked_total)} is already linked to {name} across "
        f"{_bank_lines(links.line_count)}, so its amount cannot be less than that "
        f"(₹{AMOUNT_TOLERANCE} leeway). Take a line off with Unreconcile on Bulk Import "
        "Transactions first, then lower the amount."
    )


def paid_while_short_refusal(name: str, amount, links: ExpenseLinks) -> str | None:
    """RULE 2. Paid may not be set by hand while the bank lines fall short of the amount (Q12).

    ⚠️ THE CALLER DECIDES THAT IT IS BY HAND -- this only answers "is it short?". The difference
    matters because rule 4 must be free to move an ALREADY-Paid expense to Reconciliation Pending
    when its amount is raised; that is an ordinary edit (Q8), not an attempt to mark it Paid. The
    controller asks this only when the status is ARRIVING at Paid on this save.
    """
    left = remaining_balance(amount, links.linked_total)
    if left <= AMOUNT_TOLERANCE:
        return None
    return (
        f"{name} cannot be marked Paid yet: {rupees(links.linked_total)} is linked across "
        f"{_bank_lines(links.line_count)} and {rupees(left)} is still to link. Link the rest on "
        "Bulk Import Transactions, or lower the amount to what has actually gone out."
    )


def delete_while_linked_refusal(name: str, links: ExpenseLinks) -> str | None:
    """RULE 3. An expense with live slips may not be deleted; the bank lines would point at nothing.

    ⚠️ "LIVE" IS COUNTED AFTER A REVERSED STAMP, and that ordering is what keeps Unreconcile's own
    delete of an import-created expense working: `unreconcile_row` stamps the slip `Reversed` before
    it carries the verdict out, so by the time the delete runs this reads zero. Counting before the
    stamp would make the undo refuse itself.
    """
    if not links.line_count:
        return None
    verb = "is" if links.line_count == 1 else "are"
    them = "it" if links.line_count == 1 else "them"
    return (
        f"{name} cannot be deleted: {_bank_lines(links.line_count)} totalling "
        f"{rupees(links.linked_total)} {verb} linked to it. Take {them} off with Unreconcile on "
        "Bulk Import Transactions first."
    )


def load_expense_links(doctype: str, name: str) -> ExpenseLinks:
    """The expense's linked total and latest linked line date, in ONE aggregate query.

    ⚠️ LIVE SLIPS ONLY (`match_kind = 'Settled'`). A `Reversed` slip was undone and contributes
    nothing -- the same rule `allocation.allocated_of` applies to a row's legs.

    ⚠️ THE LINE DATE IS THE ROW'S `added_on` DATE, the same field a 1:1 settle has always written as
    `payment_date` (`_StagedRow.added_on_date`).
    """
    result = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(m.target_amount), 0) AS linked_total,
               COUNT(m.name) AS line_count,
               MAX(r.added_on) AS latest_added_on
        FROM "tab{_MATCH_DOCTYPE}" m
        LEFT JOIN "tab{_ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE m.target_doctype = %(doctype)s
          AND m.target_name = %(name)s
          AND m.match_kind = %(settled)s
        """,
        {"doctype": doctype, "name": name, "settled": MATCH_SETTLED},
        as_dict=True,
    )[0]
    latest = result.get("latest_added_on")
    if isinstance(latest, datetime):
        latest = latest.date()
    return ExpenseLinks(
        linked_total=to_decimal(result.get("linked_total")),
        latest_line_date=latest,
        line_count=int(result.get("line_count") or 0),
    )


def list_expense_lines(doctype: str, name: str) -> list[dict]:
    """The same live slips `load_expense_links` TOTALS, itemised -- one row per link, oldest first.

    ⚠️ IT LIVES BESIDE THE AGGREGATE ON PURPOSE (#1303, ADR-0010 B2). A list of an expense's bank
    lines and the total of those lines are two readings of ONE fact, and the whole point of this
    module is that there is one definition of a live link. Written in `api/` it would have needed a
    third spelling of the two doctype names and its own `match_kind` filter, free to drift from the
    figure printed above it on the same card.

    ⚠️ LEFT JOIN, LIKE `load_expense_links`. A slip whose import row was deleted still counts towards
    the linked total there, so an inner join here would return fewer lines than the total is made of,
    with nothing on screen to explain the gap. It comes back with blank line facts instead.

    Each row carries the slip (`match`, `import_row`, `target_amount`) and the bank line's own facts.
    Formatting -- which reference wins, how a blank reads -- belongs to the caller.
    """
    return frappe.db.sql(
        f"""
        SELECT m.name              AS match_name,
               m.import_row        AS import_row,
               m.target_amount     AS target_amount,
               r.import_batch      AS import_batch,
               r.added_on          AS added_on,
               r.beneficiary_name  AS beneficiary_name,
               r.bank_reference_no AS bank_reference_no,
               r.transfer_id       AS transfer_id,
               r.remarks           AS remarks,
               -- The bank line's OWN figures, so a card can say when the line is only part used
               -- (split across several records): its amount, status, and what its live slips
               -- -- to any record -- add up to, as magnitudes like `allocation.allocated_of`.
               r.amount            AS line_amount,
               r.row_status        AS line_status,
               (SELECT COALESCE(SUM(ABS(m2.target_amount)), 0)
                FROM "tab{_MATCH_DOCTYPE}" m2
                WHERE m2.import_row = m.import_row
                  AND m2.match_kind = %(settled)s) AS line_reconciled
        FROM "tab{_MATCH_DOCTYPE}" m
        LEFT JOIN "tab{_ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE m.target_doctype = %(doctype)s
          AND m.target_name = %(name)s
          AND m.match_kind = %(settled)s
        ORDER BY r.added_on ASC NULLS LAST, m.name ASC
        """,
        {"doctype": doctype, "name": name, "settled": MATCH_SETTLED},
        as_dict=True,
    )


def load_linked_totals(
    doctype: str, from_date=None, to_date=None
) -> dict[str, ExpenseLinks]:
    """Every expense of one doctype that has live slips -> its linked total and line count, ONE query.

    ⚠️ THE SAME AGGREGATE AS `load_expense_links`, grouped by expense, for a list that needs it for
    many expenses at once (the link dialog's picker, #1298). Kept beside the one-expense read so the
    two cannot drift into counting a linked total differently. `latest_line_date` is not read here.

    `from_date` / `to_date` narrow the slips to those whose BANK LINE falls in that window -- the
    row's `added_on` date, the very field a settle writes as the expense's `payment_date`, so a
    windowed total means the same thing here as a `payment_date` filter does on a Paid record.
    Read by the Outflow Reports, whose "Reconciliation Done" figure has to answer to a date range
    the user picked, on records that carry no `payment_date` of their own.

    ⚠️ A SLIP WHOSE IMPORT ROW WAS DELETED HAS NO DATE, so it counts in the unwindowed total (the
    LEFT JOIN keeps it, matching `load_expense_links`) and falls OUT of a windowed one: nothing can
    honestly place it inside a period. Both readings are deliberate.
    """
    conditions = ["m.target_doctype = %(doctype)s", "m.match_kind = %(settled)s"]
    params = {"doctype": doctype, "settled": MATCH_SETTLED}
    if from_date is not None:
        conditions.append("CAST(r.added_on AS DATE) >= %(from_date)s")
        params["from_date"] = from_date
    if to_date is not None:
        conditions.append("CAST(r.added_on AS DATE) <= %(to_date)s")
        params["to_date"] = to_date

    rows = frappe.db.sql(
        f"""
        SELECT m.target_name,
               COALESCE(SUM(m.target_amount), 0) AS linked_total,
               COUNT(m.name) AS line_count
        FROM "tab{_MATCH_DOCTYPE}" m
        LEFT JOIN "tab{_ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE {" AND ".join(conditions)}
        GROUP BY m.target_name
        """,
        params,
        as_dict=True,
    )
    return {
        r["target_name"]: ExpenseLinks(
            linked_total=to_decimal(r.get("linked_total")),
            latest_line_date=None,
            line_count=int(r.get("line_count") or 0),
        )
        for r in rows
    }


def linked_totals_join(doctype: str, alias: str) -> str:
    """A `LEFT JOIN` giving each expense aliased `alias` its `l.linked_total` and `l.line_count`.

    ⚠️ THE SAME AGGREGATE AS `load_linked_totals` -- live `Settled` slips only, SUMmed by target --
    written as SQL for a query that FILTERS or SORTS on it (the matcher pool and the Approved tab,
    #1299). An expense with no slips gets NULLs, so a reader wraps both in `COALESCE(.., 0)`.

    `doctype` and `alias` are fixed names from the calling module, never a request's string, so
    interpolating them is safe.
    """
    return f"""
        LEFT JOIN (
            SELECT target_name, SUM(target_amount) AS linked_total, COUNT(name) AS line_count
            FROM "tab{_MATCH_DOCTYPE}"
            WHERE target_doctype = '{doctype}' AND match_kind = '{MATCH_SETTLED}'
            GROUP BY target_name
        ) l ON l.target_name = {alias}.name"""

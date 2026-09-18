# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Undo settled legs of one import line, all or nothing (issue #1271, parent #1270).

Thin orchestrator (ADR-0010 B4): authorize -> lock -> read facts -> ask the pure decision module
(`services/outflow_import/unreconcile.py`) -> write -> re-derive -> comment -> commit.

TWO WHITELISTED ENDPOINTS SINCE #1275, both behind the narrower Admin + Accountant Lead check
(`permissions.require_outflow_undo_access`):

  * `get_unreconcile_plan(row)` -- READ ONLY. The bank-line facts and every Settled leg with its
    verdict, its "what happens" sentence and any refusal. What the Unreconcile dialog renders.
  * `unreconcile_row(row, legs | "all", reason)` -- the write. `expenses.reverse_allocation` is a
    wrapper over it with one leg, so there is still exactly one write path for a reversal.

⚠️ THE PLAN IS NEVER TRUSTED BY THE WRITE. Both read the same facts through `_read_facts` and ask the
same `leg_verdict`, but the write reads them again UNDER ITS LOCKS; a plan shown a minute ago may be
out of date, and the write refuses on what is true now.

⚠️ ALL OR NOTHING. Every requested leg's verdict is computed under the locks BEFORE anything is
written; one refused leg throws that leg's sentence and nothing is written. The writes then happen
in ONE savepoint, so a failure half way through (a concurrent writer, a hook) rolls every leg back.

⚠️ LOCK ORDER IS ROW, THEN LEGS, THEN TARGETS (sorted by name) -- the same row-then-payment order
`expenses._load_allocatable_row` takes, so a reversal and an allocation on one transfer queue behind
each other instead of deadlocking. Before #1271 the reversal took no row lock at all.

⚠️ THE CONCURRENT-WRITER REFUSAL IS A SENTENCE HERE TOO, through the same
`_concurrent_writer_refusal_as_sentence` `settle_row` and `allocate_row` share, and it ends at the
commit for the same reason: "nothing was saved" is false after it.

⚠️ EACH LEG IS STAMPED REVERSED BEFORE ITS VERDICT IS CARRIED OUT (#1278). A record the import created
is DELETED, and the leg's save validates its Dynamic Link to the target -- stamped after the delete,
it would refuse a link to a record that is gone. Both happen in the one savepoint either way.
"""

from typing import NamedTuple

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _concurrent_writer_refusal_as_sentence,
    _live_legs,
    _refresh_row_allocation,
    _statement_file_url,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_undo_access
from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    ROW_DOCTYPE,
    _batch_source,
    _refresh_batch_rollup,
)
from nirmaan_stack.api.outflow_import.unreconcile_cleanup import restore_derived_state
from nirmaan_stack.api.outflow_import.unreconcile_created import delete_created, edits_of
from nirmaan_stack.api.outflow_import.unreconcile_split import (
    join_leftover_back,
    read_payment_facts,
    unsplit_fields,
)
from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_REVERSED,
    MATCH_SETTLED,
    allocated_of,
    remaining_of,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    INFLOW_DOCTYPES,
    PAYMENT_DOCTYPE,
    is_expense_doctype,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.settle import (
    _derive_status_and_save,
    _outflow_import_write,
    clear_statement_attachment,
)
from nirmaan_stack.services.outflow_import.settlement_reference import (
    settlement_references_of_row,
)
from nirmaan_stack.services.outflow_import.sources import source_runs_the_matcher
from nirmaan_stack.services.outflow_import.status import derive_batch_status
from nirmaan_stack.services.outflow_import.unreconcile import (
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    VERDICT_REVERT_EXPENSE,
    VERDICT_REVERT_PAYMENT,
    VERDICT_UNLINK_EXPENSE_LINE,
    VERDICT_UNSPLIT_PAYMENT,
    WHOLE_LINE_ONLY_REFUSAL,
    WHOLE_LINE_ONLY_TITLE,
    ExpenseSlip,
    LegFacts,
    LegVerdict,
    first_refusal,
    leg_verdict,
    reverse_all_only,
)

ALL_LEGS = "all"

REASON_REQUIRED = "A reason is required to reverse an allocation."

#: Where a reverted record lands, read from the ONE settleable map (#1289).
#:
#: ⚠️ IT WAS THE LITERAL `"Approved"`, AND THAT BECAME A DEAD END THE DAY THE SETTLE ANCHOR MOVED.
#: Unreconciling exists so a record can wait for the RIGHT bank line; reverting it to `Approved`
#: while the import settles only from `Reconciliation Pending` put it one step further back than it
#: started, so the next line could not settle it until somebody pressed Mark as Done again. The two
#: statuses are a pair -- a revert goes back to wherever a settle comes from, and reading the same
#: map is what keeps that true through the next move as well.
_REVERT_STATUS = settleable_statuses(PAYMENT_DOCTYPE)[0]

_ROW_FIELDS = [
    "name", "amount", "import_batch", "bank_reference_no", "reference_id", "transfer_id",
    "source", "remarks", "settlement_reference", "row_status", "beneficiary_name", "added_on",
]
_LEG_FIELDS = [
    "name", "import_row", "import_batch", "target_doctype", "target_name", "target_amount",
    "match_kind", "matched_at", "created_by_import",
]

class CarriedOut(NamedTuple):
    """What one verdict did to its target -- what `unreconcile_cleanup` puts right around."""

    doctype: str
    name: str
    # Only a deleted record carries it: the record is gone by the time the clean-up reads anything.
    project: str | None = None
    deleted: bool = False
    # One line off a many-line expense (#1300) whose other live lines include one from the same
    # statement: the statement stays attached, so its `File` link row stays too.
    statement_held_by_another_line: bool = False


@frappe.whitelist()
def get_unreconcile_plan(row: str) -> dict:
    """What an Unreconcile of this line would do, leg by leg. WRITES NOTHING, TAKES NO LOCK (#1275).

    URL: /api/method/nirmaan_stack.api.outflow_import.unreconcile.get_unreconcile_plan

    Returns the bank-line facts, what is allocated, and one entry per Settled leg: the record, the
    leg's own amount, the verdict, the one-line `what_happens` sentence (`None` on a refusal) and the
    refusal's `reason` / `title` / `fix_at` (`None` otherwise). `refused_count` is what turns Reverse
    all off on the screen -- all-or-nothing is the write's rule, so one refused leg blocks it.

    ⚠️ UNDO ACCESS, NOT THE MODULE GATE. The plan is only ever read to offer an undo, and a plain
    Accountant is offered none (#1270 Q1).
    """
    require_outflow_undo_access()
    line = frappe.db.get_value(ROW_DOCTYPE, row, _ROW_FIELDS, as_dict=True)
    if not line:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")

    legs = frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={"import_row": line.name, "match_kind": MATCH_SETTLED},
        fields=_LEG_FIELDS,
        order_by="matched_at asc, name asc",
    )
    facts = _read_facts(
        legs,
        settlement_references_of_row(line),
        _batch_source(line.import_batch),
        for_update=False,
    )
    verdicts = {leg.name: leg_verdict(facts[leg.name]) for leg in legs}
    return {
        "row": line.name,
        "row_status": line.row_status,
        "amount": float(line.amount or 0),
        "beneficiary_name": line.beneficiary_name,
        "reference": (line.bank_reference_no or "").strip() or (line.transfer_id or "").strip(),
        "added_on": line.added_on,
        "allocated": float(allocated_of(legs)),
        "refused_count": sum(1 for v in verdicts.values() if v.verdict == VERDICT_REFUSED),
        # A vendor refund line is undone whole -- the screen then offers Reverse all only.
        "reverse_all_only": reverse_all_only(legs),
        "legs": [
            {
                "match": leg.name,
                "target_doctype": leg.target_doctype,
                "target_name": leg.target_name,
                "target_amount": float(leg.target_amount or 0),
                "matched_at": leg.matched_at,
                "verdict": verdicts[leg.name].verdict,
                "what_happens": verdicts[leg.name].what_happens,
                "reason": verdicts[leg.name].reason,
                "title": verdicts[leg.name].title,
                "fix_at": verdicts[leg.name].fix_at,
                **unsplit_fields(verdicts[leg.name]),
                **expense_line_fields(verdicts[leg.name]),
            }
            for leg in legs
        ],
    }


@frappe.whitelist(methods=["POST"])
def unreconcile_row(row: str, legs, reason: str) -> dict:
    """Reverse `legs` (a list of match-record names, or `"all"`) on import line `row`.

    URL: /api/method/nirmaan_stack.api.outflow_import.unreconcile.unreconcile_row

    Returns the line's re-derived status, what is allocated and remaining on it now, the import's
    `batch_status`, and one entry per reversed leg with the verdict that was carried out.

    ⚠️ `amount_after` IS READ BACK AFTER THE SAVE, AND IT CAN DIFFER FROM `reversed_amount` (#1275,
    owner ruling). Putting a Service Request payment back to Approved is an approval to its controller,
    which may withhold TDS and NET the amount (`services/payment_tds.py`). That behaviour is left as it
    is; the response reports the new figure so the screen can say so rather than hide it.

    ⚠️ THE LINE GETS ONE COMMENT, inside the transaction: who, why, and which records came off. The
    reason is also stamped on every reversed leg, and each save leaves a Version row.
    """
    actor = require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED, title="Missing reason")

    with _concurrent_writer_refusal_as_sentence("unreconcile_row", row):
        line = _lock_row(row)
        requested = _lock_legs(line, legs)
        # A vendor refund line is undone whole (`reverse_all_only`): a request naming only some of its
        # live legs is refused before anything is read for writing.
        live = _live_legs(line.name)
        if reverse_all_only(live) and {leg.name for leg in requested} != {leg.name for leg in live}:
            frappe.throw(WHOLE_LINE_ONLY_REFUSAL, title=WHOLE_LINE_ONLY_TITLE)
        references = settlement_references_of_row(line)
        facts = _read_facts(
            requested, references, _batch_source(line.import_batch), for_update=True
        )

        verdicts = [leg_verdict(facts[leg.name]) for leg in requested]
        refused = first_refusal(verdicts)
        if refused:
            frappe.throw(refused.reason, title=refused.title)

        statement = _statement_file_url(line.import_batch)
        savepoint = f"ofi_unrec_{frappe.generate_hash(length=10)}"
        frappe.db.savepoint(savepoint)
        try:
            carried = []
            # ONE moment for every leg of this call (#1280): the table reads "which records came off
            # in the last unreconcile" as the legs sharing the latest `reversed_at`.
            reversed_at = frappe.utils.now_datetime()
            for leg, verdict in zip(requested, verdicts):
                # Stamp FIRST -- see the module docstring (a deleted target fails the link check).
                _stamp_reversed(leg.name, actor, reason, reversed_at)
                carried.append(_carry_out(verdict, leg, statement, actor, reason))
            # #1276: vendor credit, CEO Hold, latest payment date and the statement `File` row,
            # once, on the state after EVERY leg -- see `unreconcile_cleanup`.
            restore_derived_state(carried, statement)
            # #1280: the line keeps its old pick, so it is marked Confirm by hand and a bulk confirm
            # refuses it until a person settles it.
            new_status = _refresh_row_allocation(line.name, actor, confirm_by_hand=True)
            _comment_on_line(line.name, actor, reason, requested)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise
        frappe.db.release_savepoint(savepoint)

        statuses = _refresh_batch_rollup(line.import_batch)
        frappe.db.commit()

    remaining_legs = _live_legs(line.name)
    return {
        "row": line.name,
        "row_status": new_status,
        "allocated": float(allocated_of(remaining_legs)),
        "remaining": float(remaining_of(line.amount, remaining_legs)),
        "batch_status": derive_batch_status(statuses),
        "reversed": [
            {
                "match": leg.name,
                "target_doctype": leg.target_doctype,
                "target_name": leg.target_name,
                "verdict": verdict.verdict,
                # Ruling O: the leg's own figure, for comparison against the target's Version log.
                "reversed_amount": float(leg.target_amount),
                "amount_after": _amount_after(leg),
                **unsplit_fields(verdict),
                **expense_line_fields(verdict),
            }
            for leg, verdict in zip(requested, verdicts)
        ],
    }


def expense_line_fields(verdict: LegVerdict) -> dict:
    """What the blue "Only this line comes off" line lists (#1300), for the plan and the response; blank
    on every other verdict."""
    line = verdict.verdict == VERDICT_UNLINK_EXPENSE_LINE
    return {
        "stays_linked": float(verdict.stays_linked) if line else None,
        "other_lines": verdict.other_lines if line else None,
        "expense_amount": float(verdict.expense_amount) if line else None,
        "stays_paid": verdict.stays_paid if line else None,
    }


def _amount_after(leg) -> float | None:
    """The target's amount as it stands after the commit, or `None` when it no longer exists."""
    amount = frappe.db.get_value(leg.target_doctype, leg.target_name, "amount")
    return None if amount is None else float(amount)


def _comment_on_line(row: str, actor: str, reason: str, legs) -> None:
    """"Unreconciled by <user>: <reason> (<N> record(s): <names>)" on the import line (#1275)."""
    count = len(legs)
    names = ", ".join(leg.target_name for leg in legs)
    noun = "record" if count == 1 else "records"
    frappe.get_doc(ROW_DOCTYPE, row).add_comment(
        "Comment", text=f"Unreconciled by {actor}: {reason} ({count} {noun}: {names})"
    )


def _carry_out(
    verdict: LegVerdict, leg, statement_file_url: str | None, actor: str, reason: str
) -> CarriedOut:
    """Perform one verdict on its target. Returns what it did, which is what
    `unreconcile_cleanup.restore_derived_state` puts right around (#1276).

    ⚠️ AN UNKNOWN VERDICT RAISES. The decision module may grow new verdicts; one that is not wired
    here would otherwise stamp the leg Reversed while its target stays settled. Raising inside the
    savepoint rolls every leg back.

    ⚠️ AN UN-SPLIT JOINS THE LEFTOVER BACK FIRST, THEN REVERTS (#1279). Reverting an SR payment to
    Approved may net TDS from its amount (the owner-ruled known limit); doing it after the join nets the
    whole sanction once, instead of a kept half the join then adds to.
    """
    kind = verdict.verdict
    if kind == VERDICT_UNSPLIT_PAYMENT:
        join_leftover_back(leg.target_name, verdict.leftover, actor, reason)
        _revert_payment(leg.target_name, statement_file_url)
        return CarriedOut(leg.target_doctype, leg.target_name)
    if kind == VERDICT_REVERT_PAYMENT:
        _revert_payment(leg.target_name, statement_file_url)
        return CarriedOut(leg.target_doctype, leg.target_name)
    if kind == VERDICT_UNLINK_EXPENSE_LINE:
        held = _unlink_expense_line(leg, statement_file_url)
        return CarriedOut(leg.target_doctype, leg.target_name, statement_held_by_another_line=held)
    if kind == VERDICT_REVERT_EXPENSE:
        _revert_expense(leg.target_doctype, leg.target_name, statement_file_url)
        return CarriedOut(leg.target_doctype, leg.target_name)
    if kind == VERDICT_DELETE_CREATED:
        project = delete_created(leg.target_doctype, leg.target_name, statement_file_url)
        return CarriedOut(leg.target_doctype, leg.target_name, project=project, deleted=True)
    raise NotImplementedError(f"No write for verdict '{kind}' on match record '{leg.name}'.")


def _lock_row(row: str):
    """The import line, under `FOR UPDATE`. The first lock taken; see the module docstring."""
    line = frappe.db.get_value(ROW_DOCTYPE, row, _ROW_FIELDS, as_dict=True, for_update=True)
    if not line:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    return line


def _parse_legs(legs) -> list[str] | str:
    """`"all"`, a JSON array of names (what a form POST sends), a list, or one bare name."""
    if isinstance(legs, str):
        text = legs.strip()
        if text == ALL_LEGS:
            return ALL_LEGS
        legs = frappe.parse_json(text) if text.startswith("[") else [text]
    # A repeat names the same leg twice; reversing it once is what was meant.
    return list(dict.fromkeys((name or "").strip() for name in (legs or []) if name))


def _lock_legs(line, legs) -> list:
    """The requested legs, each under `FOR UPDATE`, in the order they were asked for.

    ⚠️ A leg that is not on THIS line is refused BEFORE it is locked. The row lock serialises
    writers of this line only, so locking another line's leg would take a lock out of order -- and
    that leg would be written without its own line's lock. `import_row` never changes on a match
    record (`Outflow Row Match.validate` freezes it), so reading it unlocked is safe.
    """
    names = _parse_legs(legs)
    if names == ALL_LEGS:
        names = [leg["name"] for leg in _live_legs(line.name)]
        if not names:
            frappe.throw(
                "Nothing on this line is settled, so there is nothing to reverse.",
                title="Nothing to reverse",
            )
    if not names:
        frappe.throw("Choose at least one record to reverse.", title="Nothing selected")

    for name in names:
        import_row = frappe.db.get_value(MATCH_DOCTYPE, name, "import_row")
        if not import_row:
            frappe.throw(f"Match record '{name}' not found.", title="Not found")
        if import_row != line.name:
            frappe.throw(
                f"Match record '{name}' belongs to a different import row, not '{line.name}'.",
                title="Not on this line",
            )
    return [
        frappe.db.get_value(MATCH_DOCTYPE, name, _LEG_FIELDS, as_dict=True, for_update=True)
        for name in names
    ]


def _read_facts(legs, references, source: str, *, for_update: bool) -> dict:
    """One `LegFacts` per leg, keyed by leg name. The ONE reader the plan and the write share.

    With `for_update` (the write) the targets are locked in name order (deadlock-safe); the plan reads
    the same facts with no lock, so the two can only disagree when something changed in between -- and
    then the write, reading under its locks, is the one that is right.

    ⚠️ ONLY A SETTLED PAYMENTS, EXPENSES OR INFLOWS LEG ON A MATCHABLE SOURCE IS READ. Anything else is
    refused by the decision on facts the leg and the line already carry, and locking a record that
    will not be written would only widen the lock.
    """
    facts = {}
    for leg in sorted(legs, key=lambda leg: (leg.target_doctype, leg.target_name)):
        base = {
            "leg": leg.name,
            "match_kind": leg.match_kind,
            "target_doctype": leg.target_doctype,
            "target_name": leg.target_name,
            "leg_amount": leg.target_amount,
            "settlement_references": references,
            "source": source,
            "created_by_import": bool(leg.created_by_import),
            "matched_at": leg.matched_at,
        }
        readable = (
            leg.target_doctype == PAYMENT_DOCTYPE
            or is_expense_doctype(leg.target_doctype)
            or leg.target_doctype in INFLOW_DOCTYPES
        )
        if leg.match_kind != MATCH_SETTLED or not readable or not source_runs_the_matcher(source):
            facts[leg.name] = LegFacts(**base)
            continue
        if is_expense_doctype(leg.target_doctype):
            facts[leg.name] = _read_expense_facts(leg, base, for_update=for_update)
            continue
        if leg.target_doctype in INFLOW_DOCTYPES:
            exists = frappe.db.get_value(
                leg.target_doctype, leg.target_name, "name", for_update=for_update
            )
            facts[leg.name] = LegFacts(
                **base,
                target_exists=bool(exists),
                versions=edits_of(leg.target_doctype, leg.target_name) if exists else (),
            )
            continue
        facts[leg.name] = read_payment_facts(leg, base, for_update=for_update)
    return facts


def _read_expense_facts(leg, base: dict, *, for_update: bool) -> LegFacts:
    """The facts about one expense leg (#1277). Whether the import created it is the leg's stored
    flag (#1278); only a created one needs its Version history, for the edited-since refusal."""
    expense = frappe.db.get_value(
        leg.target_doctype,
        leg.target_name,
        ["status", "amount", "payment_ref"],
        as_dict=True,
        for_update=for_update,
    )
    if not expense:
        return LegFacts(**base, target_exists=False)
    return LegFacts(
        **base,
        target_exists=True,
        target_status=expense.status,
        target_amount=expense.amount,
        target_reference=expense.payment_ref,
        versions=(
            edits_of(leg.target_doctype, leg.target_name) if leg.created_by_import else ()
        ),
        other_slips=_other_slips(leg),
    )


def _other_slips(leg) -> tuple:
    """Every OTHER slip on the leg's expense, live or Reversed (#1300): what tells a line of a many-line
    expense from a 1:1 settle.

    ⚠️ DELIBERATELY UNLOCKED, THE ONE FACT THAT IS. Each of these slips belongs to ANOTHER import line, and
    this call holds only THIS line's lock: locking them would take a lock out of the row-then-legs-then-
    targets order this module's docstring sets, and write no slip under its own line's lock. What the
    fact is protected by instead is the EXPENSE lock, which `_read_expense_facts` takes `for_update`
    immediately before -- and every writer of these slips (`settle.link_lines_to_expense`, this undo)
    takes that same expense lock before it inserts or stamps one. So a slip cannot appear or be reversed
    between this read and the verdict."""
    return tuple(
        ExpenseSlip(
            amount=slip.target_amount,
            live=slip.match_kind == MATCH_SETTLED,
            reversed_at=slip.reversed_at,
        )
        for slip in frappe.get_all(
            MATCH_DOCTYPE,
            filters={
                "target_doctype": leg.target_doctype,
                "target_name": leg.target_name,
                "name": ["!=", leg.name],
            },
            fields=["target_amount", "match_kind", "reversed_at"],
        )
    )


def _unlink_expense_line(leg, statement_file_url: str | None) -> bool:
    """Take one line off a many-line expense (#1300, ADR-0027 Q15). Returns whether another live line
    from the same statement keeps the statement attached.

    ⚠️ THE LEG IS ALREADY STAMPED REVERSED, so the re-derive reads only the lines that stay: Reconciliation
    Pending with no date when they fall short, else Paid on the latest one's date. The same
    `_derive_status_and_save` every expense settle ends in.

    ⚠️ THE AMOUNT, THE REFERENCE AND 'PAID BY' ARE NOT TOUCHED -- other lines still settle the expense,
    and the reference is the run's, not this line's. The statement attachment comes off only when no
    live line from the same import is left.
    """
    doc = frappe.get_doc(leg.target_doctype, leg.target_name)
    held_by_another_line = bool(
        frappe.db.exists(
            MATCH_DOCTYPE,
            {
                "target_doctype": leg.target_doctype,
                "target_name": leg.target_name,
                "match_kind": MATCH_SETTLED,
                "import_batch": leg.import_batch,
            },
        )
    )
    if not held_by_another_line:
        clear_statement_attachment(doc, statement_file_url)
    doc.flags.from_outflow_import = True
    _derive_status_and_save(doc, doc.amount)
    return held_by_another_line


def _revert_expense(doctype: str, name: str, statement_file_url: str | None) -> None:
    """Put an expense back to Approved (#1277). The verdict already said it may; this only writes.

    ⚠️ `doc.save()`, NOT `db.set_value`: `Project Expenses.on_update` is what moves the CEO-Hold
    cashflow gap when a row leaves Paid, and the save leaves a Version row. The hook's per-request
    flag can skip it, so `unreconcile_cleanup` re-syncs the project explicitly afterwards.

    ⚠️ IT CLEARS STATUS / `payment_date` / `payment_ref` / `payment_by` (Project Expenses only) AND
    NOTHING ELSE, bar the statement attachment while it still holds the statement. The dialog's
    `WHAT_HAPPENS_REVERT_*_EXPENSE` sentences say exactly this; change one and change the other. The
    amount is NOT restored (Ruling O).
    """
    doc = frappe.get_doc(doctype, name)
    doc.status = _REVERT_STATUS
    doc.payment_date = None
    doc.payment_ref = None
    if doc.meta.has_field("payment_by"):
        doc.payment_by = None
    clear_statement_attachment(doc, statement_file_url)
    doc.flags.from_outflow_import = True
    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)


def _revert_payment(name: str, statement_file_url: str | None) -> None:
    """Put a payment back where it waits for a bank line. The verdict already said it may.

    ⚠️ `doc.save()`, NOT `db.set_value`. `Paid -> Approved` is exactly the transition
    `update_parent_amount_paid` watches, and it SUMS the Paid payments rather than incrementing, so
    the PO's `amount_paid` self-corrects. A `set_value` would fire no hooks.

    ⚠️ IT CLEARS STATUS / `utr` / `payment_date` AND NOTHING ELSE, bar the statement attachment the
    settle wrote (#1276, only while the field still holds it). That is why the decision module
    refuses a payment carrying TDS or a split it cannot undo, and why its `LEFTOVER_WRITTEN_FIELDS`
    lists exactly these: add a field here and check both, they live and die together. The amount is
    NOT restored (Ruling O); an un-split restores it before this runs (#1279).

    `from_outflow_import` + `_outflow_import_write` suppress the hooks that commit mid-save; a commit
    inside the savepoint would make the all-or-nothing rollback a silent no-op.
    """
    doc = frappe.get_doc(PAYMENT_DOCTYPE, name)
    doc.status = _REVERT_STATUS
    doc.utr = None
    doc.payment_date = None
    clear_statement_attachment(doc, statement_file_url)
    doc.flags.from_outflow_import = True
    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)


def _stamp_reversed(match: str, actor: str, reason: str, reversed_at) -> None:
    """SOFT, NOT A DELETE (ADR-0020 D3): the record is kept, so "this was settled and undone" is
    never lost, and a Reversed leg stops holding the partial unique key."""
    doc = frappe.get_doc(MATCH_DOCTYPE, match)
    doc.match_kind = MATCH_REVERSED
    doc.reversed_at = reversed_at
    doc.reversed_by = actor
    doc.reversal_reason = reason
    # ⚠️ `ignore_version=False` IS EXPLICIT (#1275): the doctype tracks changes since this slice, and
    # Frappe defaults the flag to `frappe.flags.in_test`, which would leave the audit untested.
    doc.save(ignore_permissions=True, ignore_version=False)

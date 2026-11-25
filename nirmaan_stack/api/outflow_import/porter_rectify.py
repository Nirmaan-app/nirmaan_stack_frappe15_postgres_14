# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rectify a created import expense: move it to where it belongs (#1449, spec #1442, ADR-0032; core #1754, spec #1753).

The three moves: Non-Project -> a project, a project -> another project, a project -> Non-Project. Offered
where a Settled line is unreconciled, singly or ticked together, to the same people (undo access: Admin and
Accountant Lead), and always with a typed reason.

THE CORE TAKES THE SOURCE AS AN INPUT (#1754). `plan_rectify(source, rows)` and `rectify_rows(source, rows,
project, reason, expense_type)` are source-neutral; a `RectifySource` (`rectify_sources`) says what differs per import
source: which lines are its own, its sentences, the details its plan shows, how the replacement's description and Paid
by are written, its own writer fields, how its Settled match is recorded, which file never moves, and which lines move
together. `PORTER`, `CASHBOOK` (#1757), `CARD` (#1761), `ICICI` and `CASHFREE` (#1760) are wired. Why a line or
its expense cannot move is `rectify_refusals`; the Move endpoints for any wired source are `rectify`.

Porter's two whitelisted endpoints are the core with `PORTER`, contract unchanged:

  * `get_porter_rectify_plan(rows)` -- READ ONLY. Per line, where its Expense is now, and why it cannot
    be rectified when it cannot; plus the Won projects it may move to.
  * `rectify_porter_rows(rows, project, reason)` -- the write. Every line goes to the ONE placement chosen
    (`project` blank: Non-Project), each line in its own transaction.

EACH LINE, IN ONE SAVEPOINT, COMMITTED BEFORE THE NEXT -- lines that move together (`RectifySource.partners`: a
wallet spend and its refund, #1757) commit together, or none of them does
-----------------------------------------------------
    1. its Settled match -> Reversed, with the reason (`unreconcile.stamp_reversed`)
    2. the replacement Expense, through Create's own writer (`settle.create_expense_from_row`), from the
       OLD EXPENSE's figures: amount, payment date, reference, type, comment, invoice number / date / file
       URL, its pay-to account and approval dates (owner, 2026-11-26), and the source's own fields (Porter: the
       Porter Order) -- only the ledger, the project, the description and Paid by (the source's rule) change
    3. any attachment a person added to the old Expense, and every comment people wrote on it, moves to the new one
    4. its Expense bills, latest and history, follow it (`expense_bills.receive.move_bills`), then the old Expense
       is deleted (`unreconcile_created.delete_created`: series counter kept), so its delete retires no bill
    5. a new Settled match, through the writer the source's Create uses (Porter: `record_porter_match`)
    6. the line's plan, pick and note follow the new Expense; a comment on the line and on the new Expense says
       who, why, and where from
    7. the CEO-Hold cashflow gap of BOTH projects is re-evaluated

⚠️ ALWAYS ALLOWED -- NO "EDITED SINCE" REFUSAL. Unreconcile refuses a created record someone edited, because
it would delete the edit. Rectify carries the Expense over (a Paid Expense's money, date and reference
cannot change in the app), so the only edit it could lose is the description -- and a description that
differs from the generated text is kept (Porter: `porter_wording.rectified_description`).

⚠️ STAMPED BEFORE THE DELETE, as in Unreconcile: the bank-links rule refuses to delete an Expense a Settled
match still points at (ADR-0022 Amendment G).

⚠️ THE PORTER ORDER NEVER CHANGES. The Expense owns the `porter_order` link, so the replacement points at
the same order, and the earlier-imports placement signal (#1448), which follows that link, reads the
rectified project from then on.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.bulk_unreconcile import BULK_UNRECONCILE_LIMIT
from nirmaan_stack.api.outflow_import.expenses import (
    MATCH_DOCTYPE,
    concurrent_writer_refusal_as_sentence,
    live_legs,
)
from nirmaan_stack.api.outflow_import.internal_transfers import INTERNAL_TRANSFER_DOCTYPE
from nirmaan_stack.api.outflow_import.permissions import require_outflow_undo_access
from nirmaan_stack.api.outflow_import.porter_records import (
    ROW_DOCTYPE,
    line_names,
    refuse_unless_won,
    won_projects,
)
from nirmaan_stack.api.outflow_import.rectify_phrase import learn_phrase, phrase_refusal
from nirmaan_stack.api.outflow_import.rectify_refusals import already_there, expense_refusal, line_refusal
from nirmaan_stack.api.outflow_import.rectify_replace import replace_expense
from nirmaan_stack.api.outflow_import.rectify_sources import PORTER, RectifySource
from nirmaan_stack.api.outflow_import.rectify_transfer import (
    TransferTo,
    move_to_internal_transfer,
    refuse_unless_transferable,
    transfer_detail,
    transfer_offer,
)
from nirmaan_stack.api.outflow_import.unreconcile import REASON_REQUIRED, stamp_reversed
from nirmaan_stack.api.outflow_import.unreconcile_cleanup import resync_cashflow_hold
from nirmaan_stack.services.expense_type_ledger import ledger_types
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE, PROJECT_EXPENSE_DOCTYPE

#: The cap the bulk Unreconcile keeps: the screen works one page (50 lines) at a time.
RECTIFY_LIMIT = BULK_UNRECONCILE_LIMIT

#: What every source's line is read with; a source adds its own (`RectifySource.line_fields`).
_ROW_FIELDS = ("name", "import_batch", "source", "row_status", "amount", "direction", "settlement_reference")
_LEG_FIELDS = ["name", "target_doctype", "target_name", "created_by_import"]


def plan_rectify(source: RectifySource, rows) -> dict:
    """Where each ticked line's Expense is now. WRITES NOTHING, TAKES NO LOCK.

    Returns `{"lines": [...], "projects": [{name, project_name}], "types": {ledger: [type]}, "transfer"}` (the Won
    projects, the expense types each ledger takes, and the Internal Transfer destination's `own_place` and
    `other_ends`, or `None` where the source's lines cannot move there, #1762). Each line: `row`,
    `refusal` (`None` when it can be rectified), the source's `line_label`, and when it can move, `amount`,
    `ledger`, `project`, `project_name`, `expense`, the source's `plan_details` and, when `transfer` is offered, the
    `transfer_detail` the dialog starts with.

    ⚠️ A PLAN, NEVER A PROMISE. The write re-reads every line under its own lock.
    """
    require_outflow_undo_access()
    names = _ticked(source, rows)
    transfer = transfer_offer(source.source)
    return {
        "lines": [_plan_of(source, row, frozenset(names), bool(transfer)) for row in names],
        "projects": won_projects(),
        "types": ledger_types(),
        "transfer": transfer,
    }


def rectify_rows(
    source: RectifySource,
    rows,
    project: str | None = None,
    reason: str = "",
    expense_type: str | None = None,
    transfer: TransferTo | None = None,
    phrase: str | None = None,
) -> dict:
    """Move each line's Expense to `project` (blank: Non-Project), each line in its own transaction -- or, for lines
    that must move together (`RectifySource.partners`: a wallet spend and its refund), each such group in one.

    `transfer` (#1762): move each to Internal Transfer instead (`rectify_transfer`); `project` and `expense_type` are
    then not read.

    `expense_type`: the type every replacement takes; blank keeps each one's own. Either way it must suit the
    destination ledger, or the line is refused in the writer's words.

    `phrase` (#1758): for a project destination, saved as an active project alias once at least one line moved
    (`rectify_phrase`); a phrase that already names another project, or one sent with lines of a source that learns
    none (`RectifySource.learns_phrases`: all but Cashbook), refuses the whole write. Ignored for Non-Project
    and for Internal Transfer.

    Returns `{"count": N, "lines": [...]}` (and `"phrase"`, `learn_phrase`'s answer, when one was learned or
    refused), one entry per distinct line in the order sent: either
    `{"row", "rectified": True, "from": {...}, "to": {...}, **source's result}` or
    `{"row", "rectified": False, "reason"}`. Refused outright, writing nothing: no undo access, no reason,
    no lines or too many, a project that does not exist or is not Won, a phrase that names another project.

    ⚠️ A REFUSED LINE NEVER STOPS THE OTHERS, AND NEVER POPS A MESSAGE -- the bulk Unreconcile's shape. A
    line that fails part-way is rolled back whole, with every line of its group: its old Expense and match are as
    they were.
    """
    actor = require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED, title="Missing reason")
    names = _ticked(source, rows)
    project = (project or "").strip() or None
    expense_type = (expense_type or "").strip() or None
    if transfer:
        refuse_unless_transferable(source.source, transfer)
        # A phrase names a project, so a move to Internal Transfer learns none (#1758 with #1762).
        project = expense_type = phrase = None
    elif project:
        refuse_unless_won(project)
    refusal = phrase_refusal(phrase, project, source.learns_phrases)
    if refusal:
        frappe.throw(refusal, title="Phrase not learned")
    done: dict[str, dict] = {}
    for group in _groups(source, names):
        done.update(_rectify_group(source, group, project, reason, actor, len(names), expense_type, transfer))
    result = {"count": len(names), "lines": [done[row] for row in names]}
    learned = learn_phrase(phrase, project) if any(line["rectified"] for line in result["lines"]) else None
    if learned:
        result["phrase"] = learned
    return result


def _groups(source: RectifySource, names: list[str]) -> list[list[str]]:
    """The ticked lines in the order sent, each with the ticked lines it must move with. A partner not ticked is
    the write's refusal to say, under its lock."""
    grouped: set[str] = set()
    groups = []
    for row in names:
        if row in grouped:
            continue
        line = _read_line(source, row)
        partners = source.partners(line)[0] if line else ()
        group = [row] + [p for p in partners if p in names and p not in grouped and p != row]
        grouped.update(group)
        groups.append(group)
    return groups


def _rectify_group(
    source: RectifySource, group: list[str], project: str | None, reason: str, actor: str, count: int,
    expense_type: str | None, transfer: TransferTo | None = None,
) -> dict[str, dict]:
    """The lines of one group, all moved and committed together, or each refused with the sentence. Leaves no lock
    held either way."""
    messages = len(frappe.local.message_log)
    ticked = frozenset(group)
    failed = group[0]
    try:
        moved = {}
        # Locked in one order, whatever the order ticked, so two moves of one pair queue instead of deadlocking.
        for row in sorted(group):
            failed = row
            moved[row] = rectify_line(
                source, row, project, reason, actor, bulk_of=count, ticked=ticked, expense_type=expense_type,
                transfer=transfer, commit=False,
            )
        frappe.db.commit()
        return {row: {"row": row, "rectified": True, **moved[row]} for row in group}
    except frappe.ValidationError as exc:
        _drop_this_line(messages)
        sentence = _sentence(source, exc)
    except Exception:
        _drop_this_line(messages)
        frappe.log_error(title=f"{source.title}: {failed}")
        frappe.db.commit()  # the Error Log row, alone: every earlier group has already committed
        sentence = source.wording.unexpected
    txn = frappe.db.get_value(ROW_DOCTYPE, failed, "transfer_id") or failed
    return {
        row: {
            "row": row,
            "rectified": False,
            "reason": sentence if row == failed else source.wording.partner_failed.format(txn=txn, reason=sentence),
        }
        for row in group
    }


def rectify_line(
    source: RectifySource,
    row: str,
    project: str | None,
    reason: str,
    actor: str,
    *,
    bulk_of: int = 1,
    ticked: frozenset[str] = frozenset(),
    expense_type: str | None = None,
    transfer: TransferTo | None = None,
    commit: bool = True,
) -> dict:
    """Rectify one line, all or nothing, and commit (`commit` False: the caller commits its group). Not whitelisted:
    the caller has checked undo access, the reason and the project. `ticked`: the lines moving with it.

    ⚠️ LOCK ORDER IS ROW, THEN LEG, THEN EXPENSE -- Unreconcile's, so the two queue on one line instead of
    deadlocking. A refusal throws with the locks held; the caller rolls back.
    """
    with concurrent_writer_refusal_as_sentence(source.endpoint, row):
        line = _read_line(source, row, for_update=True)
        legs = [
            frappe.db.get_value(MATCH_DOCTYPE, leg.name, _LEG_FIELDS, as_dict=True, for_update=True)
            for leg in (live_legs(row) if line else [])
        ]
        refusal = line_refusal(source, line, legs, ticked | {row})
        if refusal:
            frappe.throw(refusal, title="Cannot rectify")
        [leg] = legs
        old = frappe.get_doc(leg.target_doctype, leg.target_name, for_update=True)
        refusal = expense_refusal(old, lock=True)
        if refusal:
            frappe.throw(refusal, title="Cannot rectify")
        old_project = old.get("projects") or None
        new_doctype = PROJECT_EXPENSE_DOCTYPE if project else NON_PROJECT_EXPENSE_DOCTYPE
        if not transfer and (new_doctype, project) == (old.doctype, old_project):
            frappe.throw(already_there(source, project), title="Already there")

        names = _project_names(old_project, project)
        replacement = None if transfer else source.replacement(old, line, names.get(old_project), names.get(project))

        savepoint = f"rectify_{frappe.generate_hash(length=10)}"
        frappe.db.savepoint(savepoint)
        try:
            # FIRST: a Settled leg still pointing at the old Expense would refuse its delete.
            stamp_reversed(leg.name, actor, reason, frappe.utils.now_datetime())
            if transfer:
                new_doctype = INTERNAL_TRANSFER_DOCTYPE
                new_name = move_to_internal_transfer(line, old, transfer, reason, actor, source.kept_file_url(old))
            else:
                new_name = replace_expense(source, line, old, new_doctype, project, expense_type, replacement, actor)
            _comment_on_line_and_record(
                line.name, actor, reason, (old.doctype, old.name, old_project), (new_doctype, new_name, project),
                names, bulk_of,
            )
            # LAST: every Paid Expense of both projects is in place. The insert / delete hooks' own check
            # is de-duplicated per request, so it cannot be relied on in a bulk run.
            for touched in sorted({old_project, project} - {None}):
                resync_cashflow_hold(touched)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise
        frappe.db.release_savepoint(savepoint)
        if commit:
            frappe.db.commit()

    return {
        "from": {"doctype": old.doctype, "name": old.name, "project": old_project, "project_name": names.get(old_project)},
        "to": {"doctype": new_doctype, "name": new_name, "project": project, "project_name": names.get(project)},
        **(replacement.result if replacement else {}),
    }


def _read_line(source: RectifySource, row: str, *, for_update: bool = False):
    fields = list(dict.fromkeys(_ROW_FIELDS + source.line_fields))
    return frappe.db.get_value(ROW_DOCTYPE, row, fields, as_dict=True, for_update=for_update)


def _ask(source: RectifySource, line, ticked: frozenset[str]):
    """`(expense, refusal)` for `line` (as `_read_line` read it, or `None`) ticked with `ticked`: the plan's verdict.
    `expense` is `None` when the line itself is refused."""
    legs = (
        [frappe.db.get_value(MATCH_DOCTYPE, leg.name, _LEG_FIELDS, as_dict=True) for leg in live_legs(line.name)]
        if line
        else []
    )
    refusal = line_refusal(source, line, legs, ticked)
    if refusal:
        return None, refusal
    [leg] = legs
    expense = frappe.get_doc(leg.target_doctype, leg.target_name)
    return expense, expense_refusal(expense)


def move_accepts(source: RectifySource, row: str) -> bool:
    """Would the plan let this line move, ticked with the lines it must move with (a wallet spend and its refund)?
    What the page row's `can_move` says (#1762, spec #1753 story 53). WRITES NOTHING, TAKES NO LOCK."""
    line = _read_line(source, row)
    if not line:
        return False
    partners = source.partners(line)[0]
    return _ask(source, line, frozenset({row, *partners}))[1] is None


def _plan_of(source: RectifySource, row: str, ticked: frozenset[str], offers_transfer: bool) -> dict:
    line = _read_line(source, row)
    expense, refusal = _ask(source, line, ticked)
    plan = {"row": row, "refusal": refusal, **source.line_label(line)}
    if refusal:
        return plan
    project = expense.get("projects") or None
    project_name = _project_names(project).get(project)
    return {
        **plan,
        "amount": float(expense.amount or 0),
        "ledger": expense.doctype,
        "project": project,
        "project_name": project_name,
        "expense": expense.name,
        **source.plan_details(line, expense, project_name),
        **({"transfer_detail": transfer_detail(line)} if offers_transfer else {}),
    }


def _project_names(*projects: str | None) -> dict:
    wanted = [p for p in projects if p]
    if not wanted:
        return {}
    return dict(frappe.get_all("Projects", filters={"name": ["in", wanted]}, fields=["name", "project_name"], as_list=True))


def _comment_on_line_and_record(
    row: str, actor: str, reason: str, old: tuple, new: tuple, names: dict, bulk_of: int
) -> None:
    """"Rectified by <user>: <reason> (<old> on <A> -> <new> on <B>)" on the import line and on the new Expense
    (spec #1753 story 24), which names the old one. `old` and `new` are `(doctype, name, project)`."""

    def _where(doctype: str, name: str, project: str | None) -> str:
        return f"{doctype} {name}" + (f" on {names.get(project) or project}" if project else "")

    text = f"Rectified by {actor}: {reason} ({_where(*old)} -> {_where(*new)})"
    if bulk_of > 1:
        text += f" (rectify of {bulk_of} lines)"
    frappe.get_doc(ROW_DOCTYPE, row).add_comment("Comment", text=text)
    frappe.get_doc(new[0], new[1]).add_comment("Comment", text=text)


def _ticked(source: RectifySource, rows) -> list[str]:
    """The distinct line names, in the order sent. Refuses nothing sent, and more than the cap."""
    names = line_names(rows)
    if not names:
        frappe.throw(source.wording.nothing_ticked, title="Nothing ticked")
    if len(names) > RECTIFY_LIMIT:
        frappe.throw(
            source.wording.too_many.format(limit=RECTIFY_LIMIT, count=len(names)),
            title=source.wording.too_many_title,
        )
    return names


def _drop_this_line(messages: int) -> None:
    """Roll back this line's writes and locks, and the messages it queued for the screen."""
    frappe.db.rollback()
    del frappe.local.message_log[messages:]


def _sentence(source: RectifySource, exc: Exception) -> str:
    return frappe.utils.strip_html(str(exc)).strip() or source.wording.unexpected


@frappe.whitelist()
def get_porter_rectify_plan(rows) -> dict:
    """`plan_rectify` for Porter lines. WRITES NOTHING, TAKES NO LOCK.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_rectify.get_porter_rectify_plan?rows=[...]

    Each line: `row`, `crn`, `amount`, `booked_by`, `ledger`, `project`, `project_name`, `expense`,
    `description`, `description_edited` (kept as it is by a Rectify) and `refusal`.
    """
    return plan_rectify(PORTER, rows)


@frappe.whitelist(methods=["POST"])
def rectify_porter_rows(rows, project: str | None = None, reason: str = "") -> dict:
    """`rectify_rows` for Porter lines.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_rectify.rectify_porter_rows
    Body: `rows` (a JSON list of `Outflow Import Row` names, at most `RECTIFY_LIMIT`), `project`, `reason`.

    A moved line: `{"row", "rectified": True, "from": {...}, "to": {...}, "description_kept"}`.
    """
    return rectify_rows(PORTER, rows, project, reason)

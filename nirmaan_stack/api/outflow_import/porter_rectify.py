# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rectify a created Porter order: move its Expense to where it belongs (#1449, spec #1442, ADR-0032).

The three moves: Non-Project -> a project, a project -> another project, a project -> Non-Project. Offered
where a Settled Porter line is unreconciled, singly or ticked together, to the same people (undo access:
Admin and Accountant Lead), and always with a typed reason.

Two whitelisted endpoints:

  * `get_porter_rectify_plan(rows)` -- READ ONLY. Per line, where its Expense is now, and why it cannot
    be rectified when it cannot; plus the Won projects it may move to.
  * `rectify_porter_rows(rows, project, reason)` -- the write. Every line goes to the ONE placement chosen
    (`project` blank: Non-Project), each line in its own transaction.

EACH LINE, IN ONE SAVEPOINT, COMMITTED BEFORE THE NEXT
-----------------------------------------------------
    1. its Settled match -> Reversed, with the reason (`unreconcile._stamp_reversed`)
    2. the replacement Expense, through Create's own writer (`settle.create_expense_from_row`), from the
       OLD EXPENSE's figures: amount, payment date, reference, type, comment, invoice number / date / PDF
       URL and the Porter Order -- only the ledger, the project and the description change
    3. any attachment a person added to the old Expense moves to the new one
    4. the old Expense is deleted (`unreconcile_created.delete_created`: series counter kept)
    5. a new Settled match, `porter.MATCH_BASIS`, `created_by_import`, its project snapshot
    6. the line's plan, pick and note follow the new Expense; a comment on the line says who, why, where
    7. the CEO-Hold cashflow gap of BOTH projects is re-evaluated

⚠️ ALWAYS ALLOWED -- NO "EDITED SINCE" REFUSAL. Unreconcile refuses a created record someone edited, because
it would delete the edit. Rectify carries the Expense over (a Paid Expense's money, date and reference
cannot change in the app), so the only edit it could lose is the description -- and a description that
differs from the generated text is kept (`porter.rectified_description`).

⚠️ STAMPED BEFORE THE DELETE, as in Unreconcile: the leg's Dynamic Link is validated on its save, and the
bank-links rule refuses to delete an Expense a Settled match still points at.

⚠️ THE PORTER ORDER NEVER CHANGES. The Expense owns the `porter_order` link, so the replacement points at
the same order, and the earlier-imports placement signal (#1448), which follows that link, reads the
rectified project from then on.
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe

from nirmaan_stack.api.outflow_import.bulk_unreconcile import BULK_UNRECONCILE_LIMIT
from nirmaan_stack.api.outflow_import.expenses import (
    MATCH_DOCTYPE,
    _concurrent_writer_refusal_as_sentence,
    _live_legs,
    _target_snapshot,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_undo_access
from nirmaan_stack.api.outflow_import.porter import ROW_DOCTYPE, SOURCE
from nirmaan_stack.api.outflow_import.porter_review import refuse_unless_won, won_projects
from nirmaan_stack.api.outflow_import.unreconcile import REASON_REQUIRED, _stamp_reversed
from nirmaan_stack.api.outflow_import.unreconcile_cleanup import _resync_cashflow_hold
from nirmaan_stack.api.outflow_import.unreconcile_created import delete_created
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    is_expense_doctype,
)
from nirmaan_stack.services.outflow_import.porter import (
    MATCH_BASIS,
    booked_by,
    description_hand_edited,
    rectified_description,
    statement_line,
)
from nirmaan_stack.services.outflow_import.settle import ExpenseInvoice, create_expense_from_row
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED

#: The cap the bulk Unreconcile keeps: the screen works one page (50 lines) at a time.
RECTIFY_LIMIT = BULK_UNRECONCILE_LIMIT

#: `settlement_origin` of a rectified line: a person moved it off the import's plan.
_ORIGIN = "Suggestion overridden"

NOT_PORTER_REFUSAL = "Only an order from a Porter Statement import can be rectified."
NOT_SETTLED_REFUSAL = "This order is {status} now, not Settled, so it has no expense to move."
NOT_FOUND_REFUSAL = "This order no longer exists; its import may have been deleted."
NOT_CREATED_REFUSAL = (
    "This order's expense is not one its import created, so it cannot be rectified. Unreconcile it instead."
)
UNEXPECTED_REFUSAL = "Something went wrong rectifying this order, so nothing on it was changed."

_ROW_FIELDS = ["name", "import_batch", "source", "row_status", "transfer_id", "porter_line"]
_LEG_FIELDS = ["name", "target_doctype", "target_name", "created_by_import"]


@dataclass(frozen=True)
class _ExpenseAsRow:
    """The old Expense, in the shape `create_expense_from_row` reads a bank line by attribute.

    ⚠️ THE REPLACEMENT IS BUILT FROM THE OLD EXPENSE, NOT FROM THE STATEMENT LINE. It must be identical to
    what it replaces; the line holds what Porter billed, the Expense what the app recorded.
    """

    amount: object
    added_on_date: object
    settlement_reference: str
    beneficiary_name: str = ""
    remarks: str = ""


@frappe.whitelist()
def get_porter_rectify_plan(rows) -> dict:
    """Where each ticked Porter line's Expense is now. WRITES NOTHING, TAKES NO LOCK.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_rectify.get_porter_rectify_plan?rows=[...]

    Returns `{"lines": [...], "projects": [{name, project_name}]}` (the Won projects). Each line: `row`,
    `crn`, `amount`, `booked_by`, `ledger`, `project`, `project_name`, `expense`, `description`,
    `description_edited` (kept as it is by a Rectify) and `refusal` (`None` when it can be rectified).

    ⚠️ A PLAN, NEVER A PROMISE. The write re-reads every line under its own lock.
    """
    require_outflow_undo_access()
    return {"lines": [_plan_of(row) for row in _line_names(rows)], "projects": won_projects()}


@frappe.whitelist(methods=["POST"])
def rectify_porter_rows(rows, project: str | None = None, reason: str = "") -> dict:
    """Move each line's Expense to `project` (blank: Non-Project), each line in its own transaction.

    URL: /api/method/nirmaan_stack.api.outflow_import.porter_rectify.rectify_porter_rows
    Body: `rows` (a JSON list of `Outflow Import Row` names, at most `RECTIFY_LIMIT`), `project`, `reason`.

    Returns `{"count": N, "lines": [...]}`, one entry per distinct line in the order sent: either
    `{"row", "rectified": True, "from": {...}, "to": {...}, "description_kept"}` or
    `{"row", "rectified": False, "reason"}`. Refused outright, writing nothing: no undo access, no reason,
    no lines or too many, a project that does not exist or is not Won.

    ⚠️ A REFUSED LINE NEVER STOPS THE OTHERS, AND NEVER POPS A MESSAGE -- the bulk Unreconcile's shape. A
    line that fails part-way is rolled back whole: its old Expense and match are as they were.
    """
    actor = require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED, title="Missing reason")
    names = _line_names(rows)
    project = (project or "").strip() or None
    if project:
        refuse_unless_won(project)
    return {
        "count": len(names),
        "lines": [_rectify_one(row, project, reason, actor, len(names)) for row in names],
    }


def _rectify_one(row: str, project: str | None, reason: str, actor: str, count: int) -> dict:
    """One line, or a refused entry with its sentence. Leaves no lock held either way."""
    messages = len(frappe.local.message_log)
    try:
        return {"row": row, "rectified": True, **rectify_line(row, project, reason, actor, bulk_of=count)}
    except frappe.ValidationError as exc:
        _drop_this_line(messages)
        return {"row": row, "rectified": False, "reason": _sentence(exc)}
    except Exception:
        _drop_this_line(messages)
        frappe.log_error(title=f"Porter Rectify: {row}")
        frappe.db.commit()  # the Error Log row, alone: every earlier line has already committed
        return {"row": row, "rectified": False, "reason": UNEXPECTED_REFUSAL}


def rectify_line(row: str, project: str | None, reason: str, actor: str, *, bulk_of: int = 1) -> dict:
    """Rectify one line, all or nothing, and commit. Not whitelisted: the caller has checked undo access,
    the reason and the project.

    ⚠️ LOCK ORDER IS ROW, THEN LEG, THEN EXPENSE -- Unreconcile's, so the two queue on one line instead of
    deadlocking. A refusal throws with the locks held; the caller rolls back.
    """
    with _concurrent_writer_refusal_as_sentence("rectify_porter_rows", row):
        line = frappe.db.get_value(ROW_DOCTYPE, row, _ROW_FIELDS, as_dict=True, for_update=True)
        legs = [
            frappe.db.get_value(MATCH_DOCTYPE, leg.name, _LEG_FIELDS, as_dict=True, for_update=True)
            for leg in (_live_legs(row) if line else [])
        ]
        refusal = _refusal(line, legs)
        if refusal:
            frappe.throw(refusal, title="Cannot rectify")
        [leg] = legs
        old = frappe.get_doc(leg.target_doctype, leg.target_name, for_update=True)
        old_project = old.get("projects") or None
        new_doctype = PROJECT_EXPENSE_DOCTYPE if project else NON_PROJECT_EXPENSE_DOCTYPE
        if (new_doctype, project) == (old.doctype, old_project):
            frappe.throw(_already_there(project), title="Already there")

        booker = booked_by(statement_line(line.porter_line))
        names = _project_names(old_project, project)
        description = rectified_description(old.description, booker, names.get(old_project), names.get(project))

        savepoint = f"porter_rectify_{frappe.generate_hash(length=10)}"
        frappe.db.savepoint(savepoint)
        try:
            # FIRST: a Settled leg still pointing at the old Expense would refuse its delete.
            _stamp_reversed(leg.name, actor, reason, frappe.utils.now_datetime())
            new = create_expense_from_row(
                _ExpenseAsRow(
                    amount=old.amount,
                    added_on_date=old.payment_date,
                    settlement_reference=old.payment_ref or "",
                ),
                doctype=new_doctype,
                expense_type=old.type,
                actor=actor,
                project=project,
                description=description,
                vendor=old.get("vendor") if project else None,
                comment=old.comment,
                statement_file_url=None,
                # Project side only: who booked it, kept as the old Project Expense had it.
                payment_by=old.get("payment_by") or booker or None,
                invoice=ExpenseInvoice(
                    number=old.invoice_ref, date=old.invoice_date, file_url=old.invoice_attachment
                ),
                porter_order=old.porter_order,
            )
            _move_attachments(old, new.doctype, new.name)
            delete_created(old.doctype, old.name, None)
            _record_match(line, new, actor)
            _follow_on_the_line(line.name, new, project, actor)
            _comment_on_line(
                line.name, actor, reason, (old.doctype, old.name, old_project), (new.doctype, new.name, project),
                names, bulk_of,
            )
            # LAST: every Paid Expense of both projects is in place. The insert / delete hooks' own check
            # is de-duplicated per request, so it cannot be relied on in a bulk run.
            for touched in sorted({old_project, project} - {None}):
                _resync_cashflow_hold(touched)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise
        frappe.db.release_savepoint(savepoint)
        frappe.db.commit()

    return {
        "from": {"doctype": old.doctype, "name": old.name, "project": old_project, "project_name": names.get(old_project)},
        "to": {"doctype": new.doctype, "name": new.name, "project": project, "project_name": names.get(project)},
        "description_kept": description_hand_edited(old.description, booker, names.get(old_project)),
    }


def _plan_of(row: str) -> dict:
    line = frappe.db.get_value(ROW_DOCTYPE, row, _ROW_FIELDS, as_dict=True)
    legs = (
        [frappe.db.get_value(MATCH_DOCTYPE, leg.name, _LEG_FIELDS, as_dict=True) for leg in _live_legs(row)]
        if line
        else []
    )
    refusal = _refusal(line, legs)
    plan = {"row": row, "refusal": refusal, "crn": line.transfer_id if line else None}
    if refusal:
        return plan
    [leg] = legs
    expense = frappe.get_doc(leg.target_doctype, leg.target_name)
    project = expense.get("projects") or None
    project_name = _project_names(project).get(project)
    booker = booked_by(statement_line(line.porter_line))
    return {
        **plan,
        "amount": float(expense.amount or 0),
        "booked_by": booker,
        "ledger": expense.doctype,
        "project": project,
        "project_name": project_name,
        "expense": expense.name,
        "description": expense.description,
        "description_edited": description_hand_edited(expense.description, booker, project_name),
    }


def _refusal(line, legs) -> str | None:
    """Why this line cannot be rectified at all, or `None`. The plan and the write ask the same."""
    if not line:
        return NOT_FOUND_REFUSAL
    if (line.source or "").strip() != SOURCE:
        return NOT_PORTER_REFUSAL
    if line.row_status != ROW_SETTLED:
        return NOT_SETTLED_REFUSAL.format(status=line.row_status)
    if (
        len(legs) != 1
        or not legs[0].created_by_import
        or not is_expense_doctype(legs[0].target_doctype)
        or not frappe.db.exists(legs[0].target_doctype, legs[0].target_name)
    ):
        return NOT_CREATED_REFUSAL
    return None


def _already_there(project: str | None) -> str:
    if not project:
        return "This order is already a Non-Project Expense."
    name = frappe.db.get_value("Projects", project, "project_name") or project
    return f"This order is already on {name}."


def _project_names(*projects: str | None) -> dict:
    wanted = [p for p in projects if p]
    if not wanted:
        return {}
    return dict(frappe.get_all("Projects", filters={"name": ["in", wanted]}, fields=["name", "project_name"], as_list=True))


def _move_attachments(old, doctype: str, name: str) -> None:
    """Carry over what a person attached to the old Expense, before the delete would take it.

    ⚠️ RAW, AND THAT IS THE POINT. `frappe.delete_doc` deletes every `File` attached to the old Expense
    through the document layer, and the storage app's `on_trash` then deletes the stored object -- a photo
    someone added would be lost. Re-pointing the `File` row keeps the object and its storage key (which is
    fixed at insert); `File` has no hook on these fields. The `payment_attachment` value is written after
    the insert for the reason `create_expense_from_row` writes `invoice_attachment` so: a save would make a
    second `File` row for it. Nothing is derived from either.
    """
    if old.get("payment_attachment"):
        frappe.db.set_value(doctype, name, "payment_attachment", old.payment_attachment, update_modified=False)
    frappe.db.sql(
        """UPDATE "tabFile" SET attached_to_doctype = %s, attached_to_name = %s
           WHERE attached_to_doctype = %s AND attached_to_name = %s""",
        (doctype, name, old.doctype, old.name),
    )


def _record_match(line, new, actor: str) -> None:
    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": line.name,
            "import_batch": line.import_batch,
            "transfer_id": line.transfer_id,
            "target_doctype": new.doctype,
            "target_name": new.name,
            "target_amount": float(new.amount),
            "match_kind": MATCH_SETTLED,
            "match_basis": MATCH_BASIS,
            "settlement_origin": _ORIGIN,
            "created_by_import": 1,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
            **_target_snapshot(new.doctype, new.name),
        }
    )
    match.insert(ignore_permissions=True)


def _follow_on_the_line(row: str, new, project: str | None, actor: str) -> None:
    """The line's plan and pick follow the new Expense, so a later Unreconcile + Create re-creates it where
    it was rectified to. Its status stays Settled, so the batch rollup does not move.

    Raw: `Outflow Import Row` carries no doc_events.
    """
    frappe.db.set_value(
        ROW_DOCTYPE,
        row,
        {
            "suggested_doctype": new.doctype,
            "resolved_project": project,
            "suggested_name": new.name,
            "outcome_note": f"Rectified to {new.doctype} {new.name}.",
            "decided_at": frappe.utils.now_datetime(),
            "decided_by": actor,
            "settlement_origin": _ORIGIN,
        },
        update_modified=False,
    )


def _comment_on_line(row: str, actor: str, reason: str, old: tuple, new: tuple, names: dict, bulk_of: int) -> None:
    """"Rectified by <user>: <reason> (<old> on <A> -> <new> on <B>)" on the import line. `old` and `new`
    are `(doctype, name, project)`."""

    def _where(doctype: str, name: str, project: str | None) -> str:
        return f"{doctype} {name}" + (f" on {names.get(project) or project}" if project else "")

    text = f"Rectified by {actor}: {reason} ({_where(*old)} -> {_where(*new)})"
    if bulk_of > 1:
        text += f" (rectify of {bulk_of} lines)"
    frappe.get_doc(ROW_DOCTYPE, row).add_comment("Comment", text=text)


def _line_names(rows) -> list[str]:
    """The distinct line names, in the order sent. Refuses nothing sent, and more than the cap."""
    if isinstance(rows, str):
        rows = frappe.parse_json(rows) if rows.strip().startswith("[") else [rows]
    names = list(dict.fromkeys(str(r).strip() for r in (rows or []) if r and str(r).strip()))
    if not names:
        frappe.throw("Tick at least one Porter order to rectify.", title="Nothing ticked")
    if len(names) > RECTIFY_LIMIT:
        frappe.throw(
            f"At most {RECTIFY_LIMIT} orders can be rectified at once; {len(names)} were sent.",
            title="Too many orders",
        )
    return names


def _drop_this_line(messages: int) -> None:
    """Roll back this line's writes and locks, and the messages it queued for the screen."""
    frappe.db.rollback()
    del frappe.local.message_log[messages:]


def _sentence(exc: Exception) -> str:
    return frappe.utils.strip_html(str(exc)).strip() or UNEXPECTED_REFUSAL

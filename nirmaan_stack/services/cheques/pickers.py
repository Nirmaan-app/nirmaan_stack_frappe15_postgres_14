# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the Add Cheque dialog's line pickers offer (spec #1407, #1410; #1482, spec #1477). Reads only.

A Payment cheque's line asks for a project, then one of the Vendor's POs in it, then one of its
payments or "No payment yet":

* `vendor_records` -- every PO of the Vendor that can still hold a payment, with its project, so the
  dialog offers the projects the Vendor has POs in and the POs in each. Work Orders are paid Online.
* `eligible_payments` -- the PO's payments that may go on the cheque: at Requested, CEO Pending or
  Approved, not on hold, on no live (not Cancelled) Cheque, and at the same step as the cheque's other
  payments. It counts what it hid and why, so the dialog can say so.

The same rules are enforced on save (`rules.tracker_payment_cheque_problem`, `lines.lines_problem`);
these lists only spare the user a refusal.
"""

import frappe
from frappe.utils import cint, flt

from nirmaan_stack.services.cheques.lines import live_cheques_of
from nirmaan_stack.services.cheques.rules import PAYMENT_DOCTYPE, PAYMENT_REJECTED, PICKABLE_STEPS, PO_DOCTYPE

#: A PO in these statuses holds no payment of its own any more.
PO_CLOSED_STATUSES = ("Merged", "Cancelled")


def vendor_records(vendor: str) -> list[dict]:
    """`[{doctype, name, project, project_name, status, total_amount}]`: the Vendor's open POs, newest
    first."""
    pos = frappe.get_all(
        PO_DOCTYPE,
        filters={"vendor": vendor, "status": ["not in", PO_CLOSED_STATUSES]},
        fields=["name", "project", "status", "total_amount"],
        order_by="creation desc",
    )
    projects = {r.project for r in pos if r.project}
    project_names = dict(
        frappe.get_all("Projects", filters={"name": ["in", list(projects)]}, fields=["name", "project_name"], as_list=True)
    ) if projects else {}
    return [
        {
            "doctype": PO_DOCTYPE,
            "name": r.name,
            "project": r.project,
            "project_name": project_names.get(r.project) or r.project,
            "status": r.status,
            "total_amount": flt(r.total_amount),
        }
        for r in pos
    ]


def eligible_payments(
    record_name: str, *, exclude_cheque: str | None = None, other_payments=()
) -> dict:
    """The PO's payments that may go on a Payment cheque, and what was hidden.

    `other_payments` are the payments on the cheque's other lines: their step (all one, on a cheque the
    Tracker made) is the only step offered, and they are not offered again. `exclude_cheque` is the
    Cheque being edited: its own payments are not "on a live Cheque". A payment only on Cancelled
    Cheques is offered.

    Returns `{payments: [{name, amount, status, mode_of_payment}], step, hidden: {on_cheque: [{payment,
    cheque, cheque_no, status}], rejected, other_step, on_hold, moved_on: {status: count}}}`. `step` is
    the other lines' step, None while they name no payment; `moved_on` counts the payments already
    past approval (Reconciliation Pending, Paid).
    """
    others = [p for p in other_payments or () if p]
    steps = set(
        (s or "").strip()
        for s in frappe.get_all(PAYMENT_DOCTYPE, filters={"name": ["in", others]}, pluck="status")
    ) if others else set()
    rows = frappe.get_all(
        PAYMENT_DOCTYPE,
        filters={"document_type": PO_DOCTYPE, "document_name": record_name},
        fields=["name", "amount", "status", "mode_of_payment", "on_hold"],
        order_by="creation asc",
    )
    rows = [r for r in rows if r.name not in others]
    live = live_cheques_of(PAYMENT_DOCTYPE, [r.name for r in rows], exclude=exclude_cheque)

    payments, on_cheque, moved_on = [], [], {}
    rejected = other_step = on_hold = 0
    for r in rows:
        status = (r.status or "").strip()
        if status == PAYMENT_REJECTED:
            rejected += 1
        elif r.name in live:
            on_cheque.append({"payment": r.name, **live[r.name]})
        elif status not in PICKABLE_STEPS:
            moved_on[status] = moved_on.get(status, 0) + 1
        elif steps and steps != {status}:
            other_step += 1
        elif cint(r.on_hold):
            on_hold += 1
        else:
            payments.append({
                "name": r.name,
                "amount": flt(r.amount),
                "status": status,
                "mode_of_payment": (r.mode_of_payment or "").strip() or "Online",
            })
    return {
        "payments": payments,
        "step": next(iter(steps)) if len(steps) == 1 else None,
        "hidden": {
            "on_cheque": on_cheque,
            "rejected": rejected,
            "other_step": other_step,
            "on_hold": on_hold,
            "moved_on": moved_on,
        },
    }

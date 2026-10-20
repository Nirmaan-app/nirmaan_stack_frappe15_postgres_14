# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Take the Work Orders off existing Security Deposit cheques (#1518, spec #1514, ADR-0035 Amendment A).

WHY THIS PATCH EXISTS
    Work Orders are never paid by cheque, so they have no cheques at all: a Security Deposit cheque now
    secures POs only, and the `validate` controller refuses a Work Order line on one
    (`rules.secured_line_problem`). Deposit cheques recorded under spec #1477 may still name Work Orders.

WHAT IT DOES, PER DEPOSIT CHEQUE THAT NAMES A WORK ORDER
    * Its Work Order lines are removed, with one history row naming them. Its PO lines stay.
    * The cheque itself is kept at its status, even when no line is left: the paper cheque is still held
      until it comes back.
    Each cheque is written in its own savepoint; one the `validate` controller refuses is listed with the
    reason, and the rest are still written. Payment cheques are not touched.

IDEMPOTENT
    A second run finds no deposit cheque naming a Work Order, so it writes nothing.

HOOKS
    Written through the cheques service (`detach.take_work_orders_off_deposit`): the cheque is saved through
    the document, so its `validate` runs and its history and Version rows are written. No status moves and a
    deposit pays nothing, so no payment is written and nothing is recomputed.

The `patches.txt` line sits under [post_model_sync].
"""

import frappe

from nirmaan_stack.services.cheques.detach import take_work_orders_off_deposit
from nirmaan_stack.services.cheques.rules import CHEQUE_TYPE_SECURITY_DEPOSIT, LINE_SECURED_RECORD, WORK_ORDER_DOCTYPE
from nirmaan_stack.services.cheques.writer import CHEQUES

PATCH = "drop_work_order_deposit_lines"


def execute():
    result = drop_work_order_lines()
    frappe.db.commit()
    for line in summary(result):
        print(f"{PATCH}: {line}")
        frappe.logger("cheques").info(f"{PATCH}: {line}")


def drop_work_order_lines(cheques: list[str] | None = None) -> dict:
    """Take the Work Orders off every deposit cheque that names one -- or only off `cheques`, which is what
    the tests pass so they never touch a cheque they did not plant. Commits nothing.

    Returns `{changed: [{cheque, cheque_no, work_orders}], failed: [{cheque, cheque_no, reason}]}`.
    """
    result = {"changed": [], "failed": []}
    if cheques is not None and not cheques:
        return result
    filters = {"parenttype": CHEQUES, "line_type": LINE_SECURED_RECORD, "record_doctype": WORK_ORDER_DOCTYPE}
    if cheques is not None:
        filters["parent"] = ["in", cheques]
    parents = sorted(set(frappe.get_all("Cheque Line", filters=filters, pluck="parent")))
    if not parents:
        return result
    rows = frappe.get_all(
        CHEQUES,
        filters={"name": ["in", parents], "cheque_type": CHEQUE_TYPE_SECURITY_DEPOSIT},
        fields=["name", "cheque_no"],
        order_by="name",
    )
    for row in rows:
        savepoint = f"wo_deposit_{frappe.generate_hash(length=8)}"
        frappe.db.savepoint(savepoint)
        try:
            work_orders = take_work_orders_off_deposit(row.name, user=frappe.session.user)
        except frappe.ValidationError as e:
            frappe.db.rollback(save_point=savepoint)
            result["failed"].append({"cheque": row.name, "cheque_no": row.cheque_no, "reason": str(e) or "refused"})
            continue
        if work_orders:
            result["changed"].append({"cheque": row.name, "cheque_no": row.cheque_no, "work_orders": work_orders})
    return result


def summary(result: dict) -> list[str]:
    """What the patch prints: the counts, then every cheque it changed or could not save, each with what."""
    def label(c):
        return f"{c['cheque']} ({c['cheque_no']})"

    lines = [f"{len(result['changed'])} deposit cheque(s) changed, {len(result['failed'])} refused"]
    for c in result["changed"]:
        noun = "Work Order" if len(c["work_orders"]) == 1 else "Work Orders"
        lines.append(f"changed {label(c)}: took off {noun} {', '.join(c['work_orders'])}")
    lines += [f"refused {label(c)}: {c['reason']}" for c in result["failed"]]
    return lines

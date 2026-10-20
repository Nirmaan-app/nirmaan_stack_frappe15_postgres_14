# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""List the Pending Payment cheques that can no longer be approved (#1517, spec #1514, ADR-0035 Amendment A).

WHY THIS PATCH EXISTS
    A Payment cheque's payments are approved only once every line names its payment (`approval_rules`).
    The Cheque Tracker's Add Cheque let a line wait with "No payment yet", to be picked later by Edit. From
    spec #1514 Edit never changes a cheque's lines, so such a cheque can never be approved: it can only be
    cancelled, and its payment raised again from the PO in Cheque mode.

WHAT IT DOES
    Prints each Pending Payment cheque with a PO/WO Payment line that names no payment: its number, Vendor,
    amount and the records of its open lines, so Accounts can cancel them. It changes nothing.

IDEMPOTENT
    It writes nothing, so every run prints what is still stuck.

ORDER
    Its `patches.txt` line sits under [post_model_sync], after the patch that renames Pending (#1515), so it
    reads the status by its current name (`rules.PENDING`).
"""

import frappe

from nirmaan_stack.services.cheques.rules import CHEQUE_TYPE_PAYMENT, LINE_PO_WO_PAYMENT, PENDING
from nirmaan_stack.services.cheques.writer import CHEQUES

PATCH = "list_pending_cheques_with_open_lines"


def execute():
    for line in summary(stuck_cheques()):
        print(f"{PATCH}: {line}")
        frappe.logger("cheques").info(f"{PATCH}: {line}")


def stuck_cheques(cheques: list[str] | None = None) -> list[dict]:
    """Every Pending Payment cheque with a PO/WO Payment line that names no payment -- or only those among
    `cheques`, which is what the tests pass so they never read a cheque they did not plant. Reads only.

    Returns `[{cheque, cheque_no, vendor, amount, open_records: [record_name]}]`, by cheque name; each open
    record once per open line, in line order.
    """
    if cheques is not None and not cheques:
        return []
    filters = {"cheque_type": CHEQUE_TYPE_PAYMENT, "status": PENDING}
    if cheques is not None:
        filters["name"] = ["in", cheques]
    rows = frappe.get_all(CHEQUES, filters=filters, fields=["name", "cheque_no", "vendor", "payee_name", "amount"],
                          order_by="name")
    if not rows:
        return []
    open_lines = frappe.get_all(
        "Cheque Line",
        filters={"parenttype": CHEQUES, "parent": ["in", [r.name for r in rows]], "line_type": LINE_PO_WO_PAYMENT,
                 "payment_name": ["is", "not set"]},
        fields=["parent", "record_name"],
        order_by="parent asc, idx asc",
    )
    by_cheque: dict[str, list[str]] = {}
    for line in open_lines:
        by_cheque.setdefault(line.parent, []).append(line.record_name or "(no PO)")
    return [
        {"cheque": r.name, "cheque_no": r.cheque_no, "vendor": r.vendor or r.payee_name, "amount": r.amount,
         "open_records": by_cheque[r.name]}
        for r in rows
        if r.name in by_cheque
    ]


def summary(stuck: list[dict]) -> list[str]:
    """What the patch prints: the count, what to do, then each cheque with its open lines."""
    lines = [
        f"{len(stuck)} {PENDING} Payment cheque(s) have a line with no payment yet. Their lines can no longer "
        "change, so cancel each one and raise its payment again from the PO in Cheque mode."
    ]
    for c in stuck:
        lines.append(
            f"{c['cheque']} (cheque {c['cheque_no']}, {c['vendor']}, amount {c['amount']}): no payment yet on "
            f"{', '.join(c['open_records'])}"
        )
    return lines

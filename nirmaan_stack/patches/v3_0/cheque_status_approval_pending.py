# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rename the Cheque status Pending to Approval Pending (#1515, spec #1514, ADR-0035 Amendment A).

WHAT IT DOES
    Every Cheque at Pending moves to Approval Pending (`rules.PENDING`), and every Cheque Status History
    row that names Pending, as the status it came from or went to, names Approval Pending instead. It
    touches only the Cheques doctype and its status history: Pending in every other doctype (the PR
    workflow, PO Revisions, Vendor Invoices and the rest) is left alone.

IDEMPOTENT
    Only rows still naming the old value are written, so a second run writes nothing.

HOOKS
    Raw writes, so no `doc_events` fire and no Version row is written. Skipping them is correct: the
    rename moves no money and changes no payment, and the Cheques `validate` controller has nothing to
    say about a status that only changes its name. `modified` is left as it was.

The `patches.txt` line sits under [post_model_sync], after the sync that brings in the new options.
"""

import frappe

from nirmaan_stack.services.cheques.rules import PENDING
from nirmaan_stack.services.cheques.writer import CHEQUES

PATCH = "cheque_status_approval_pending"
#: The value this patch retires. Spelled out here: the constant now holds the new name.
OLD_PENDING = "Pending"
HISTORY = "Cheque Status History"


def execute():
    result = rename_pending_cheques()
    frappe.db.commit()
    for line in summary(result):
        print(f"{PATCH}: {line}")
        frappe.logger("cheques").info(f"{PATCH}: {line}")


def rename_pending_cheques(cheques: list[str] | None = None) -> dict:
    """Move every Cheque -- or only `cheques`, which is what the tests pass so they never touch a Cheque
    they did not plant -- and its status history from Pending to Approval Pending. Commits nothing.

    Returns `{cheques: [{cheque, cheque_no}], history: {cheque: rows renamed}}`; a Cheque with nothing
    left to rename is in neither.
    """
    result = {"cheques": [], "history": {}}
    if cheques is not None and not cheques:
        return result
    scope = {"name": ["in", cheques]} if cheques is not None else {}

    result["cheques"] = [
        {"cheque": c.name, "cheque_no": c.cheque_no}
        for c in frappe.get_all(CHEQUES, filters={**scope, "status": OLD_PENDING}, fields=["name", "cheque_no"],
                                order_by="name")
    ]
    parent_scope, params = "", {"old": OLD_PENDING, "new": PENDING, "parenttype": CHEQUES}
    if cheques is not None:
        parent_scope, params["cheques"] = "AND parent IN %(cheques)s", tuple(cheques)
    rows = frappe.db.sql(
        f"""SELECT parent, COUNT(*) AS n FROM "tab{HISTORY}"
            WHERE parenttype = %(parenttype)s AND (from_status = %(old)s OR to_status = %(old)s) {parent_scope}
            GROUP BY parent ORDER BY parent""",
        params, as_dict=True,
    )
    result["history"] = {r.parent: int(r.n) for r in rows}

    # Raw on purpose (see HOOKS above): a rename moves no money and fires no payment hook.
    if result["cheques"]:
        frappe.db.sql(
            f'UPDATE "tab{CHEQUES}" SET status = %(new)s WHERE status = %(old)s AND name IN %(names)s',
            {"new": PENDING, "old": OLD_PENDING, "names": tuple(c["cheque"] for c in result["cheques"])},
        )
    if result["history"]:
        names = tuple(result["history"])
        for column in ("from_status", "to_status"):
            frappe.db.sql(
                f"""UPDATE "tab{HISTORY}" SET {column} = %(new)s
                    WHERE parenttype = %(parenttype)s AND {column} = %(old)s AND parent IN %(names)s""",
                {**params, "names": names},
            )
    return result


def summary(result: dict) -> list[str]:
    """What the patch prints: the counts, then every Cheque it moved and every Cheque whose history it renamed."""
    history = result["history"]
    lines = [
        f"{len(result['cheques'])} Cheque(s) moved from {OLD_PENDING} to {PENDING}; "
        f"{sum(history.values())} status history row(s) renamed on {len(history)} Cheque(s)"
    ]
    lines += [f"moved {c['cheque']} ({c['cheque_no']})" for c in result["cheques"]]
    lines += [f"history {name}: {n} status history row(s)" for name, n in history.items()]
    return lines

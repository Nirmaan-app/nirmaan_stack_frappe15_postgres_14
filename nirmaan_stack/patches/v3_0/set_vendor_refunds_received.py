# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Mark every Vendor Refund recorded before the status existed as `Received` (#1398, ADR-0032).

WHY THIS PATCH EXISTS
    `Vendor Refunds.status` is new, and only a Received refund lowers its PO's / Work Order's paid
    amount (`services/vendor_refunds.LOWERS_PAID_STATUSES`). Every refund recorded before it came from a
    bank credit line, so every one is Received. Left blank, it would count for nothing the next time
    its document's paid amount is recomputed.

IDEMPOTENT
    Only a refund with NO status is read, and only blank -> Received is written, so a second run writes
    nothing, and a refund already given a status (a waiting one included) is never touched.

RAW UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE HOOKS IS CORRECT HERE
    The `Vendor Refunds` hook (`integrations/controllers/vendor_refunds`) recomputes the document's
    `amount_paid` and the vendor's credit. Neither moves: before this release every refund counted,
    so every stored figure already subtracts these refunds, and Received keeps it so. `modified` is
    left alone and no Version row is written.

The `patches.txt` wiring sits under [post_model_sync], after the doctype sync that adds the column.
"""

import frappe

from nirmaan_stack.services.vendor_refunds import RECEIVED, VENDOR_REFUNDS


def execute():
    if not frappe.db.has_column(VENDOR_REFUNDS, "status"):
        print("set_vendor_refunds_received: status column absent, skipping")
        return
    marked = mark_refunds_received()
    frappe.db.commit()
    message = f"set_vendor_refunds_received: {marked} refund(s) marked Received"
    print(message)
    frappe.logger("vendor_refunds").info(message)


def mark_refunds_received(names: list[str] | None = None) -> int:
    """Mark every refund with no status Received -- or only those among `names`, which is what the
    tests pass so they never touch a refund they did not create. Returns how many. Commits nothing."""
    if names is not None and not names:
        return 0
    scope = "AND name IN %(names)s" if names is not None else ""
    blank = frappe.db.sql(
        f"""SELECT name FROM "tab{VENDOR_REFUNDS}" WHERE COALESCE(status, '') = '' {scope}""",
        {"names": tuple(names or ())},
        pluck=True,
    )
    if blank:
        # Raw UPDATE on purpose; see the module docstring for why skipping the hook moves no money.
        frappe.db.sql(
            f"""UPDATE "tab{VENDOR_REFUNDS}" SET status = %(status)s
                WHERE name IN %(names)s AND COALESCE(status, '') = ''""",
            {"status": RECEIVED, "names": tuple(blank)},
        )
    return len(blank)

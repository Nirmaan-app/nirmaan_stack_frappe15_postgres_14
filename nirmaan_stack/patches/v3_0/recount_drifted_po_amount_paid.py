# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Recount 12 POs whose stored Amount Paid drifted from their payments (owner, 2026-10-15).

WHY
    A check on 2026-10-15 found 15 POs whose stored `amount_paid` was not Paid payments less Received
    refunds (`services/vendor_refunds.amount_paid_of`). None involved a refund. The causes: Desk edits of
    a Paid payment's amount or PO, which the payment hook does not watch; `amount_paid` typed by hand;
    and the v2_5 backfill skipping Merged POs. For these 12 the payments are right and the stored figure
    is stale, so each is recounted from source. Two of the children of PO/201/00077/25-26 were counted
    on both the child and the master; recounting the children to 0 ends that.

LEFT OUT ON PURPOSE (each waits for accounts)
    PO/039/00086/25-26   its payment was moved to PO/092 and its vendor changed; was vendor 0590 paid?
    PO/173/00029/24-25,
    PO/174/00029/24-25   their master PO/175 carries a payment of the same total; which one is real?

HOW
    `services/amount_paid_drift.recount_pos`: only a PO that still differs is written, through the refund
    sync step, which sets `amount_paid`, `amount_due` and the refund links from source and recounts each
    vendor's credit under one "Amount Paid Recount" ledger entry. It throws if any PO still differs after.
    Idempotent: a second run finds nothing to change.

HOOKS
    The sync step writes with `set_value`, so no Procurement Orders doc_events fire; it runs every
    recompute that hangs off `amount_paid` itself (amount due, refund links, vendor credit). The CEO Hold
    cashflow check is NOT run: a data repair should not put a project on hold by itself; the next payment
    or refund on the project re-checks it.

RUN BY HAND, before migrate
    bench --site <site> execute nirmaan_stack.patches.v3_0.recount_drifted_po_amount_paid.preview
    bench --site <site> execute nirmaan_stack.patches.v3_0.recount_drifted_po_amount_paid.execute
`preview` only reads. `bench execute` commits after `execute` returns; on a throw it writes nothing.
"""

import frappe

from nirmaan_stack.services.amount_paid_drift import drifted_pos, recount_pos

CREDIT_ENTRY = "Amount Paid Recount"

POS = (
    "PO/015/00092/25-26",
    "PO/048/00075/25-26",
    "PO/070/00008/24-25",
    "PO/074/00066/25-26",
    "PO/079/00077/25-26",
    "PO/096/00086/25-26",
    "PO/103/00086/25-26",
    "PO/108/00077/25-26",
    "PO/276/00041/25-26",
    "PO/032/00073/25-26",
    "PO/114/00077/25-26",
    "PO/121/00077/25-26",
)


def preview():
    """Print what `execute` would change. Writes nothing."""
    _print("would change", drifted_pos(_existing()))


def execute():
    _print("changed", recount_pos(_existing(), CREDIT_ENTRY))


def _existing():
    return [po for po in POS if frappe.db.exists("Procurement Orders", po)]


def _print(verb, rows):
    print(f"recount_drifted_po_amount_paid: {verb} {len(rows)} of {len(POS)} POs")
    for row in rows:
        print(f"  {row.name:<22} stored {row.stored:>14,.2f} -> {row.source:>14,.2f}  ({row.source - row.stored:+,.2f})")

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Find and recount a PO whose stored `amount_paid` has drifted from its source.

The source is THE rule every writer shares: Paid Project Payments less Received Vendor Refunds
(`services/vendor_refunds.amount_paid_of`). A PO drifts when something changed its payments without
recounting it, e.g. a Desk edit of a Paid payment's amount or PO, which the payment hook does not
watch (15 POs on 2026-10-15, none of them refund-related).

`recount_pos` recounts through the refund sync step (`api/po_adjustments/refund_links.sync_po_refund_links`),
the one step that already sets a PO's paid amount, amount due and refund links from source and recounts
its vendor's credit; running it twice changes nothing.
"""

from typing import NamedTuple

import frappe
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments.refund_links import sync_po_refund_links
from nirmaan_stack.services.vendor_refunds import PROCUREMENT_ORDERS, amount_paid_of


class Drift(NamedTuple):
    name: str
    stored: float
    source: float


def drifted_pos(po_names) -> list[Drift]:
    """The POs among `po_names` whose stored `amount_paid` differs from source by a paisa or more,
    sorted by name. Reads only."""
    drifted = []
    for po in sorted({name for name in po_names if name}):
        stored = flt(frappe.db.get_value(PROCUREMENT_ORDERS, po, "amount_paid"), 2)
        source = flt(amount_paid_of(PROCUREMENT_ORDERS, po), 2)
        if stored != source:
            drifted.append(Drift(po, stored, source))
    return drifted


def recount_pos(po_names, credit_entry_type: str) -> list[Drift]:
    """Recount the drifted POs among `po_names` from source, with their amount due and their vendors'
    credit (one `credit_entry_type` ledger entry per vendor). A PO already right is not written.
    Returns what it changed, as found before the recount. Throws if any PO still differs after.
    Commits nothing.
    """
    drifted = drifted_pos(po_names)
    if not drifted:
        return []
    sync_po_refund_links([d.name for d in drifted], credit_entry_type)
    still = drifted_pos([d.name for d in drifted])
    if still:
        frappe.throw(f"Amount Paid still differs from source after the recount: {still}")
    return drifted

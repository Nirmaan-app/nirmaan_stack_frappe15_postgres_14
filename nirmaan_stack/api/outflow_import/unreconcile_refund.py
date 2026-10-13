# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Undo a bank line's MATCH to a waiting Vendor Refund (#1401, ADR-0032).

`unreconcile.unreconcile_row` asks the pure decision module, which answers `unmatch_refund` for a
Vendor Refunds leg the import did not create (`created_by_import = 0`, written only by
`inflows.match_waiting_refunds`). This module reads that refund's facts and, on that verdict, puts it
back. Nothing here commits: it runs inside the orchestrator's savepoint.

⚠️ THE REFUND IS KEPT. It existed before the line (procurement recorded it from "Adjust Payments"), so
undoing the match must not delete it the way an import-created refund is deleted. It goes back to
the status, UTR and date it had before the match, read off the Version the match save wrote
(`settle.match_waiting_refunds_to_row` saves with `ignore_version=False`). Its save fires the refund
hook, which runs the PO sync: the paid amount goes back up, the adjustment link comes off (the balance
and the lock come back) and the vendor's credit is recounted.
"""

import frappe
from frappe.utils import getdate
from frappe.utils.data import get_user_date_format

from nirmaan_stack.services.outflow_import.settle import (
    _outflow_import_write,
    clear_statement_attachment,
)
from nirmaan_stack.services.vendor_refunds import RECEIVED, RECONCILIATION_PENDING, VENDOR_REFUNDS

#: What the match writes on the refund besides the statement attachment, and so what is put back.
MATCH_WRITTEN_FIELDS = ("status", "utr", "payment_date")


def read_refund_facts(leg, *, for_update: bool) -> dict:
    """The status, amount and reference of a matched refund, for the `unmatch_refund` refusals, or `{}`
    when it no longer exists."""
    refund = frappe.db.get_value(
        VENDOR_REFUNDS, leg.target_name, ["status", "amount", "utr"], as_dict=True, for_update=for_update
    )
    if not refund:
        return {}
    return {
        "target_exists": True,
        "target_status": refund.status,
        "target_amount": refund.amount,
        "target_reference": refund.utr,
    }


def unmatch_refund(leg, statement_file_url: str | None) -> None:
    """Put a matched refund back as it was before the match. The verdict already said it may."""
    doc = frappe.get_doc(VENDOR_REFUNDS, leg.target_name)
    before = fields_before_match(leg.target_name, leg.matched_at)
    doc.status = before.get("status") or RECONCILIATION_PENDING
    for field in ("utr", "payment_date"):
        if field in before:
            doc.set(field, before[field])
    clear_statement_attachment(doc, statement_file_url)
    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)


def fields_before_match(refund: str, matched_at) -> dict:
    """The values `MATCH_WRITTEN_FIELDS` held before the match, from the match save's Version: the
    newest Version at or before `matched_at` that turned the refund Received.

    Only the fields that save changed are returned, so a UTR the match left as it was stays. With no
    such Version (a match written before #1401's Version rule, or a purged history) it falls back to
    waiting with no UTR: the date stays, and the status is the one thing that must change.
    """
    filters = {"ref_doctype": VENDOR_REFUNDS, "docname": refund}
    if matched_at:
        filters["creation"] = ["<=", matched_at]
    for version in frappe.get_all(
        "Version", filters=filters, fields=["data"], order_by="creation desc, name desc"
    ):
        changed = (frappe.parse_json(version.data or "{}") or {}).get("changed") or []
        old = {change[0]: change[1] for change in changed if change and len(change) >= 3}
        new = {change[0]: change[2] for change in changed if change and len(change) >= 3}
        if new.get("status") == RECEIVED and "status" in old:
            before = {field: old[field] for field in MATCH_WRITTEN_FIELDS if field in old}
            if before.get("payment_date"):
                before["payment_date"] = _date_from_version(before["payment_date"])
            return before
    return {"status": RECONCILIATION_PENDING, "utr": None}


def _date_from_version(value):
    """A Version stores a changed value FORMATTED (`Document.get_formatted`): a date reads in the site's
    date format, e.g. `01-10-2026` for 1 October under dd-mm-yyyy. Read it back the same way round."""
    return getdate(value, parse_day_first=get_user_date_format().lower().startswith("dd"))

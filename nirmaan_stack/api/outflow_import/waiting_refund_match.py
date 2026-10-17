# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bulk Import: match a bank CREDIT line to waiting Vendor Refunds (#1401, ADR-0032).

The third door a credit a vendor paid back can take, beside `inflows.create_vendor_refund`: the refund
was recorded before its bank line ("Adjust Payments", Reconciliation Pending, or an Admin's Received
with no bank line), so the line is matched to it and nothing is created.

  * `match_waiting_refunds` -- the write: the same prelude and guards as `inflows.create_vendor_refund`
    (`inflows._guard_is_a_credit`, `_guard_not_already_recorded`, `expenses._guard_money_not_recorded`),
    then `services/outflow_import/settle.match_waiting_refunds_to_row`.
  * `get_waiting_vendor_refunds` -- the pool the decision dialog lists once a vendor is chosen, and the
    reason "Create a vendor refund" warns first.

Split out of `inflows.py` to keep that module under ~500 lines (#1396 review).
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _guard_money_not_recorded,
    _load_settleable_row,
    _statement_file_url,
    _summary,
)
from nirmaan_stack.api.outflow_import.inflows import _guard_is_a_credit, _guard_not_already_recorded
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.services.outflow_import.ledgers import VENDOR_REFUND_DOCTYPE
from nirmaan_stack.services.outflow_import.settle import match_waiting_refunds_to_row
from nirmaan_stack.services.outflow_import.status import RECORDED_ACTION_LINK
from nirmaan_stack.services.vendor_refunds import PROCUREMENT_ORDERS, matchable_refunds
from nirmaan_stack.services.outflow_import.row_settlement import (
    link_statement_file_to_target,
    record_settlement,
    refresh_batch_rollup,
    refresh_row_allocation,
)

__all__ = ["get_waiting_vendor_refunds", "match_waiting_refunds"]


@frappe.whitelist(methods=["POST"])
def match_waiting_refunds(row: str, refunds=None, confirm_mismatch=False):
    """Match a bank CREDIT to one or more waiting `Vendor Refund`s, creating nothing (#1401, ADR-0032).

    URL: /api/method/nirmaan_stack.api.outflow_import.waiting_refund_match.match_waiting_refunds

    ⚠️ THE CLIENT SENDS ONLY WHICH REFUNDS (`refunds`: a list of names, or its JSON). The amounts are
    the refunds' own and the line's, read server-side; together they must add up to the line EXACTLY
    (owner, 2026-10-13: no partial allocation for credit lines), so the row is loaded as for every
    whole-transfer write (`_load_settleable_row`, which refuses a Settled or partly allocated line).

    ⚠️ THE SAME PRELUDE AS `create_vendor_refund`: this import's own earlier inflow for the credit, then
    the recorded-money guard (#1260). The guard counts only RECEIVED refunds
    (`candidates.CONTAINS_LEDGERS`), so a waiting refund whose typed UTR is the line's own reference
    does not refuse its own match; the refunds being matched are also passed as `writing`.

    ⚠️ ONE LEG PER REFUND, `created_by_import = 0`, all inside one savepoint and one commit. That flag is
    what makes Unreconcile send the refund back to waiting instead of deleting it. Each refund's save
    runs the PO sync through the refund hook: paid amount, the adjustment link (balance and lock) and
    the vendor's credit move in this same transaction.
    """
    actor = require_outflow_access()
    if isinstance(refunds, str):
        refunds = frappe.parse_json(refunds) if refunds.strip().startswith("[") else [refunds]
    names = [str(name).strip() for name in (refunds or []) if str(name or "").strip()]
    staged, doc = _load_settleable_row(row)
    _guard_is_a_credit(doc)
    _guard_not_already_recorded(staged, doc)
    _guard_money_not_recorded(
        staged,
        doc,
        confirm_mismatch,
        writing=[(VENDOR_REFUND_DOCTYPE, name) for name in names],
        action=RECORDED_ACTION_LINK,
    )
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_refund_match_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        results = match_waiting_refunds_to_row(
            staged,
            refunds=names,
            # FROM THE STORED ROW, NEVER FROM THE PAYLOAD -- see `create_non_project_inflow`.
            direction=doc.get("direction"),
            statement_file_url=statement_file_url,
        )
        for result in results:
            record_settlement(staged, doc, result, actor)
        # Nothing was created, so the note reads "Settled", not "Recorded".
        refresh_row_allocation(staged.name, actor, results[0])
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    # AFTER THE COMMIT, for the reason `create_non_project_inflow` gives.
    for result in results:
        link_statement_file_to_target(statement_file_url, result)
    _publish_refund_pos([result.name for result in results])
    summary = _summary(row, results[0], doc["import_batch"], statuses)
    summary["records"] = [
        {"doctype": r.doctype, "name": r.name, "amount": float(r.amount)} for r in results
    ]
    return summary


@frappe.whitelist()
def get_waiting_vendor_refunds(vendor: str):
    """The vendor's refunds a credit line may be matched to, oldest first (#1401): what the decision
    dialog lists under "Match a waiting Vendor Refund", and what makes "Create a vendor refund" warn.

    Each row: name, amount, status, document_type, document_name, project, project_name, payment_date,
    utr, waiting_created_by, creation. Gated by the import's own access rule.
    """
    require_outflow_access()
    rows = matchable_refunds(vendor)
    project_ids = sorted({row.project for row in rows if row.project})
    names = (
        dict(
            frappe.get_all(
                "Projects",
                filters={"name": ["in", project_ids]},
                fields=["name", "project_name"],
                as_list=True,
                limit_page_length=0,
            )
        )
        if project_ids
        else {}
    )
    for row in rows:
        row["project_name"] = names.get(row.project) or row.project
    return rows


def _publish_refund_pos(refunds) -> None:
    """Tell an open PO page its refund moved: the event "Adjust Payments" and the lock banner listen to."""
    pos = frappe.get_all(
        VENDOR_REFUND_DOCTYPE,
        filters={"name": ["in", list(refunds) or ["-"]], "document_type": PROCUREMENT_ORDERS},
        pluck="document_name",
    )
    for po_id in sorted({po for po in pos if po}):
        frappe.publish_realtime(
            event="po:payment_adjustment", message={"po_id": po_id, "status": "refund_matched"}
        )

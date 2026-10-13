# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The database half of the waiting-refund suggestion (#1402, ADR-0032).

The rule is pure (`services/outflow_import/refund_suggestion`); this module loads what it reads and
hands back what the screen shows. Both read waiting refunds through ONE pool reader,
`services/vendor_refunds.every_matchable_refund`, so whatever joins the pool (#1403: Received refunds
with no bank line) is suggested and shown with no change here.

  * `suggester()` -- for the match run (`review._guard_duplicates_only`): a function of one staged line.
  * `shown_suggestions(rows)` -- for the screen's row read (`review.get_outflow_rows`).
"""

from decimal import Decimal

from nirmaan_stack.services.outflow_import import candidates as C
from nirmaan_stack.services.outflow_import.ledgers import VENDOR_REFUND_DOCTYPE
from nirmaan_stack.services.outflow_import.matcher import TargetRef, resolve_vendors
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.refund_suggestion import (
    shown_suggestion,
    suggest_waiting_refunds,
)
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_PENDING_MATCH
from nirmaan_stack.services.vendor_refunds import every_matchable_refund


def suggester():
    """A function `suggest(row) -> RefundSuggestion | None` for one match run.

    Loads lazily and once per run: the waiting pool when the first credit line arrives (a debit-only
    statement queries nothing), and the vendor index only for a line that carries both a bank account
    and an IFSC -- rule (b)'s evidence, which no credit source carries today.
    """
    loaded: dict = {}

    def suggest(row):
        if (getattr(row, "direction", "") or "") != DIRECTION_CREDIT:
            return None
        if "pool" not in loaded:
            loaded["pool"] = [_target(r) for r in every_matchable_refund()]
        if not loaded["pool"]:
            return None
        vendor = None
        if getattr(row, "normalized_account", "") and getattr(row, "ifsc", ""):
            if "vendors" not in loaded:
                loaded["vendors"] = C.load_vendor_index()
            vendor = resolve_vendors(row, loaded["vendors"])
        return suggest_waiting_refunds(row, vendor, loaded["pool"])

    return suggest


def shown_suggestions(rows) -> dict[str, dict]:
    """Row name -> its suggestion as the decision dialog seeds it, for the open rows that carry one.

    A settled, skipped or partly allocated line shows none: there is nothing left to decide. The pool is
    read only when some row on the page carries a suggestion.
    """
    stored = {
        r["name"]: r.get("suggested_refunds")
        for r in rows
        if r.get("suggested_refunds")
        and r.get("row_status") in OPEN_ROW_STATUSES
        and r.get("row_status") != ROW_PENDING_MATCH
    }
    if not stored:
        return {}
    pool = {r["name"]: r for r in every_matchable_refund()}
    shown = {name: shown_suggestion(value, pool) for name, value in stored.items()}
    return {name: value for name, value in shown.items() if value}


def _target(refund: dict) -> TargetRef:
    return TargetRef(
        doctype=VENDOR_REFUND_DOCTYPE,
        name=refund["name"],
        amount=Decimal(str(refund.get("amount") or 0)),
        status=refund.get("status") or "",
        vendor=refund.get("vendor"),
        reference=refund.get("utr") or "",
    )

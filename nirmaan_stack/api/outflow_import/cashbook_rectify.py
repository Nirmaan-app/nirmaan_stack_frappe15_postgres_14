# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move a Cashbook spend's expense (#1757, spec #1753): the Rectify core (`porter_rectify`) with the Cashbook source
(`rectify_sources.CASHBOOK`). The screen calls it Move; the code and the domain keep Rectify (GLOSSARY *Rectify*).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.porter_rectify import plan_rectify, rectify_rows
from nirmaan_stack.api.outflow_import.rectify_sources import CASHBOOK


@frappe.whitelist()
def get_cashbook_rectify_plan(rows) -> dict:
    """`plan_rectify` for Cashbook lines. WRITES NOTHING, TAKES NO LOCK.

    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook_rectify.get_cashbook_rectify_plan?rows=[...]
    """
    return plan_rectify(CASHBOOK, rows)


@frappe.whitelist(methods=["POST"])
def rectify_cashbook_rows(rows, project: str | None = None, reason: str = "", expense_type: str | None = None) -> dict:
    """`rectify_rows` for Cashbook lines.

    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook_rectify.rectify_cashbook_rows
    Body: `rows` (a JSON list of `Outflow Import Row` names), `project` (blank: Non Project), `reason`.
    """
    return rectify_rows(CASHBOOK, rows, project, reason)

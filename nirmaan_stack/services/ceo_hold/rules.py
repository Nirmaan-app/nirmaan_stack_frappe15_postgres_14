# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The cashflow CEO Hold rule (ADR-0004). Pure: no database, no request (ADR-0010 B1).

`integrations/controllers/project_cashflow_hold_update.sync_cashflow_reason` decides with it, and so does
the CEO Hold preview of the 2026-10-20 WO recount patch (#1513), so the two cannot disagree.
"""

from frappe.utils import flt

#: A Completed project is never held for its cashflow.
COMPLETED_STATUS = "Completed"


def watches_cashflow_gap(status, limit) -> bool:
	"""Whether a project's cashflow gap can hold it at all: it is not Completed and has a positive
	`cashflow_gap_limit`."""
	return status != COMPLETED_STATUS and flt(limit) > 0


def over_cashflow_limit(status, limit, gap) -> bool:
	"""THE cashflow hold rule: a watched project (`watches_cashflow_gap`) whose gap is over its limit
	carries the `cashflow` CEO Hold reason."""
	return watches_cashflow_gap(status, limit) and flt(gap) > flt(limit)

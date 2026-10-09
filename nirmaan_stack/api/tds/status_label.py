# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The words a Project TDS row's stored `tds_status` is shown as, for output the server renders (the
Handover print). The screens read the same words from `historyStatusLabel` in
`frontend/src/utils/tdsRequestRules.ts`; its parity test pins the `*_LABEL` literals below.

Approved reads "Approved by Admin" so it is never mistaken for the client's decision (Client Status,
ADR-0025 Amendment B). Stored values do not change.
"""

import frappe

from nirmaan_stack.api.tds.submit import STATUS_APPROVED, STATUS_NEW_MAKE, STATUS_PENDING, STATUS_REJECTED

PENDING_LABEL = "Pending"
APPROVED_LABEL = "Approved by Admin"
REJECTED_LABEL = "Rejected"

# Stored value -> shown words. New and a blank status read Pending, as in TDS History.
_LABELS = {
	STATUS_PENDING: PENDING_LABEL,
	STATUS_NEW_MAKE: PENDING_LABEL,
	STATUS_APPROVED: APPROVED_LABEL,
	STATUS_REJECTED: REJECTED_LABEL,
}


def history_status_label(status) -> str:
	"""What a row's stored `tds_status` reads as."""
	return _LABELS.get(status or "", PENDING_LABEL)


def with_status_labels(rows) -> list:
	"""Copies of `rows` whose `tds_status` holds the shown words, for a print template that renders it
	as is. The rows passed in keep their stored values."""
	return [frappe._dict(row, tds_status=history_status_label(row.get("tds_status"))) for row in rows or []]

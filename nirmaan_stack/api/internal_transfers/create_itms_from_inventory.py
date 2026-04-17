"""
Atomic multi-ITM creation endpoint for the Create Internal Transfer Memo flow.

Accepts a ``target_project`` and a flat list of ``selections`` — one per
(item_id, source_project) pick — groups them by ``source_project``, snapshots
item metadata + estimated_rate from the latest submitted RIR / max PO rate,
and creates one :class:`Internal Transfer Memo` per unique source project in
a single transaction. If any ITM insert fails validation, all inserts are
rolled back together.

The controller's ``validate`` hook re-runs the availability guard as defense
in depth; this endpoint only computes the snapshot values and sequences the
inserts.
"""

from collections import defaultdict
from typing import Any

import frappe
from frappe.utils import flt


@frappe.whitelist()
def create_itms_from_inventory(target_project: str, selections: Any) -> dict:
	"""Create N Internal Transfer Memos atomically, one per unique source_project.

	Args:
	    target_project: Name of the destination ``Projects`` record.
	    selections: List (or JSON string) of ``{item_id, source_project,
	        transfer_quantity}`` dicts. ``transfer_quantity`` must be > 0
	        and must not exceed the computed ``available_quantity``.

	Returns:
	    ``{"created": ["ITM-2026-00001", ...], "count": N}``. Frappe wraps
	    this as ``{"message": {...}}`` on the wire.

	Raises:
	    frappe.ValidationError: On any pre-flight or per-doc validation
	        failure. All partial inserts are rolled back before re-raising.
	"""

	# Import the controller's availability helper lazily to avoid any circular
	# import risk at module load (the controller is a sibling in the package
	# graph and it also imports from this module family for read APIs).
	from nirmaan_stack.integrations.controllers.internal_transfer_memo import (
		available_quantity,
	)

	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required to create Internal Transfer Memos."))

	selections = frappe.parse_json(selections) or []
	if not isinstance(selections, list) or len(selections) == 0:
		frappe.throw(_("At least one item selection is required."))

	if not target_project:
		frappe.throw(_("Target project is required."))

	if not frappe.db.exists("Projects", target_project):
		frappe.throw(_("Target project {0} does not exist.").format(target_project))

	# --- Pre-flight validation: shape + per-selection sanity ---
	normalized: list[dict] = []
	for idx, sel in enumerate(selections, start=1):
		if not isinstance(sel, dict):
			frappe.throw(_("Selection #{0} is malformed.").format(idx))

		item_id = (sel.get("item_id") or "").strip()
		source_project = (sel.get("source_project") or "").strip()
		transfer_quantity = flt(sel.get("transfer_quantity") or 0)

		if not item_id:
			frappe.throw(_("Selection #{0} is missing item_id.").format(idx))
		if not source_project:
			frappe.throw(_("Selection #{0} is missing source_project.").format(idx))
		if transfer_quantity <= 0:
			frappe.throw(
				_("Selection #{0} ({1} from {2}) has non-positive transfer_quantity.")
				.format(idx, item_id, source_project)
			)
		if source_project == target_project:
			frappe.throw(
				_("Selection #{0} ({1}): source project cannot equal target project.")
				.format(idx, item_id)
			)

		normalized.append(
			{
				"item_id": item_id,
				"source_project": source_project,
				"transfer_quantity": transfer_quantity,
			}
		)

	# --- Group by source_project ---
	groups: dict[str, list[dict]] = defaultdict(list)
	for sel in normalized:
		groups[sel["source_project"]].append(sel)

	# --- Per-source pre-flight: RIR existence + availability guard + snapshot ---
	latest_rir_by_source: dict[str, str] = {}
	availability_errors: list[str] = []
	for source_project in groups.keys():
		rir_name = _latest_submitted_rir(source_project)
		if not rir_name:
			frappe.throw(
				_("No submitted Remaining Items Report found for source project {0}.")
				.format(source_project)
			)
		latest_rir_by_source[source_project] = rir_name

	# Availability guard (aggregated across the submitted batch per (item, source))
	aggregated: dict[tuple[str, str], float] = defaultdict(float)
	for sel in normalized:
		aggregated[(sel["item_id"], sel["source_project"])] += sel["transfer_quantity"]

	for (item_id, source_project), requested in aggregated.items():
		available = available_quantity(item_id, source_project)
		if requested > flt(available):
			availability_errors.append(
				_("Item {0} in {1}: requested {2}, available {3}")
				.format(item_id, source_project, requested, available)
			)

	if availability_errors:
		frappe.throw(
			_("Requested quantities exceed available inventory:\n- {0}")
			.format("\n- ".join(availability_errors))
		)

	# --- Metadata snapshot: build once per (source, item) key ---
	snapshot_index = _build_metadata_snapshot(latest_rir_by_source, normalized)

	# --- Create Transfer Request parent ---
	request_doc = frappe.get_doc({
		"doctype": "Internal Transfer Request",
		"target_project": target_project,
		"requested_by": frappe.session.user,
		"memo_count": len(groups),
		"status": "Pending",
	})
	request_doc.insert()

	# --- Create ITMs (atomic) ---
	created_names: list[str] = []
	failed_source: str | None = None
	try:
		for source_project, group_selections in groups.items():
			failed_source = source_project
			itm = frappe.new_doc("Internal Transfer Memo")
			itm.source_project = source_project
			itm.target_project = target_project
			itm.source_rir = latest_rir_by_source[source_project]
			itm.status = "Pending Approval"
			itm.requested_by = frappe.session.user
			itm.transfer_request = request_doc.name

			for sel in group_selections:
				snap = snapshot_index.get((source_project, sel["item_id"]), {})
				itm.append(
					"items",
					{
						"item_id": sel["item_id"],
						"item_name": snap.get("item_name"),
						"unit": snap.get("unit"),
						"category": snap.get("category"),
						"make": snap.get("make"),
						"transfer_quantity": sel["transfer_quantity"],
						"estimated_rate": snap.get("estimated_rate") or 0,
						"received_quantity": 0,
						"status": "Pending",
					},
				)

			itm.insert()
			created_names.append(itm.name)
			failed_source = None
	except Exception as exc:
		frappe.db.rollback()
		if isinstance(exc, frappe.ValidationError):
			# Re-raise the controller's validation error with source context.
			raise
		frappe.log_error(
			title="ITM multi-create failed",
			message=frappe.get_traceback(),
		)
		frappe.throw(
			_("Failed to create Internal Transfer Memo for source {0}: {1}")
			.format(failed_source or "?", str(exc))
		)

	frappe.db.commit()

	return {"request": request_doc.name, "created": created_names, "count": len(created_names)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _latest_submitted_rir(source_project: str) -> str | None:
	"""Return the name of the latest submitted RIR for ``source_project``, if any."""

	rows = frappe.db.sql(
		"""
		SELECT name
		FROM "tabRemaining Items Report"
		WHERE project = %(project)s AND status = 'Submitted'
		ORDER BY report_date DESC
		LIMIT 1
		""",
		{"project": source_project},
		as_dict=True,
	)
	return rows[0]["name"] if rows else None


def _build_metadata_snapshot(
	latest_rir_by_source: dict[str, str],
	selections: list[dict],
) -> dict[tuple[str, str], dict]:
	"""Fetch ``item_name/unit/category`` from RIR and ``make/estimated_rate``
	from Purchase Order Item (max quote) for every (source, item) pair
	referenced by ``selections``.

	Returns a dict keyed by ``(source_project, item_id)``.
	"""

	if not selections:
		return {}

	# --- 1) RIR-derived fields: item_name, unit, category ---
	# Collect unique (rir_name, item_id) pairs.
	rir_name_by_pair: dict[tuple[str, str], str] = {}
	for sel in selections:
		rir_name = latest_rir_by_source.get(sel["source_project"])
		if rir_name:
			rir_name_by_pair[(sel["source_project"], sel["item_id"])] = rir_name

	rir_names = tuple({rir for rir in rir_name_by_pair.values()})
	item_ids = tuple({sel["item_id"] for sel in selections})

	rir_rows: list[dict] = []
	if rir_names and item_ids:
		rir_rows = frappe.db.sql(
			"""
			SELECT parent AS rir_name, item_id, item_name, unit, category
			FROM "tabRemaining Item Entry"
			WHERE parent IN %(rir_names)s
			  AND item_id IN %(item_ids)s
			""",
			{"rir_names": rir_names, "item_ids": item_ids},
			as_dict=True,
		)

	rir_index: dict[tuple[str, str], dict] = {}
	for row in rir_rows:
		rir_index[(row["rir_name"], row["item_id"])] = row

	# --- 2) Items-master fallback for any missing metadata + make + PO rate ---
	# For `make`, pull the most recent PO line's make value per (project, item_id);
	# for `estimated_rate`, use max quote per (project, item_id).
	source_projects = tuple({sel["source_project"] for sel in selections})
	po_rows: list[dict] = []
	if source_projects and item_ids:
		po_rows = frappe.db.sql(
			"""
			WITH ranked AS (
				SELECT
					po.project,
					poi.item_id,
					poi.quote,
					poi.make,
					poi.creation,
					ROW_NUMBER() OVER (
						PARTITION BY po.project, poi.item_id
						ORDER BY poi.quote DESC, poi.creation DESC
					) AS rn_rate,
					ROW_NUMBER() OVER (
						PARTITION BY po.project, poi.item_id
						ORDER BY poi.creation DESC
					) AS rn_recent
				FROM "tabPurchase Order Item" poi
				JOIN "tabProcurement Orders" po ON poi.parent = po.name
				WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
				  AND po.project IN %(source_projects)s
				  AND poi.item_id IN %(item_ids)s
			),
			rate_row AS (
				SELECT project, item_id, quote FROM ranked WHERE rn_rate = 1
			),
			make_row AS (
				SELECT project, item_id, make FROM ranked WHERE rn_recent = 1
			)
			SELECT
				COALESCE(r.project, m.project) AS project,
				COALESCE(r.item_id, m.item_id) AS item_id,
				r.quote AS max_quote,
				m.make AS latest_make
			FROM rate_row r
			FULL OUTER JOIN make_row m
			  ON r.project = m.project AND r.item_id = m.item_id
			""",
			{"source_projects": source_projects, "item_ids": item_ids},
			as_dict=True,
		)

	po_index: dict[tuple[str, str], dict] = {}
	for row in po_rows:
		po_index[(row["project"], row["item_id"])] = row

	# --- 3) Items-master fallback for item_name/unit/category if RIR missed them ---
	items_rows: list[dict] = []
	if item_ids:
		items_rows = frappe.db.sql(
			"""
			SELECT name AS item_id, item_name, unit_name AS unit, category
			FROM "tabItems"
			WHERE name IN %(item_ids)s
			""",
			{"item_ids": item_ids},
			as_dict=True,
		)
	items_index = {row["item_id"]: row for row in items_rows}

	# --- Merge ---
	snapshot: dict[tuple[str, str], dict] = {}
	for sel in selections:
		source_project = sel["source_project"]
		item_id = sel["item_id"]
		rir_name = latest_rir_by_source.get(source_project)
		rir_hit = rir_index.get((rir_name, item_id)) if rir_name else None
		items_hit = items_index.get(item_id) or {}
		po_hit = po_index.get((source_project, item_id)) or {}

		snapshot[(source_project, item_id)] = {
			"item_name": (rir_hit or {}).get("item_name") or items_hit.get("item_name") or item_id,
			"unit": (rir_hit or {}).get("unit") or items_hit.get("unit"),
			"category": (rir_hit or {}).get("category") or items_hit.get("category"),
			"make": po_hit.get("latest_make"),
			"estimated_rate": flt(po_hit.get("max_quote") or 0),
		}

	return snapshot


def _(msg: str) -> str:
	"""Thin wrapper around :func:`frappe._` for localisation."""

	return frappe._(msg)

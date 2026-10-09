# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Shared HOD reads: the project header values and the stored JSON of a row.

Every handover page prints the same header block (VENDOR / PROJECT / LOCATION / DATE / PACKAGE); this
module is the one place its project values are read.
"""

import json

import frappe

VENDOR = "STRATOS INFRA TECHNOLOGIES PVT LTD"


def as_dict(value) -> dict:
	"""A stored JSON field value (dict, JSON text or empty) as a dict."""
	if isinstance(value, dict):
		return value
	if isinstance(value, str) and value.strip():
		try:
			parsed = json.loads(value)
			return parsed if isinstance(parsed, dict) else {}
		except ValueError:
			return {}
	return {}


def project_location(project_row) -> str:
	"""The project's address as one line: the linked Address if there is one, else city, state."""
	if project_row.get("project_address"):
		addr = frappe.db.get_value(
			"Address",
			project_row.project_address,
			["address_line1", "address_line2", "city", "state", "pincode"],
			as_dict=True,
		)
		if addr:
			parts = [p.strip().rstrip(",") for p in (addr.address_line1, addr.address_line2, addr.city) if p and p.strip()]
			tail = "-".join(p for p in (addr.state, addr.pincode) if p)
			if tail:
				parts.append(tail)
			if parts:
				return ", ".join(parts)
	return ", ".join(p for p in (project_row.get("project_city"), project_row.get("project_state")) if p)


def project_info(project: str) -> dict:
	"""name, project_name, location, customer, customer_name for the header block."""
	row = frappe.db.get_value(
		"Projects",
		project,
		["name", "project_name", "project_address", "project_city", "project_state", "customer"],
		as_dict=True,
	)
	if not row:
		frappe.throw(f"Project {project} not found.")
	customer_name = frappe.db.get_value("Customers", row.customer, "company_name") if row.customer else None
	return {
		"name": row.name,
		"project_name": row.project_name or row.name,
		"location": project_location(row),
		"customer": row.customer,
		"customer_name": customer_name or "",
	}

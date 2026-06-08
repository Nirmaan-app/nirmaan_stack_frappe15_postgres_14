# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Resolve the closed binding-path allowlist into concrete values for a project.

Pairs with the frontend allowlist at:
  frontend/src/pages/CommissionReport/report-wizard/prefill/bindings.ts

Both sides MUST be kept in sync. To add a new binding:
  1. Add a resolver function below.
  2. Register it in BINDING_RESOLVERS.
  3. Add the matching entry to the frontend bindings.ts.
"""

import frappe


# ---------- Resolvers ----------

def _resolve_project_field(project, field):
    return project.get(field) or ""


def _resolve_location_full(project):
    """Mirrors the frontend address-view formatter:
        `${address_line1}, ${address_line2}, ${city}, ${state}-${pincode}`
    Falls back gracefully if the linked Address is missing.
    """
    addr_name = (project.get("project_address") or "").strip()
    if not addr_name:
        # Fallback to denormalized city/state on Project itself.
        parts = [p for p in [project.get("project_city"), project.get("project_state")] if p]
        return ", ".join(parts)

    try:
        addr = frappe.get_doc("Address", addr_name)
    except frappe.DoesNotExistError:
        return ""

    line1 = (addr.get("address_line1") or "").strip()
    line2 = (addr.get("address_line2") or "").strip()
    city = (addr.get("city") or "").strip()
    state = (addr.get("state") or "").strip()
    pincode = (addr.get("pincode") or "").strip()

    head_parts = [p for p in [line1, line2, city] if p]
    tail = state if not pincode else (f"{state}-{pincode}" if state else pincode)
    if tail:
        head_parts.append(tail)
    return ", ".join(head_parts)


def _resolve_customer_company_name(project):
    customer_name = (project.get("customer") or "").strip()
    if not customer_name:
        return ""
    return frappe.db.get_value("Customers", customer_name, "company_name") or ""


# ---------- Allowlist ----------

# Each entry: binding key -> callable(project_doc) -> str
BINDING_RESOLVERS = {
    "project.project_name":          lambda p: _resolve_project_field(p, "project_name"),
    "project.project_city":          lambda p: _resolve_project_field(p, "project_city"),
    "project.project_state":         lambda p: _resolve_project_field(p, "project_state"),
    "project.location.full":         _resolve_location_full,
    "project.project_start_date":    lambda p: _resolve_project_field(p, "project_start_date"),
    "project.project_end_date":      lambda p: _resolve_project_field(p, "project_end_date"),
    "project.project_type":          lambda p: _resolve_project_field(p, "project_type"),
    "project.customer.company_name": _resolve_customer_company_name,
}


@frappe.whitelist()
def get_report_prefill(project: str) -> dict:
    """Returns `{ "<binding>": "<resolved value>" }` for every key in the allowlist.

    The caller (frontend) freezes the subset of these used by the active
    template into `response_data.prefillSnapshot`. From that moment on, the
    filled report is immune to project edits.
    """
    if not project:
        frappe.throw("project is required.")

    project_doc = frappe.get_doc("Projects", project)

    out = {}
    for key, resolver in BINDING_RESOLVERS.items():
        try:
            value = resolver(project_doc)
        except Exception:
            value = ""
        # Coerce datetime/date to ISO string so the frontend stores plain strings.
        if hasattr(value, "isoformat"):
            value = value.isoformat()
        out[key] = value if value is not None else ""

    return out

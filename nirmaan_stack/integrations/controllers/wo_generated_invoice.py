# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A generated invoice is made only by Generate and never deleted (#1546; GLOSSARY *Generated invoice*).

Generate (`api/service_requests/generated_invoices.generate_invoice`) assigns the RA number under a lock
and sets `flags.made_by_generate`; any other insert (Desk, REST) would pick its own number. A deleted record
would free its RA number. Its edits are the doctype's own `validate` (`services/wo_generated_invoices.change_problem`).
"""

import frappe
from frappe import _


def refuse_insert_outside_generate(doc, method=None):
    """`before_insert`: refuse a generated invoice not made by Generate (`flags.made_by_generate`), which
    alone assigns the RA number under the Work Order's billing lock."""
    if not doc.flags.made_by_generate:
        frappe.throw(_("A generated invoice is made only by Generate invoice on its Work Order."))


def refuse_delete(doc, method=None):
    """`on_trash`: refuse every delete, Administrator's included; a deleted record would free its RA number."""
    frappe.throw(_("A generated invoice is never deleted. Void it instead, so its RA number is not reused."))

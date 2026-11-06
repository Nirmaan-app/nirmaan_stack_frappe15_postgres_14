# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A generated invoice is made only by Generate and deleted only in the app (#1546; GLOSSARY *Generated invoice*).

Generate (`api/service_requests/generated_invoices.generate_invoice`) assigns the RA number under a lock
and sets `flags.made_by_generate`; any other insert (Desk, REST) would pick its own number. A delete sets
`flags.deleted_in_app`: Admin's delete of a Voided record (`generated_invoices.delete_generated_invoice`), or
the delete of the Vendor Invoice its signed upload created (`controllers/vendor_invoices.delete_generated_invoice_with_it`).
A deleted record frees its RA number (ADR-0040 Amdt B). Its edits are the doctype's own
`validate` (`services/wo_generated_invoices.change_problem`).
"""

import frappe
from frappe import _


def refuse_insert_outside_generate(doc, method=None):
    """`before_insert`: refuse a generated invoice not made by Generate (`flags.made_by_generate`), which
    alone assigns the RA number under the Work Order's billing lock."""
    if not doc.flags.made_by_generate:
        frappe.throw(_("A generated invoice is made only by Generate invoice on its Work Order."))


def refuse_delete(doc, method=None):
    """`on_trash`: refuse every delete not made in the app (`flags.deleted_in_app`), Administrator's in Desk
    included. The app's paths hold their own rules: Admin and Voided, or with its Vendor Invoice."""
    if not doc.flags.deleted_in_app:
        frappe.throw(_("A generated invoice is deleted only on its Work Order page: an Admin deletes a Voided one."))

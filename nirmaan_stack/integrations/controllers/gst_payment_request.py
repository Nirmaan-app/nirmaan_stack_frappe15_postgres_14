# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Doc events of `GST Payment Request` (`services/gst_payment_requests`)."""

import frappe
from frappe import _

from nirmaan_stack.services import gst_payment_requests


def validate(doc, method):
    """Only the request endpoints write a request; a rejection carries its reason."""
    gst_payment_requests.validate(doc)


def on_trash(doc, method):
    """Only a decider deletes a request, and only a Pending or Rejected one; its payment's delete takes any."""
    problem = gst_payment_requests.delete_problem(doc, frappe.session.user)
    if problem:
        frappe.throw(problem, gst_payment_requests.GstRequestRefused, title=_("Not allowed"))
    # Its bell rows first: their dynamic link would refuse the delete. A refused delete rolls them back.
    frappe.db.delete("Nirmaan Notifications", {"document": gst_payment_requests.DOCTYPE, "docname": doc.name})


def sync_from_payment(doc, method):
    """Project Payments `on_update`: an approved request follows its payment, Approved <-> Paid."""
    gst_payment_requests.sync_with_payment(doc)


def delete_with_payment(doc, method):
    """Project Payments `on_trash`: deleting a GST payment deletes the request it was made from."""
    gst_payment_requests.delete_with_payment(doc)


def record_decider_request(doc, method):
    """Project Payments `after_insert`: a GST payment links its approved request (and takes its requester as
    owner), or, born without one, gets its request recorded already decided."""
    gst_payment_requests.link_payment(doc)
    gst_payment_requests.record_decider_request(doc)

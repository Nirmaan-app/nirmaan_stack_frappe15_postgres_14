# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the PO Delivery Documents doctype.

Currently holds only the Tendering operational guard (Slice 5 / B5).

PO Delivery Documents are polymorphic: `parent_doctype` is either
"Procurement Orders" or "Internal Transfer Memo". In both cases the
denormalized `project` Link field is populated at creation from the parent
(the PO's `project`, or the ITM's `target_project` — see
`nirmaan_stack/api/po_delivery_documentss.create_delivery_document`), so the
guard reads `doc.project` directly. A Tendering stub can never be a PO/ITM
parent's project, so this is a pure defense-in-depth backstop.
"""

from nirmaan_stack.api.projects._tendering_guard import validate_won


def validate(doc, method):
    """Tendering operational guard (Slice 5 / B5).

    Defense-in-depth backstop: refuse to create a PO Delivery Document (DC/MIR)
    against a Tendering project stub. Only guarded when a project is linked
    (always the case for both PO- and ITM-parented docs). Guard only NEW docs
    so edits to existing/legacy delivery documents are never blocked.
    """
    if doc.is_new() and doc.project:
        validate_won(doc.project, "PO Delivery Document")

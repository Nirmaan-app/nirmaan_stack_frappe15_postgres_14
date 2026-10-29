# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Generated invoices on a GST-off Work Order: generate, void, the signed upload, and what the WO page
shows (#1546, #1547, spec #1528; GLOSSARY *Generated invoice*, *RA number*). The rules are in
`services/wo_generated_invoices.py`.

    get_generated_invoices(work_order)                          -> dict  the records, next RA, the limit
    generate_invoice(work_order, invoice_date, amount)          -> dict  a new record, RA or FINAL by
                                                                         its amount
    void_invoice(name, reason)                                  -> dict  the record, Voided
    upload_signed_copy(name, file_url)                          -> dict  the record, Signed, with its
                                                                         Pending Vendor Invoice
    delete_generated_invoice(name)                              -> dict  the deleted record's name

Admin, PMO, service procurement and Project Lead only (`role_profiles.WO_GENERATED_INVOICE_PROFILES`),
on a Work Order the user may read; deleting a Voided record is Admin's alone. The doctype grants read
only, so every write is here, with `ignore_permissions`.

The print is the "WO Generated Invoice" print format (`PRINT_FORMAT`): it reads the record and nothing
from the link, so editing the link changes nothing. The doctype grants no `print`, so Desk offers no
print; the WO page fetches the PDF through `frappe.utils.print_format.download_pdf`, which needs read.

The upload's Vendor Invoice is decided through the normal invoice approval; its approval or rejection
moves the record (`controllers/vendor_invoices.follow_generated_invoice`).
"""

from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, today

from nirmaan_stack.api.delivery_notes.update_invoice_data import create_attachment_doc, create_vendor_invoice
from nirmaan_stack.api.sr_remarks import assert_can_read_work_order
from nirmaan_stack.integrations.Notifications.pr_notifications import get_users_who_see_project
from nirmaan_stack.services import wo_generated_invoices as gi
from nirmaan_stack.services.outflow_import.amounts import rupees
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_PROFILES,
    assert_generate_wo_invoice_access,
    can_generate_wo_invoice,
    is_nirmaan_admin,
)
from nirmaan_stack.services.work_order_gst import gst_is_explicitly_off

SR = "Service Requests"
PRINT_FORMAT = "WO Generated Invoice"
#: Only an Approved WO is billed (Finalized ones too: Finalize does not lock billing).
BILLABLE_STATUS = "Approved"

_ROW_FIELDS = ["name", "ra_number", "invoice_type", "invoice_no", "invoice_date", "amount", "status",
               "void_reason", "vendor_invoice", "signed_attachment", "owner", "creation"]


@frappe.whitelist(methods=["GET"])
def get_generated_invoices(work_order: str) -> dict:
    """A Work Order's generated invoices (newest first) and what Generate would do next.

    `blocked` says why Generate is not offered at all (None when it is); `left` is the most an invoice
    may bill; `billed` is what already counts against the WO amount, so the screen can show whether an
    amount would make the FINAL (`gi.is_final`)."""
    sr = _readable(work_order)
    state = _billing_state(sr)
    return {
        "invoices": frappe.get_all(gi.DOCTYPE, filters={"work_order": sr.name}, fields=_ROW_FIELDS,
                                   order_by="ra_number desc"),
        "can_generate": can_generate_wo_invoice(frappe.session.user),
        "can_delete": is_nirmaan_admin(frappe.session.user),
        "blocked": _work_order_problem(sr) or _final_problem(state),
        "next_ra_number": state["next_ra_number"],
        "left": state["left"],
        "billed": state["billed"],
        "fully_paid": state["fully_paid"],
        "has_final": bool(state["final"]),
    }


@frappe.whitelist(methods=["POST"])
def generate_invoice(work_order: str, invoice_date: str | None = None, amount=None) -> dict:
    """Save the next generated invoice of `work_order`, for `amount`. The type is not chosen: it is the
    FINAL when it brings what is billed to the WO amount (`gi.is_final`), otherwise an RA. The RA number
    is assigned here, under a lock on the WO."""
    assert_generate_wo_invoice_access(frappe.session.user)
    _readable(work_order)
    with _billing_lock(work_order):
        sr = frappe.get_doc(SR, work_order)
        problem = _work_order_problem(sr)
        if problem:
            frappe.throw(problem)

        state = _billing_state(sr)
        problem = _final_problem(state)
        if problem:
            frappe.throw(problem)

        bill = round(flt(amount), 2)
        if bill <= 0:
            frappe.throw(_("Enter an amount more than ₹0."))
        if bill > state["left"]:
            frappe.throw(_(
                "This invoice can bill at most {0}: the smaller of the Work Order amount ({1}) and its Amount Paid "
                "incl. TDS ({2}), less {3} already billed or waiting."
            ).format(rupees(state["left"]), rupees(sr.total_amount), rupees(sr.amount_paid), rupees(state["billed"])))
        invoice_type = gi.FINAL if gi.is_final(sr.total_amount, state["billed"], bill) else gi.RA

        date = getdate(invoice_date or today())
        ra_number = state["next_ra_number"]
        doc = _new_record({
            "work_order": sr.name,
            "project": sr.project,
            "vendor": sr.vendor,
            "ra_number": ra_number,
            "invoice_type": invoice_type,
            "amount": bill,
            "invoice_date": date,
            "invoice_no": gi.invoice_number(date, sr.project, sr.name, invoice_type, ra_number,
                                            final_number=state["finals"] + 1),
            "status": gi.GENERATED,
        })
        frappe.db.commit()
    return _row(doc)


@frappe.whitelist(methods=["POST"])
def void_invoice(name: str, reason: str) -> dict:
    """Void a generated invoice not yet uploaded, with a reason. Its RA number is never given again."""
    assert_generate_wo_invoice_access(frappe.session.user)
    work_order = frappe.db.get_value(gi.DOCTYPE, name, "work_order")
    if not work_order:
        raise frappe.DoesNotExistError(_("Generated invoice {0} not found.").format(name))
    _readable(work_order)
    with _billing_lock(work_order):
        doc = frappe.get_doc(gi.DOCTYPE, name)
        if doc.status != gi.GENERATED:
            frappe.throw(_("Only a generated invoice not yet uploaded can be voided. This one is {0}.").format(doc.status))
        if not cstr(reason).strip():
            frappe.throw(_("Give a reason for voiding the invoice."))
        doc.status = gi.VOIDED
        doc.void_reason = cstr(reason).strip()
        doc.save(ignore_permissions=True)
        frappe.db.commit()
    return _row(doc)


@frappe.whitelist(methods=["POST"])
def delete_generated_invoice(name: str) -> dict:
    """Delete a Voided generated invoice: Admin only. Its Deleted Document copy keeps its RA number (and a
    FINAL's place in the FINAL-n count) from being given again."""
    if not is_nirmaan_admin(frappe.session.user):
        raise frappe.PermissionError(_("Only an Admin can delete a voided generated invoice."))
    work_order = frappe.db.get_value(gi.DOCTYPE, name, "work_order")
    if not work_order:
        raise frappe.DoesNotExistError(_("Generated invoice {0} not found.").format(name))
    _readable(work_order)
    with _billing_lock(work_order):
        doc = frappe.get_doc(gi.DOCTYPE, name)
        if doc.status != gi.VOIDED:
            frappe.throw(_("Only a voided generated invoice can be deleted. This one is {0}.").format(doc.status))
        doc.flags.deleted_in_app = True
        doc.delete(ignore_permissions=True)
        frappe.db.commit()
    return {"name": name}


@frappe.whitelist(methods=["POST"])
def upload_signed_copy(name: str, file_url: str) -> dict:
    """Book the vendor's signed copy of a generated invoice: one save attaches the scan, creates its
    Pending Vendor Invoice (the record's number, date and amount; base = amount, GST = 0) and moves the
    record to Signed. Accountants on the project are told. A record is uploaded once."""
    assert_generate_wo_invoice_access(frappe.session.user)
    work_order = frappe.db.get_value(gi.DOCTYPE, name, "work_order")
    if not work_order:
        raise frappe.DoesNotExistError(_("Generated invoice {0} not found.").format(name))
    _readable(work_order)
    if not cstr(file_url).strip():
        frappe.throw(_("Attach the vendor's signed copy."))
    with _billing_lock(work_order):
        doc = frappe.get_doc(gi.DOCTYPE, name)
        if doc.status == gi.SIGNED or doc.status == gi.APPROVED:
            frappe.throw(_("This invoice is already uploaded: it is {0}, as Vendor Invoice {1}.").format(
                doc.status, doc.vendor_invoice))
        if doc.status != gi.GENERATED:
            frappe.throw(_("A {0} invoice can't be uploaded. Generate a new one.").format(doc.status))
        sr = frappe.get_doc(SR, work_order)
        if not gst_is_explicitly_off(sr.gst):
            # The WO turned GST-on after the generate (Match GST to vendor): the record is kept, but no
            # zero-GST invoice is booked on it.
            frappe.throw(_("{0} is no longer a GST-off Work Order, so this generated invoice can't be uploaded: "
                           "a GST vendor sends their own tax invoice. Void it.").format(sr.name))
        attachment = create_attachment_doc(sr, cstr(file_url).strip(), "sr invoice")
        invoice = create_vendor_invoice(
            parent_doc=sr,
            invoice_data={"invoice_no": doc.invoice_no, "date": doc.invoice_date, "amount": doc.amount},
            attachment_id=attachment.name,
            split={"invoice_base_amount": flt(doc.amount), "invoice_gst_amount": 0},
        )
        frappe.db.set_value("Nirmaan Attachments", attachment.name,
                            {"associated_doctype": "Vendor Invoices", "associated_docname": invoice.name},
                            update_modified=False)
        doc.status = gi.SIGNED
        doc.vendor_invoice = invoice.name
        doc.signed_attachment = attachment.name
        doc.save(ignore_permissions=True)
        frappe.db.commit()
    _notify_accountants(sr, doc)
    return _row(doc)


SIGNED_UPLOAD_EVENT = "wo_invoice:signed_uploaded"


def _accountants_of(project) -> list:
    """The Accountants who can see `project`: put on it, or on no project at all."""
    return get_users_who_see_project(project, ACCOUNTANT_PROFILES)


def _notify_accountants(sr, doc):
    """Tell the Accountants who can see the project that a signed copy waits for approval. Runs after
    the upload's commit, and a failure is logged, never raised: the upload stands."""
    try:
        accountants = _accountants_of(sr.project)
        title = _("Signed invoice uploaded")
        description = _("{0} ({1}) on {2} is waiting for approval.").format(
            doc.invoice_no, rupees(doc.amount), sr.name)
        for user in accountants:
            frappe.get_doc({
                "doctype": "Nirmaan Notifications",
                "recipient": user.name,
                "recipient_role": user.role_profile,
                "sender": frappe.session.user if frappe.session.user != "Administrator" else None,
                "title": title,
                "description": description,
                "document": SR,
                "docname": sr.name,
                "project": sr.project,
                "work_package": "Services",
                "seen": "false",
                "type": "info",
                "event_id": SIGNED_UPLOAD_EVENT,
                "action_url": "invoice-reconciliation?tab=pending",
            }).insert(ignore_permissions=True)
        frappe.db.commit()
        for user in accountants:
            frappe.publish_realtime(SIGNED_UPLOAD_EVENT, {"title": title, "description": description,
                                                          "docname": sr.name}, user=user.name)
    except Exception:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Generated invoice upload notification failed")


@contextmanager
def _billing_lock(work_order):
    """Hold `work_order`'s billing lock, inside a transaction that started AFTER it was granted.

    Frappe runs PostgreSQL at REPEATABLE READ, so a transaction reads one snapshot, taken at its first
    statement: after waiting on a row lock, a second generate would still read the old highest RA
    number (the concurrency test saw it). So, as `api/tds/submit._project_send_lock` does, the lock is
    a session-level advisory lock and the commit right after it starts a fresh snapshot that holds
    everything the previous holder committed. The holder commits before it unlocks; a failure rolls
    back first, so the unlock runs on a usable transaction. The first commit also commits anything the
    caller wrote before: from the browser that is nothing.
    """
    key = f"wo_generated_invoice:{work_order}"
    frappe.db.commit()
    frappe.db.sql("SELECT pg_advisory_lock(hashtext(%s))", (key,))
    try:
        frappe.db.commit()
        yield
    except Exception:
        frappe.db.rollback()
        raise
    finally:
        frappe.db.sql("SELECT pg_advisory_unlock(hashtext(%s))", (key,))


def _new_record(fields):
    doc = frappe.get_doc({"doctype": gi.DOCTYPE, **fields})
    doc.flags.made_by_generate = True
    doc.insert(ignore_permissions=True)
    return doc


def _readable(work_order):
    assert_can_read_work_order(work_order)
    return frappe.get_doc(SR, work_order)


def _work_order_problem(sr) -> str | None:
    """Why no invoice may be generated on this WO at all, whatever its figures."""
    if sr.status != BILLABLE_STATUS:
        return _("Invoices are generated only on an Approved Work Order. This one is {0}.").format(sr.status)
    if not gst_is_explicitly_off(sr.gst):
        return _("Invoices are generated only on a GST-off Work Order. A GST vendor sends their own tax invoice.")
    if not cstr(sr.project_gst).strip():
        return _("Set the Work Order's Nirmaan GST before generating an invoice.")
    return None


def _final_problem(state) -> str | None:
    final = state["final"]
    if final:
        return _("This Work Order already has its FINAL invoice ({0}); nothing is generated after it.").format(final)
    return None


def _billing_state(sr) -> dict:
    """What is billed on the WO, what is left, its next RA number and its live FINAL, if any."""
    records = frappe.get_all(gi.DOCTYPE, filters={"work_order": sr.name},
                             fields=["ra_number", "invoice_type", "invoice_no", "amount", "status"])
    invoices = frappe.get_all("Vendor Invoices", filters={"document_type": SR, "document_name": sr.name},
                              fields=["invoice_no", "invoice_amount", "status"])
    billed = sum(flt(i.invoice_amount) for i in invoices if i.status in gi.BILLED_INVOICE_STATUSES)
    billed += sum(flt(r.amount) for r in records if r.status in gi.NOT_UPLOADED)
    final = next((r.invoice_no for r in records if r.invoice_type == gi.FINAL and r.status != gi.VOIDED), None)
    deleted = _deleted_records(sr.name)
    return {
        "billed": round(billed, 2),
        "left": gi.billable_left(sr.total_amount, sr.amount_paid, billed),
        "fully_paid": gi.is_fully_paid(sr.total_amount, sr.amount_paid),
        "final": final,
        # Every FINAL the WO has had, Voided and deleted ones included: the next one's printed number follows them.
        "finals": sum(1 for r in records + deleted if r["invoice_type"] == gi.FINAL),
        "next_ra_number": gi.next_ra_number(
            [r.ra_number for r in records] + [r["ra_number"] for r in deleted],
            [sr.invoice_no] + [i.invoice_no for i in invoices],
        ),
    }


def _deleted_records(work_order) -> list[dict]:
    """The RA number and type of each of `work_order`'s deleted generated invoices, from their Deleted
    Document copies, so a delete never frees a number."""
    copies = frappe.get_all("Deleted Document", filters={"deleted_doctype": gi.DOCTYPE,
                                                         "deleted_name": ("like", f"WGI-{work_order}-%")},
                            fields=["deleted_name", "data"])
    deleted = []
    for copy in copies:
        ra_number = gi.ra_number_of_record(copy.deleted_name, work_order)
        if ra_number is not None:
            deleted.append({"ra_number": ra_number, "invoice_type": frappe.parse_json(copy.data).get("invoice_type")})
    return deleted


def _row(doc) -> dict:
    row = {f: doc.get(f) for f in _ROW_FIELDS}
    row["ra_number"] = cint(row["ra_number"])
    row["amount"] = flt(row["amount"])
    return row

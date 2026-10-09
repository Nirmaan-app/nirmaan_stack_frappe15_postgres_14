import os
import re
import uuid
import json
import io
import frappe
import requests
from pypdf import PdfWriter, PdfReader
from nirmaan_stack.api.pdf_helper.po_print import merge_pdfs
from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
from PIL import Image

def _merge_content(merger, content, name):
    """
    Tries to add content to merger. 
    Returns (success, pdf_bytes) where pdf_bytes is valid PDF content (converted if was image).
    """
    try:
        # 1. Try PDF
        try:
            PdfReader(io.BytesIO(content))
            merger.append(io.BytesIO(content))
            return True, content
        except Exception:
            pass

        # 2. Try Image
        try:
            img = Image.open(io.BytesIO(content))
            if img.mode in ("P", "RGBA", "LA"):
                img = img.convert("RGB")
            elif img.mode != "RGB":
                img = img.convert("RGB")
            img_pdf = io.BytesIO()
            img.save(img_pdf, format="PDF")
            pdf_bytes = img_pdf.getvalue()
            merger.append(io.BytesIO(pdf_bytes))
            return True, pdf_bytes
        except Exception as e:
            print(f"Failed to convert image for {name}: {e}")
            return False, None

    except Exception as e:
        print(f"Failed to merge {name}: {e}")
        return False, None

def _fetch_attachment_content(original_url):
    if not original_url:
        return None
    try:
        file_url = get_s3_temp_url(original_url)
        
        # HTTP / Presigned URL
        if file_url.startswith("http"):
            res = requests.get(file_url, timeout=30, stream=True)
            res.raise_for_status()

            buffer = io.BytesIO()
            for chunk in res.iter_content(chunk_size=1024 * 1024):  # 1MB
                if chunk:
                    buffer.write(chunk)
            return buffer.getvalue()

        # Local filesystem
        else:
            file_path = None
            if original_url.startswith("/files/") or original_url.startswith("/private/files/"):
                file_path = frappe.utils.get_files_path(
                    original_url.lstrip("/"),
                    is_private=original_url.startswith("/private/")
                )

            if file_path and os.path.exists(file_path):
                with open(file_path, "rb") as f:
                    return f.read()
            else:
                # fallback HTTP
                site_url = frappe.utils.get_site_url(frappe.local.site)
                full_url = f"{site_url}{file_url}"
                res = requests.get(full_url, timeout=30)
                if res.status_code == 200:
                    return res.content
        return None
    except Exception as e:
        print(f"Error fetching attachment {original_url}: {e}")
        return None



@frappe.whitelist()
def fetch_temp_file(token, filename):
    """
    Fetches a temporary file by token and deletes it immediately after reading.
    """
    if not token:
        frappe.throw("Invalid download token")

    temp_path = frappe.utils.get_site_path("public", "files", "temp_downloads", f"{token}.bin")
    
    if not os.path.exists(temp_path):
        frappe.throw("Download link expired or already used.")

    with open(temp_path, "rb") as f:
        file_content = f.read()

    # Immediate deletion
    try:
        os.remove(temp_path)
    except Exception as e:
        frappe.log_error(f"Failed to delete temp file {temp_path}: {e}")

    frappe.local.response.filename = filename
    frappe.local.response.filecontent = file_content
    frappe.local.response.type = "download"


def get_temp_path(token):
    return frappe.utils.get_site_path("public", "files", "temp_downloads", f"{token}.bin")


def ensure_temp_dir():
    temp_dir = frappe.utils.get_site_path("public", "files", "temp_downloads")
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)


# A bulk download covers one project (the project page's tab) or one vendor (the vendor page's
# tab). Every endpoint takes both keywords and needs exactly one of them.
SCOPE_LABEL = {"project": ("Projects", "project_name"), "vendor": ("Vendors", "vendor_name")}

PAYMENT_VOUCHERS = "Payment Vouchers"

# Which documents a "download all" takes. (The wizard's lists differ in places: it keeps PO
# Amendment, and its DN list drops Partially Dispatched -- existing behaviour, kept as is.)
ALL_DOC_FILTERS = {
    "PO": ("Procurement Orders", {"status": ["not in", ["Merged", "Cancelled", "PO Amendment", "Inactive"]]}),
    "WO": ("Service Requests", {"status": "Approved"}),
    "DN": ("Procurement Orders", {"status": ["in", ["Delivered", "Partially Delivered", "Partially Dispatched"]]}),
}

INVOICE_DOCUMENT_TYPES = {"PO Invoices": "Procurement Orders", "WO Invoices": "Service Requests", "All Invoices": None}

# doc_type -> (Nirmaan Attachments.attachment_type, PO Delivery Documents.type)
DELIVERY_DOC_TYPES = {
    "DC": ("po delivery challan", "Delivery Challan"),
    "MIR": ("material inspection report", "Material Inspection Report"),
}


def _scope(project=None, vendor=None):
    """-> (filter field, id, display name used in the file name)."""
    if bool(project) == bool(vendor):
        frappe.throw("Pass exactly one of project or vendor.")
    field, value = ("project", project) if project else ("vendor", vendor)
    doctype, name_field = SCOPE_LABEL[field]
    return field, value, frappe.db.get_value(doctype, value, name_field) or value


def _reader(field):
    """Project scope reads with `get_all`, as it always has. Vendor scope reads with `get_list` as
    the user: a vendor's documents span projects, and a user held to some projects by User
    Permission must not get the others' files -- fetching an attachment checks nothing."""
    return frappe.get_all if field == "project" else frappe.get_list


def _all_doc_names(doc_type, field, value):
    doctype, filters = ALL_DOC_FILTERS[doc_type]
    rows = _reader(field)(doctype, filters={field: value, **filters}, fields=["name"], order_by="creation asc")
    return [r.name for r in rows]


def _all_attachments(doc_type, field, value):
    """Every file a "download all" merges for an attachment type, oldest first."""
    read = _reader(field)
    if doc_type in INVOICE_DOCUMENT_TYPES:
        filters = {field: value, "status": "Approved"}
        if INVOICE_DOCUMENT_TYPES[doc_type]:
            filters["document_type"] = INVOICE_DOCUMENT_TYPES[doc_type]
        rows = read("Vendor Invoices", filters=filters, fields=["invoice_attachment"], order_by="creation asc")
        return [r.invoice_attachment for r in rows if r.invoice_attachment]
    if doc_type in DELIVERY_DOC_TYPES:
        attachment_type, pdd_type = DELIVERY_DOC_TYPES[doc_type]
        if field == "project":
            rows = frappe.get_all("Nirmaan Attachments", filters={"project": value, "attachment_type": attachment_type}, fields=["name"], order_by="creation asc")
            return [r.name for r in rows]
        # Nirmaan Attachments has no vendor field: reach the files through the POs' delivery documents.
        rows = read(
            "PO Delivery Documents",
            filters={"vendor": value, "parent_doctype": "Procurement Orders", "type": pdd_type, "nirmaan_attachment": ["is", "set"]},
            fields=["nirmaan_attachment"],
            order_by="creation asc",
        )
        return [r.nirmaan_attachment for r in rows]
    if doc_type == "Client Invoices" and field == "project":
        rows = frappe.get_all("Project Invoices", filters={"project": value}, fields=["attachment"], order_by="invoice_date asc")
        return [r.attachment for r in rows if r.attachment]
    return []


def _voucher_files(field, value, names=None):
    """The uploaded voucher of each paid WO payment in scope -- only the given payments when
    `names` is passed. Read with `get_list` in both scopes, so a user only gets payments they may
    read, and a payment whose voucher was removed after the list loaded is simply skipped."""
    filters = {field: value, "document_type": "Service Requests", "status": "Paid", "voucher_attachment": ["is", "set"]}
    if names is not None:
        if not names:
            return []
        filters["name"] = ["in", names]
    rows = frappe.get_list("Project Payments", filters=filters, fields=["voucher_attachment"], order_by="payment_date asc, creation asc")
    return [r.voucher_attachment for r in rows]


def _check_doc_type(field, doc_type):
    if field == "vendor" and doc_type == "Client Invoices":
        frappe.throw("Client Invoices belong to a project, not a vendor.")


# Each download carries its own id -- the browser makes one per click and sends it -- and every
# event the job publishes carries it back, so two downloads of one user (a project tab and a vendor
# tab, or two vendor tabs) each react only to their own events. Deliberately NOT named `job_id`:
# `frappe.enqueue` takes that keyword for itself, and the job would receive None.
DOWNLOAD_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
CANCEL_TTL_SECONDS = 6 * 60 * 60


def _download_id(value):
    """The browser's id for this download, or a fresh one when it sent none (or a malformed one)."""
    if value and DOWNLOAD_ID_RE.match(str(value)):
        return str(value)
    return frappe.generate_hash(length=16)


def _cancel_key(user, download_id):
    return f"bulk_download_cancel:{user}:{download_id}"


def _is_cancelled(user, download_id):
    # `exists` asks Redis every time. `get_value` would keep its first answer in frappe.local.cache
    # for the whole job and never see a cancel that arrives later.
    return bool(download_id) and bool(frappe.cache.exists(_cancel_key(user, download_id)))


def _require_selection(value, noun):
    """A "Selected" download needs at least one item: an empty list must never reach the job,
    where leaving the list out means "download everything"."""
    try:
        items = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        items = None
    if not isinstance(items, list) or not items:
        frappe.throw(f"Select at least one {noun} to download.")


def _enqueue(scope, doc_type, file_part, download_id=None, **job_kwargs):
    field, value, label = scope
    download_id = _download_id(download_id)
    frappe.enqueue(
        "nirmaan_stack.api.pdf_helper.bulk_download.run_bulk_download_job",
        doc_type=doc_type,
        user=frappe.session.user,
        custom_filename=f"{label}_{file_part}.pdf",
        download_id=download_id,
        queue="long",
        **{field: value},
        **job_kwargs,
    )
    return {"message": "Job enqueued", "download_id": download_id}


@frappe.whitelist(methods=["POST"])
def cancel_bulk_download(download_id):
    """Stop one of the CALLER's own downloads (the progress window's Cancel). The job checks
    between documents, so it ends after the one in hand; a job still waiting in the queue ends as
    soon as it starts. Keyed by user, so nobody can cancel another user's download."""
    if not DOWNLOAD_ID_RE.match(str(download_id or "")):
        frappe.throw("Invalid download id.")
    frappe.cache.set_value(_cancel_key(frappe.session.user, download_id), 1, expires_in_sec=CANCEL_TTL_SECONDS)
    return {"message": "Cancelled"}


@frappe.whitelist()
def download_selected_pos(names, with_rate=1, project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    _require_selection(names, "PO")
    return _enqueue(scope, "PO", "Selected_POs", download_id, names=names, with_rate=with_rate)


@frappe.whitelist()
def download_selected_wos(names, with_rate=1, project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    _require_selection(names, "WO")
    return _enqueue(scope, "WO", "Selected_WOs", download_id, names=names, with_rate=with_rate)


@frappe.whitelist()
def download_selected_dns(names, project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    _require_selection(names, "DN")
    return _enqueue(scope, "DN", "Selected_DNs", download_id, names=names)


@frappe.whitelist()
def download_selected_payment_vouchers(names, project=None, vendor=None, download_id=None):
    # Takes PAYMENT names, not file URLs: the job reads each voucher back itself (`_voucher_files`).
    scope = _scope(project, vendor)
    _require_selection(names, "payment")
    return _enqueue(scope, PAYMENT_VOUCHERS, "Selected_Payment_Vouchers", download_id, names=names)


@frappe.whitelist()
def download_selected_attachments(attachment_names, doc_type, project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    _check_doc_type(scope[0], doc_type)
    if doc_type == PAYMENT_VOUCHERS:
        frappe.throw("Payment vouchers are downloaded by payment, through download_selected_payment_vouchers.")
    _require_selection(attachment_names, "document")
    return _enqueue(scope, doc_type, f"Selected_{doc_type.replace(' ', '_')}", download_id, attachment_names=attachment_names)


@frappe.whitelist()
def download_all_pos(with_rate=1, project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    names = _all_doc_names("PO", scope[0], scope[1])
    return _enqueue(scope, "PO", "All_POs", download_id, names=json.dumps(names), with_rate=with_rate)


@frappe.whitelist()
def download_all_wos(with_rate=1, project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    names = _all_doc_names("WO", scope[0], scope[1])
    return _enqueue(scope, "WO", "All_WOs", download_id, names=json.dumps(names), with_rate=with_rate)


@frappe.whitelist()
def download_all_dns(project=None, vendor=None, download_id=None):
    scope = _scope(project, vendor)
    names = _all_doc_names("DN", scope[0], scope[1])
    return _enqueue(scope, "DN", "All_DNs", download_id, names=json.dumps(names))


@frappe.whitelist()
def download_project_attachments(doc_type, project=None, vendor=None, download_id=None):
    # Enqueue with doc_type, the worker will resolve names if not provided
    scope = _scope(project, vendor)
    _check_doc_type(scope[0], doc_type)
    return _enqueue(scope, doc_type, f"All_{doc_type.replace(' ', '_')}", download_id)


def run_bulk_download_job(doc_type, project=None, vendor=None, names=None, attachment_names=None, with_rate=1, user=None, custom_filename=None, download_id=None):
    """
    Worker: build one merged PDF and announce it. It never ends silently -- every way out
    publishes `bulk_download_failed` (or the file), stamped with `download_id`, so the progress
    window can always close. A cancelled download simply stops.
    """
    frappe.set_user(user or "Administrator")

    def publish(event, data):
        frappe.publish_realtime(event, {**data, "download_id": download_id}, user=user)

    try:
        _build_and_announce(publish, doc_type, project, vendor, names, attachment_names, with_rate, user, custom_filename, download_id)
    except frappe.PermissionError:
        publish("bulk_download_failed", {"message": f"You do not have access to these {doc_type}."})
    except Exception:
        # A DB error leaves the PostgreSQL transaction aborted; roll back so the Error Log can be written.
        frappe.db.rollback()
        frappe.log_error(title=f"Bulk download failed: {doc_type}")
        publish("bulk_download_failed", {"message": "The download failed. Please try again."})


def _build_and_announce(publish, doc_type, project, vendor, names, attachment_names, with_rate, user, custom_filename, download_id):
    ensure_temp_dir()
    field, value, label = _scope(project, vendor)

    if isinstance(names, str): names = json.loads(names)
    if isinstance(attachment_names, str): attachment_names = json.loads(attachment_names)
    if isinstance(with_rate, str): with_rate = with_rate.lower() in ("true", "1", "yes")

    if _is_cancelled(user, download_id):
        return

    # Resolve the document list. Only a "download all" leaves both lists out; an explicit empty
    # list means nothing, never everything.
    if doc_type == PAYMENT_VOUCHERS:
        # The selected payments (or all of them) -> their voucher files.
        attachment_names, names = _voucher_files(field, value, names), None
    elif names is None and attachment_names is None:
        if doc_type in ALL_DOC_FILTERS:
            names = _all_doc_names(doc_type, field, value)
        else:
            attachment_names = _all_attachments(doc_type, field, value)

    items_to_process = attachment_names if attachment_names else names
    if not items_to_process:
        publish("bulk_download_failed", {"message": f"No {doc_type} items found."})
        return

    total_items = len(items_to_process)

    final_merger = PdfWriter()
    count = 0

    # Unified Single-Flow Processing
    for i, item in enumerate(items_to_process):
        if _is_cancelled(user, download_id):
            return
        try:
            # Progress Reporting
            abs_index = i + 1
            progress = int((abs_index / total_items) * 100)
            publish(
                "bulk_download_progress",
                {"progress": progress, "message": f"Processing {doc_type} {abs_index} of {total_items}...", "label": doc_type},
            )

            if attachment_names:
                # Attachment Logic
                # Any URL-like value (file path or S3-proxy URL) goes through
                # _fetch_attachment_content; bare doc names hit the Nirmaan
                # Attachments lookup. Project Invoice attachments are S3-proxy
                # URLs like /api/method/frappe_s3_attachment.controller... so
                # we route on the leading "/" or "http" rather than a strict
                # /files/ prefix list.
                if item.startswith("/") or item.startswith("http"):
                    content = _fetch_attachment_content(item)
                else:
                    content = _fetch_attachment_content_by_name(item)
                
                if content:
                    success, pdf_bytes = _merge_content(final_merger, content, item)
                    if success:
                        count += 1
            else:
                # Generic Doc Logic (PO, WO, DN)
                dt_map = {"PO": "Procurement Orders", "WO": "Service Requests", "DN": "Procurement Orders"}
                dt = dt_map.get(doc_type)
                pf_map = {"PO": "PO Orders" if with_rate else "PO Orders Without Rate", "WO": "Work Orders" if with_rate else "Work Orders Without Rate", "DN": "PO Delivery Histroy"}
                pf = pf_map.get(doc_type)
                
                pdf_content = frappe.get_print(dt, item, print_format=pf, as_pdf=True)
                
                if doc_type == "PO":
                    doc_attachment = frappe.db.get_value(dt, item, "attachment")
                    if doc_attachment:
                        pdf_content = merge_pdfs(pdf_content, [doc_attachment])
                
                if pdf_content:
                    final_merger.append(io.BytesIO(pdf_content))
                    count += 1
        except Exception as e:
            print(f"Error processing {doc_type} {item}: {e}")

    if _is_cancelled(user, download_id):
        return

    # Final Save and Notify
    if count > 0:
        final_token = str(uuid.uuid4())
        final_path = get_temp_path(final_token)
        with open(final_path, "wb") as f:
            final_merger.write(f)
        final_merger.close()

        filename = custom_filename or f"{label}_All_{doc_type}.pdf"

        publish("bulk_download_all_ready", {"token": final_token, "filename": filename})
    else:
        publish("bulk_download_failed", {"message": "Failed to generate any documents."})


def _fetch_attachment_content_by_name(attachment_record_name):
    doc = frappe.get_doc("Nirmaan Attachments", attachment_record_name)
    if doc.attachment:
        return _fetch_attachment_content(doc.attachment)
    return None


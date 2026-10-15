# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Porter import's Validate step: every Porter Invoice against Porter's own PDF (#1444, ADR-0032).

Part of the Porter pipeline (`api/outflow_import/porter.py` holds its endpoints; the pure rules are in
`services/outflow_import/porter.py`). This module is the background job and the PDF download helper.

EACH PORTER INVOICE, UP TO `VALIDATION_CONCURRENCY` AT ONCE
-----------------------------------------------------------
    Queued -> Downloading   the PDF is fetched from the statement's link (`fetch_invoice_pdf`: timeout,
                            size cap, must be a PDF) and stored ONCE as a private File on the invoice
           -> Reading       the shared Gemini extraction reads number, date, both GSTINs, fare, tax;
                            what it read is stored on the invoice
           -> Comparing     `porter.judge_invoice` against the statement's completed orders
           -> Passed / Failed / Error

Every step is COMMITTED, so the dialog's poll (`get_porter_status`) shows where each invoice stands, and
a worker restart loses at most the invoice in hand. A download or Gemini failure is *Error* and keeps any
PDF already stored, so a Retry (`porter.retry_porter_invoice`) reads it again without re-downloading.
A *Failed* invoice is final: nothing here, or anywhere, moves it on (no override, ADR-0032).

⚠️ AN INVOICE IS CLAIMED BEFORE IT IS WORKED ON. Only a `Queued` invoice is picked up, and the claim
moves it on under a row lock -- so the upload's job and a Retry's job can overlap without reading one
invoice twice, and re-running the job never touches a decided invoice.

⚠️ EACH CONCURRENT INVOICE HAS ITS OWN DATABASE CONNECTION. Gemini takes 30 s to several minutes per
invoice, so they run in threads; a frappe connection is not shared between threads, so each one opens
its own (`_validate_on_own_connection`), as a second worker would. Each touches only its own invoice.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation

import frappe
import requests
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.invoice_autofill import (
    GST_COMPONENT_KEYS,
    INVOICE_DATE_KEYS,
    INVOICE_NO_KEYS,
    NET_AMOUNT_KEYS,
    TOTAL_TAX_KEY,
)
from nirmaan_stack.services.extraction import extract
from nirmaan_stack.services.extraction.base import INVOICE
from nirmaan_stack.services.extraction.files import fetch_file_content, get_extraction_settings
from nirmaan_stack.services.extraction.helpers import get_file_doc_by_url, normalize_date, pick_entity
from nirmaan_stack.services.extraction.validation import derive_gst
from nirmaan_stack.services.outflow_import.porter import (
    INVOICE_COMPARING,
    INVOICE_DOWNLOADING,
    INVOICE_ERROR,
    INVOICE_QUEUED,
    INVOICE_READING,
    InvoiceFigures,
    InvoiceRead,
    judge_invoice,
)

INVOICE_DOCTYPE = "Porter Invoice"

#: How many invoices are worked on at once (spec #1442: a month's ten in minutes, not an hour).
VALIDATION_CONCURRENCY = 3

#: A Porter invoice PDF is about 100 KB; anything near this is not one.
MAX_INVOICE_PDF_BYTES = 10 * 1024 * 1024

#: (connect, read) seconds for the PDF download.
DOWNLOAD_TIMEOUT = (10, 60)

_JOB = "nirmaan_stack.api.outflow_import.porter_validation.validate_porter_import"


class InvoiceDownloadError(Exception):
    """The invoice PDF could not be fetched, or what came back is not one. The message says why."""


def enqueue_validation(batch: str, actor: str, job_id: str | None = None) -> None:
    """Start (or re-start) the import's validation in the background, DE-DUPLICATED by `job_id`.

    The upload uses one id per import; a Retry uses one per invoice, so it is never swallowed by an
    upload job still running. Two jobs overlapping is harmless: each invoice is claimed before use.
    """
    frappe.enqueue(
        _JOB,
        queue="long",
        timeout=3600,
        batch=batch,
        actor=actor,
        job_id=job_id or f"porter-validate-{batch}",
        deduplicate=True,
    )


def validate_porter_import(batch: str, actor: str) -> None:
    """THE JOB: validate every `Queued` Porter Invoice of the import, up to three at once.

    Invoices that become Queued while it runs (a Retry) are picked up before it ends. An invoice is
    attempted once per run, so a run always ends.
    """
    site, sites_path = frappe.local.site, frappe.local.sites_path
    attempted: set[str] = set()
    while True:
        queued = [
            name
            for name in frappe.get_all(
                INVOICE_DOCTYPE,
                filters={"import_batch": batch, "validation_status": INVOICE_QUEUED},
                pluck="name",
                order_by="creation asc, name asc",
            )
            if name not in attempted
        ]
        if not queued:
            return
        attempted.update(queued)
        with ThreadPoolExecutor(max_workers=VALIDATION_CONCURRENCY) as pool:
            list(
                pool.map(
                    lambda name: _validate_on_own_connection(site, sites_path, actor, name), queued
                )
            )
        # This connection's snapshot must not hide what the threads committed.
        frappe.db.rollback()


def _validate_on_own_connection(site: str, sites_path: str, actor: str, invoice: str) -> None:
    frappe.init(site=site, sites_path=sites_path)
    try:
        frappe.connect()
        frappe.set_user(actor)
        validate_invoice(invoice)
    except Exception:
        frappe.log_error(
            title="Porter validation: an invoice could not be validated",
            message=f"{invoice}\n\n{frappe.get_traceback()}",
        )
    finally:
        frappe.destroy()


def validate_invoice(name: str) -> None:
    """One Porter Invoice, from Queued to Passed / Failed / Error, committing every step.

    ⚠️ RAW `set_value` ON `Porter Invoice` THROUGHOUT: the doctype has no `doc_events`, and these are
    status and read-figure writes nothing is derived from (the import's state is derived on read).
    """
    invoice = _claim(name)
    if invoice is None:
        return

    stage = "download"
    try:
        if invoice.invoice_file:
            content = _stored_pdf(invoice.invoice_file)
        else:
            content = fetch_invoice_pdf(invoice.invoice_link or "")
            # ⚠️ STORED ONCE, attached to its invoice AT INSERT -- the storage key is derived from the
            # attachment then. Every Porter Expense of this invoice will share this URL (#1445).
            saved = save_file(
                fname=f"{name}.pdf",
                content=content,
                dt=INVOICE_DOCTYPE,
                dn=name,
                df="invoice_file",
                is_private=1,
            )
            frappe.db.set_value(INVOICE_DOCTYPE, name, "invoice_file", saved.file_url, update_modified=False)
            _move(name, INVOICE_READING)

        stage = "read"
        read = _read_invoice(content)
        _store_read(name, read)
        _move(name, INVOICE_COMPARING)

        verdict = judge_invoice(
            InvoiceFigures(
                invoice_number=invoice.invoice_number,
                porter_gstin=invoice.porter_gstin or "",
                customer_gstin=invoice.customer_gstin or "",
                fare=_decimal(invoice.fare_total) or Decimal("0"),
                tax=_decimal(invoice.tax_total) or Decimal("0"),
            ),
            read,
        )
        _move(name, verdict.status, verdict.message)
    except Exception as exc:
        frappe.db.rollback()
        frappe.local.message_log = []
        if isinstance(exc, InvoiceDownloadError):
            reason = f"the PDF could not be downloaded: {exc}"
        elif stage == "download":
            reason = "its stored PDF could not be read back"
        else:
            reason = "Gemini could not read the PDF"
        frappe.log_error(
            title=f"Porter validation: {name} could not be validated",
            message=frappe.get_traceback(),
        )
        _move(name, INVOICE_ERROR, f"Invoice {name}: {reason}. Retry it.")


def _claim(name: str) -> frappe._dict | None:
    """Take a `Queued` invoice, under its row lock, and move it on. None if it is not Queued."""
    rows = frappe.db.sql(
        """
        SELECT name, invoice_number, invoice_link, invoice_file, porter_gstin, customer_gstin,
               fare_total, tax_total, validation_status
        FROM "tabPorter Invoice" WHERE name = %s FOR UPDATE
        """,
        (name,),
        as_dict=True,
    )
    if not rows or rows[0].validation_status != INVOICE_QUEUED:
        frappe.db.rollback()
        return None
    invoice = rows[0]
    # A fresh attempt: what an earlier attempt read must not show beside this one's outcome.
    _store_read(name, InvoiceRead("", None, "", "", None, None))
    # A Retry reuses the PDF already stored, so it goes straight to Reading.
    _move(name, INVOICE_READING if invoice.invoice_file else INVOICE_DOWNLOADING)
    return invoice


def _store_read(name: str, read: InvoiceRead) -> None:
    """What Gemini read, on the invoice. ⚠️ `read_fare` / `read_tax` are NOT NULL Currency columns, so a
    figure it did not read is stored as 0 -- `porter.what_gemini_read`, the one reader, reads 0 back as
    "not read"."""
    frappe.db.set_value(
        INVOICE_DOCTYPE,
        name,
        {
            "read_invoice_number": read.invoice_number or None,
            "read_invoice_date": read.invoice_date,
            "read_supplier_gstin": read.supplier_gstin or None,
            "read_receiver_gstin": read.receiver_gstin or None,
            "read_fare": float(read.fare) if read.fare is not None else 0,
            "read_tax": float(read.tax) if read.tax is not None else 0,
        },
        update_modified=False,
    )


def _move(name: str, status: str, message: str = "") -> None:
    frappe.db.set_value(
        INVOICE_DOCTYPE,
        name,
        {"validation_status": status, "validation_message": message or None},
        update_modified=False,
    )
    frappe.db.commit()


def fetch_invoice_pdf(url: str) -> bytes:
    """Download an invoice PDF from its link. THE SEAM tests fake for the download.

    Refuses (`InvoiceDownloadError`, the message saying why): a link that is not `https://`, an HTTP
    error or timeout, more than `MAX_INVOICE_PDF_BYTES`, and anything that does not start like a PDF.
    Streams with a byte cap, so an oversized answer is never held whole.
    """
    if not url.strip().lower().startswith("https://"):
        raise InvoiceDownloadError("its link is not an https:// address")
    chunks: list[bytes] = []
    size = 0
    try:
        with requests.get(url.strip(), stream=True, timeout=DOWNLOAD_TIMEOUT) as response:
            response.raise_for_status()
            for chunk in response.iter_content(64 * 1024):
                size += len(chunk)
                if size > MAX_INVOICE_PDF_BYTES:
                    raise InvoiceDownloadError(
                        f"it is larger than {MAX_INVOICE_PDF_BYTES // (1024 * 1024)} MB"
                    )
                chunks.append(chunk)
    except requests.RequestException as exc:
        raise InvoiceDownloadError(f"the request failed ({exc.__class__.__name__})") from exc
    content = b"".join(chunks)
    if not content.startswith(b"%PDF-"):
        raise InvoiceDownloadError("what came back is not a PDF")
    return content


def _stored_pdf(file_url: str) -> bytes:
    """The PDF a previous attempt stored, read back from storage (never downloaded again)."""
    file_doc = get_file_doc_by_url(file_url)
    content = fetch_file_content(file_doc, file_doc.name) if file_doc else None
    if not content:
        raise RuntimeError(f"No readable File for {file_url}")
    return content


def _read_invoice(content: bytes) -> InvoiceRead:
    """What the shared Gemini extraction reads off the PDF. Raises if it cannot read it at all."""
    settings = get_extraction_settings()
    if not settings.get("enabled"):
        raise RuntimeError("Document extraction is switched off in Document AI Settings.")
    _, entities, _ = extract(content, "pdf", settings, doc_kind=INVOICE)

    def _pick(keys, normalized=False):
        return pick_entity(entities, keys, prefer_normalized=normalized)[0]

    gst = derive_gst(
        total_tax=_pick((TOTAL_TAX_KEY,), True),
        **{part: _pick((key,), True) for part, key in GST_COMPONENT_KEYS.items()},
    )
    return InvoiceRead(
        invoice_number=_pick(INVOICE_NO_KEYS),
        invoice_date=normalize_date(_pick(INVOICE_DATE_KEYS, True)) or None,
        supplier_gstin=_pick(("supplier_gstin",)),
        receiver_gstin=_pick(("receiver_gstin",)),
        fare=_decimal(_pick(NET_AMOUNT_KEYS, True)),
        tax=_decimal(gst["gst"]),
    )


def _decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value).replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None

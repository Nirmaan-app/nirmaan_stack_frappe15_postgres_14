# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A claim's receipts: PDFs and pictures merged into one PDF (`attachment`), other files attached as they are.

The Raise dialog uploads every receipt first, as a loose `File` owned by the claimant (no doctype on the
upload: Frappe's `upload_file` checks WRITE on the doctype, and claimants hold read only). The endpoint
then works in two steps, because the storage app commits inside `save_file` and nothing it stored can be
rolled back (CODING_STANDARDS § Reading uploaded file bytes):

1. `plan_receipts` -- read every PDF and picture and merge them IN MEMORY, before anything is written. A
   file that can't be read or merged stops the save with nothing half-written.
2. `apply_receipts` -- after the claim is saved: store the merged PDF on it, adopt the other files, and
   return the Files to delete. The caller deletes them LAST, through `services/stored_files.delete_files`.

On an edit, new PDFs and pictures are merged after the claim's existing PDF, and any receipt can be removed.

`merge_to_pdf` and `is_mergeable` are pure, so the merge is tested without a database or storage.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass, field

import frappe
from frappe import _
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.pdf_helper.pdf_merger_api import fetch_attachment_content

DOCTYPE = "Reimbursement"
ATTACHMENT_FIELD = "attachment"

#: Files merged into the receipts PDF. Anything else (a spreadsheet, a HEIC photo Pillow can't open) is
#: attached as it is.
PDF_EXTENSIONS = (".pdf",)
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff")
MAX_RECEIPTS = 20

#: An A4 page at 150 dpi, the size a picture is fitted onto (never stretched), as the HOD binder does.
A4_PX = (1240, 1754)


class ReceiptError(frappe.ValidationError):
    """A receipt can't be used: it isn't the claimant's, can't be read, or can't be merged."""


def is_mergeable(file_name: str | None) -> bool:
    """True for a PDF or a picture, by its extension."""
    ext = os.path.splitext((file_name or "").lower())[1]
    return ext in PDF_EXTENSIONS or ext in IMAGE_EXTENSIONS


def merge_to_pdf(parts: list[tuple[str, bytes]]) -> bytes:
    """Merge `(file name, bytes)` parts, in order, into one PDF. A PDF keeps its pages; a picture is
    turned to its upright orientation and fitted onto an A4 page. Raises `ValueError` naming the part
    that can't be read."""
    from PIL import Image, ImageOps
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for name, content in parts:
        if not content:
            raise ValueError(f"{name} is empty.")
        try:
            reader = PdfReader(io.BytesIO(content))
            for page in reader.pages:
                writer.add_page(page)
            continue
        except Exception:
            pass
        try:
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(content)))
            if img.mode != "RGB":
                img = img.convert("RGB")
        except Exception as e:
            raise ValueError(f"{name} isn't a PDF or a picture that can be read.") from e
        page_w, page_h = A4_PX if img.width <= img.height else A4_PX[::-1]
        scale = min(page_w / img.width, page_h / img.height)
        fitted = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
        page = Image.new("RGB", (page_w, page_h), "white")
        page.paste(fitted, ((page_w - fitted.width) // 2, (page_h - fitted.height) // 2))
        out = io.BytesIO()
        page.save(out, format="PDF", resolution=150)
        for pdf_page in PdfReader(io.BytesIO(out.getvalue())).pages:
            writer.add_page(pdf_page)
    if not writer.pages:
        raise ValueError("There are no pages to merge.")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@dataclass
class ReceiptPlan:
    """What saving a claim does to its receipts, worked out before anything is written."""

    merged_pdf: bytes | None = None  # a new receipts PDF to store, replacing the current one
    clear_attachment: bool = False  # the current receipts PDF was removed and nothing replaces it
    adopt: list[str] = field(default_factory=list)  # loose Files (not PDF / picture) to attach as they are
    delete_after: list[str] = field(default_factory=list)  # Files to delete once the claim is saved
    receipt_count: int = 0  # receipts the claim will have


def loose_files(file_urls: list[str] | None, user: str) -> list[dict]:
    """The loose Files behind `file_urls`: each must be uploaded by `user` and attached to nothing."""
    urls = [u for u in (file_urls or []) if u]
    if len(urls) > MAX_RECEIPTS:
        frappe.throw(_("Attach at most {0} receipts to one claim.").format(MAX_RECEIPTS), ReceiptError)
    files = []
    for url in urls:
        row = frappe.db.get_value(
            "File",
            {"file_url": url, "owner": user, "attached_to_doctype": ["is", "not set"]},
            ["name", "file_name", "file_url"],
            as_dict=True,
        )
        if not row:
            frappe.throw(_("A receipt couldn't be found. Upload it again."), ReceiptError)
        files.append(row)
    return files


def claim_files(claim_name: str) -> list[dict]:
    """The Files attached to a saved claim: its receipts PDF and any other receipts."""
    return frappe.get_all(
        "File",
        filters={"attached_to_doctype": DOCTYPE, "attached_to_name": claim_name},
        fields=["name", "file_name", "file_url", "attached_to_field"],
        order_by="creation asc",
    )


def _read(name: str, url: str) -> bytes:
    content = fetch_attachment_content(url)
    if not content:
        frappe.throw(_("{0} couldn't be read. Upload it again.").format(name), ReceiptError)
    return content


def plan_receipts(claim, new_files: list[dict], remove_urls: list[str] | None = None) -> ReceiptPlan:
    """Work out, and merge in memory, what saving `claim` (None for a new one) does to its receipts.

    `new_files` come from `loose_files`; `remove_urls` are receipts already on the claim to remove.
    """
    plan = ReceiptPlan()
    current = claim_files(claim.name) if claim else []
    current_by_url = {f.file_url: f for f in current}
    remove = set(remove_urls or [])
    unknown = remove - set(current_by_url)
    if unknown:
        frappe.throw(_("A receipt to remove isn't on this claim."), ReceiptError)

    attachment_url = (claim.get(ATTACHMENT_FIELD) if claim else None) or None
    keep_attachment = bool(attachment_url) and attachment_url not in remove
    for url in remove:
        plan.delete_after.append(current_by_url[url].name)

    kept_others = [f for f in current if f.file_url != attachment_url and f.file_url not in remove]
    new_mergeable = [f for f in new_files if is_mergeable(f.file_name)]
    new_others = [f for f in new_files if not is_mergeable(f.file_name)]

    if new_mergeable:
        parts = []
        if keep_attachment:
            parts.append((f"{claim.name}-receipts.pdf", _read("The current receipts PDF", attachment_url)))
            old = current_by_url.get(attachment_url)
            if old:
                plan.delete_after.append(old.name)
        for f in new_mergeable:
            parts.append((f.file_name, _read(f.file_name, f.file_url)))
        try:
            plan.merged_pdf = merge_to_pdf(parts)
        except ValueError as e:
            frappe.throw(_("{0} Remove it, or upload a PDF or a photo instead.").format(str(e)), ReceiptError)
        plan.delete_after.extend(f.name for f in new_mergeable)
    elif attachment_url and not keep_attachment:
        plan.clear_attachment = True

    plan.adopt = [f.name for f in new_others]
    has_pdf = bool(plan.merged_pdf) or keep_attachment
    plan.receipt_count = int(has_pdf) + len(kept_others) + len(new_others)
    return plan


def apply_receipts(claim, plan: ReceiptPlan) -> list[str]:
    """Store `plan` on the saved `claim` and return the Files the caller deletes LAST.

    `save_file` commits inside the storage hook, so this runs only after every check has passed.
    """
    if plan.merged_pdf:
        file_doc = save_file(
            f"{claim.name}-receipts.pdf", plan.merged_pdf, DOCTYPE, claim.name, df=ATTACHMENT_FIELD, is_private=1,
        )
        # The storage hook rewrites `file_url`, so read it back.
        claim.db_set(ATTACHMENT_FIELD, frappe.db.get_value("File", file_doc.name, "file_url"))
    elif plan.clear_attachment:
        claim.db_set(ATTACHMENT_FIELD, None)

    if plan.adopt:
        # Link columns only, and only while still loose: the bytes are already stored, so this skips the
        # storage hook on purpose (the `non_project_inflows.adopt_receipt_file` shape).
        frappe.db.sql(
            """
            UPDATE "tabFile"
            SET attached_to_doctype = %(dt)s, attached_to_name = %(dn)s, attached_to_field = NULL
            WHERE name IN %(names)s AND COALESCE(attached_to_doctype, '') = ''
            """,
            {"dt": DOCTYPE, "dn": claim.name, "names": tuple(plan.adopt)},
        )
    return list(plan.delete_after)


def detach_claim_files(claim_name: str) -> list[str]:
    """Unlink every File from a claim about to be deleted and return their names.

    Frappe's delete trashes a document's Files through the document layer, which deletes stored bytes
    another File may share. Detached first, they are deleted after the claim by `delete_files`, last.
    """
    names = [f.name for f in claim_files(claim_name)]
    if names:
        frappe.db.sql(
            """UPDATE "tabFile" SET attached_to_doctype = NULL, attached_to_name = NULL, attached_to_field = NULL
            WHERE name IN %(names)s""",
            {"names": tuple(names)},
        )
    return names

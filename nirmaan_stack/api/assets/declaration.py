"""The employee signs their own asset declaration in the app.

Replaces print -> sign by hand -> scan -> HR uploads. The person the asset is assigned to draws a signature;
this endpoint renders the "Asset Master Form" with it in the Employee boxes and attaches the PDF to the
assignment's `asset_declaration_attachment`, the same field HR's scanned upload fills.

The employee has only read access to Asset Management, so the checks here are the authorisation: the
signer must be the assignee, the row must not already have a declaration, and the asset's holder must match
the assignment. They run again under a row lock after the PDF is rendered, because rendering ends the
transaction and a second tab could have signed meanwhile.
"""

import frappe
from frappe.utils import format_datetime, now_datetime
from frappe.utils.file_manager import save_file

from nirmaan_stack.services.asset_declaration import (
    NOT_ASSIGNEE,
    PRINT_FORMAT_MARKER,
    REFUSAL_MESSAGES,
    clean_signature_png,
    png_data_uri,
    sign_refusal,
)

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"
DECLARATION_FORMAT = "Asset Master Form"
DECLARATION_FIELD = "asset_declaration_attachment"


@frappe.whitelist(methods=["POST"])
def sign_declaration(assignment: str, signature: str) -> dict:
    """Sign the declaration of one assignment and attach the signed PDF.

    Args:
        assignment: the Asset Management record's name.
        signature: the drawing as a `data:image/png;base64,...` URI.

    Returns:
        {"file_url": <private URL of the signed PDF>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.declaration.sign_declaration
        {"assignment": "k72sevcfkp", "signature": "data:image/png;base64,iVBORw0..."}
    """
    row = frappe.get_doc(ASSET_MANAGEMENT_DOCTYPE, assignment)
    _assert_can_sign(row)

    if not _declaration_format_ready():
        frappe.throw(
            f"The declaration form isn't set up for signatures yet. Ask the admin to update the "
            f"'{DECLARATION_FORMAT}' print format."
        )

    try:
        png = clean_signature_png(signature)
    except ValueError as exc:
        frappe.throw(str(exc))

    asset = frappe.get_doc(ASSET_MASTER_DOCTYPE, row.asset)
    asset.declaration = frappe._dict(
        signature=png_data_uri(png),
        signer_name=frappe.db.get_value("Nirmaan Users", frappe.session.user, "full_name") or frappe.session.user,
        signed_on=format_datetime(now_datetime(), "dd-MMM-yyyy hh:mm a"),
    )
    # Rendering ends the open transaction, so it runs before anything is written.
    pdf = _render_declaration_pdf(asset)

    row = frappe.get_doc(ASSET_MANAGEMENT_DOCTYPE, assignment, for_update=True)
    _assert_can_sign(row)

    row.set(DECLARATION_FIELD, _save_declaration_file(row, pdf))
    row.flags.e_signed = True  # the history row reads "Declaration Signed", not "Uploaded"
    row.save(ignore_permissions=True)
    frappe.db.commit()
    return {"file_url": row.get(DECLARATION_FIELD)}


def _assert_can_sign(row) -> None:
    current_assignee = frappe.db.get_value(ASSET_MASTER_DOCTYPE, row.asset, "current_assignee")
    refusal = sign_refusal(
        signer=frappe.session.user,
        assigned_to=row.asset_assigned_to,
        current_assignee=current_assignee,
        has_declaration=bool(row.get(DECLARATION_FIELD)),
    )
    if refusal:
        frappe.throw(
            REFUSAL_MESSAGES[refusal],
            frappe.PermissionError if refusal == NOT_ASSIGNEE else frappe.ValidationError,
        )


def _declaration_format_ready() -> bool:
    """True when the declaration print format places the signature (it reads `doc.declaration`)."""
    return PRINT_FORMAT_MARKER in (frappe.db.get_value("Print Format", DECLARATION_FORMAT, "html") or "")


def _render_declaration_pdf(asset) -> bytes:
    """Render the declaration with `asset.declaration` set; the print format places the signature from it."""
    return frappe.get_print(
        ASSET_MASTER_DOCTYPE, asset.name, DECLARATION_FORMAT, doc=asset, as_pdf=True, no_letterhead=1
    )


def _save_declaration_file(row, pdf: bytes) -> str:
    """Store the signed PDF as a private file on the assignment and return its URL.

    The cloud-storage hook uploads the file and commits inside `save_file`, so this runs after every check.
    The hook also rewrites `file_url`, so the URL is read back from the database.
    """
    file_doc = save_file(
        f"{row.asset}-declaration.pdf",
        pdf,
        ASSET_MANAGEMENT_DOCTYPE,
        row.name,
        df=DECLARATION_FIELD,
        is_private=1,
    )
    return frappe.db.get_value("File", file_doc.name, "file_url")

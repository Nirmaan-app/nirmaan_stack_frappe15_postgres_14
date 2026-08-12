import frappe

PARENT_DOCTYPE = "Project Progress Reports"


def relink_attachment_files(doc, method=None):
    """Adopt capture-time DPR photo Files into their parent report.

    DPR photos are uploaded by the camera (`CameraCapture.tsx`) BEFORE the report
    exists, so each `File` lands as an orphan — no `attached_to_doctype` /
    `attached_to_name` — and only its `file_url` is copied into the report's
    `attachments` child rows (`image_link`). Once the report is saved we finally
    know the owner, so stamp ownership onto every still-unlinked File here.

    Design notes:
    - Only UNLINKED files are claimed, so a photo reused by another report via
      the "Copy Report" feature stays attached to the report that first owned it
      (a File can belong to exactly one document in Frappe's model).
    - `frappe.db.set_value(..., update_modified=False)` writes the DB directly: it
      does NOT re-run File validation or the GCS `after_insert` upload hook, and
      leaves `file_url` / `content_hash` / the stored bytes untouched. It only
      repairs the ownership link.
    - No `frappe.db.commit()` here — this runs inside the report's save
      transaction and is committed with it.
    - Idempotent: files already linked to this report are skipped, so it is safe
      to run on every `on_update` (create and edit).
    """
    # Collect this report's photo urls once (deduped) — the work is bounded by
    # the number of photos on ONE report, and stays 2 queries no matter how many.
    seen = set()
    urls = []
    for row in (getattr(doc, "attachments", None) or []):
        url = (getattr(row, "image_link", None) or "").strip()
        if url and url not in seen:
            seen.add(url)
            urls.append(url)
    if not urls:
        return

    # One indexed lookup (file_url is indexed) for every photo at once.
    files = frappe.get_all(
        "File",
        filters={"file_url": ["in", urls]},
        fields=["name", "attached_to_doctype"],
    )
    # Only adopt still-unlinked Files, so a photo copied from an earlier report
    # stays owned by that report.
    orphan_names = [f.name for f in files if not (f.attached_to_doctype or "").strip()]
    if not orphan_names:
        return

    # One UPDATE for all of them. Raw SQL leaves `modified` (audit trail) and the
    # GCS fields untouched; the COALESCE guard keeps it a no-op for any File that
    # got owned in the meantime (belt-and-suspenders for the "no steal" rule).
    frappe.db.sql(
        """
        UPDATE "tabFile"
        SET attached_to_doctype = %(dt)s,
            attached_to_name    = %(dn)s
        WHERE name IN %(names)s
          AND COALESCE(attached_to_doctype, '') = ''
        """,
        {"dt": PARENT_DOCTYPE, "dn": doc.name, "names": tuple(orphan_names)},
    )

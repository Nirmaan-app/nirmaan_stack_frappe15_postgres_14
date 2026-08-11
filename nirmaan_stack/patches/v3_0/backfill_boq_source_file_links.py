import frappe


def execute():
    """
    Backfill File ownership for BoQ source workbooks (.xlsx / .xlsm).

    The BoQ upload endpoint saves the workbook via `save_file(dt=None, dn=None)`,
    so the File row lands orphaned — empty `attached_to_doctype` / `attached_to_name`.
    The file <-> BoQ relationship IS captured in `Nirmaan Attachments`
    (`associated_doctype='BOQs'`, `associated_docname=<boq>`, `attachment=file_url`),
    but the File itself has no owner, so it never appears in the BOQs attachment
    panel and is not cleaned up when the BoQ is deleted.

    This stamps `attached_to_doctype='BOQs'` / `attached_to_name=<boq>` onto each
    orphan source File, resolved through its `Nirmaan Attachments` record. It matches
    the app's house style (Vendor Invoices / POs / PRs all attach Files to their
    business doc, with Nirmaan Attachments as a parallel index).

    - Only UNLINKED files are claimed (`COALESCE(attached_to_doctype,'') = ''`); the
      parallel Nirmaan Attachments index is left untouched.
    - Attachment records with no `associated_docname` (the upload never produced a
      BOQs doc — parse-failed / abandoned) cannot be mapped and stay orphaned.

    Only the ownership columns are written; `file_url` / `content_hash` / the GCS
    bytes are untouched (safe alongside the S3->GCS migration). `modified` is left
    as-is (raw SQL) to preserve the audit trail. Idempotent — a re-run updates 0
    rows. PostgreSQL-only (UPDATE ... FROM).
    """
    before = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabFile" WHERE attached_to_doctype = 'BOQs'"""
    )[0][0]

    frappe.db.sql(
        """
        UPDATE "tabFile" f
        SET attached_to_doctype = 'BOQs',
            attached_to_name    = na.associated_docname
        FROM "tabNirmaan Attachments" na
        WHERE na.attachment = f.file_url
          AND na.associated_doctype = 'BOQs'
          AND COALESCE(na.associated_docname, '') <> ''
          AND COALESCE(f.attached_to_doctype, '') = ''
        """
    )

    frappe.db.commit()

    after = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabFile" WHERE attached_to_doctype = 'BOQs'"""
    )[0][0]

    remaining = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabFile"
           WHERE (file_name ILIKE %s OR file_name ILIKE %s)
             AND COALESCE(attached_to_doctype, '') = ''""",
        ("%.xlsx", "%.xlsm"),
    )[0][0]

    print(
        f"[backfill_boq_source_file_links] Files attached to 'BOQs': "
        f"{before} -> {after} (+{after - before}); "
        f"remaining orphan xlsx/xlsm (unmapped / no BOQs doc): {remaining}"
    )

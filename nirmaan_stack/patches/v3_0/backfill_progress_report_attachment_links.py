import frappe

PARENT_DOCTYPE = "Project Progress Reports"


def execute():
    """
    Backfill File ownership for DPR (Daily Progress Report) photos.

    Photos captured for `Project Progress Reports` were uploaded at capture time
    (before the report existed) targeting a non-existent child doctype with no
    docname, so every File landed as an orphan — no `attached_to_doctype` /
    `attached_to_name`. Only the `file_url` was copied into the report's
    `attachments` child rows (`image_link`), a one-way string pointer.

    This reconnects each orphan File to its parent report by matching
    `File.file_url == child.image_link`, so the File table knows the owner again
    (attachment panel, cascade-delete, and migration tooling all work once more).

    Rules:
    - Only UNLINKED files are claimed (`COALESCE(attached_to_doctype,'') = ''`),
      so already-linked files and every non-DPR file are never touched.
    - A photo reused across reports via "Copy Report" is attributed to the
      EARLIEST report (`DISTINCT ON (image_link) ... ORDER BY creation`), which is
      deterministic and stable across re-runs.
    - Photos that were captured but never saved into a report have no child row,
      so they stay orphaned — correct, they have no owner.

    Only the ownership columns are written; `file_url` / `content_hash` / the
    stored GCS bytes are untouched, so this is safe alongside the S3->GCS
    migration. `modified` is intentionally left as-is (raw SQL) to preserve the
    audit trail. Idempotent — a re-run updates 0 rows.

    PostgreSQL-only (DISTINCT ON, UPDATE ... FROM) — matches the app's DB.
    """
    before = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabFile" WHERE attached_to_doctype = %s""",
        (PARENT_DOCTYPE,),
    )[0][0]

    frappe.db.sql(
        """
        WITH mapping AS (
            SELECT DISTINCT ON (c.image_link)
                   c.image_link AS url,
                   c.parent     AS report
            FROM "tabProject Progress Report Attachments" c
            WHERE c.parenttype = %(parent)s
              AND c.image_link IS NOT NULL
              AND c.image_link <> ''
            ORDER BY c.image_link, c.creation ASC, c.parent ASC
        )
        UPDATE "tabFile" f
        SET attached_to_doctype = %(parent)s,
            attached_to_name    = m.report
        FROM mapping m
        WHERE f.file_url = m.url
          AND COALESCE(f.attached_to_doctype, '') = ''
        """,
        {"parent": PARENT_DOCTYPE},
    )

    frappe.db.commit()

    after = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabFile" WHERE attached_to_doctype = %s""",
        (PARENT_DOCTYPE,),
    )[0][0]

    remaining_orphans = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabFile"
           WHERE file_name LIKE %s AND COALESCE(attached_to_doctype, '') = ''""",
        ("photo\\_%.jpeg",),
    )[0][0]

    print(
        f"[backfill_progress_report_attachment_links] "
        f"Files attached to '{PARENT_DOCTYPE}': {before} -> {after} (+{after - before}); "
        f"remaining unlinked photo_*.jpeg files (abandoned captures): {remaining_orphans}"
    )

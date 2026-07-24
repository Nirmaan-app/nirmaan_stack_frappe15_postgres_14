# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Daily janitor for orphaned BoQ workbooks in private/files (Leak B).

Each BoQ upload calls `save_file(..., is_private=1)`, which writes the workbook
to `private/files/`. Cleanup is owned by `frappe_s3_attachment`'s File
`after_insert` hook: upload to S3 -> rewrite `file_url` -> `os.remove()` the
local copy. That handoff is neither atomic nor filename-safe — when Frappe's
collision suffix (`generate_hash(length=6)`) makes the physical filename diverge
from `doc.file_url`, the `os.remove` misses and the local bytes are stranded
with NO owning File doc.

That last part is why this MUST be a filesystem sweep: the orphans are invisible
to any File-doc query. Instead we walk the directory and delete only what no
live document still points at.

Safety posture (deletion is irreversible):
  * Extension allowlist — only BoQ workbook types are ever considered.
  * 24 h grace, matching cleanup_orphan_commission_attachments.
  * The keep-set is built from EVERY Attach / Attach Image field in the schema
    plus the two Data-ish URL fields BoQ uses, not just a hardcoded few.
  * If the keep-set cannot be built completely, the sweep ABORTS rather than
    deleting against a partial picture (fail-safe, see _referenced_local_basenames).
  * `dry_run=True` logs what it would remove and touches nothing.
"""

import os
import time
from urllib.parse import unquote

import frappe

from nirmaan_stack.tasks.janitor_log import janitor_log

KEEP_EXT = {".xlsx", ".xlsm"}
GRACE_HOURS = 24
GRACE_SEC = GRACE_HOURS * 3600
LOCAL_PREFIX = "/private/files/"

# Fields holding a private-file URL that are NOT of fieldtype Attach, so the
# generic schema scan below cannot discover them.
EXTRA_URL_FIELDS = (
    ("BOQs", "source_file_url"),
)


def _basename_of(url: str) -> str:
    """Disk names contain spaces / URL-encoded chars — normalise before comparing."""
    return os.path.basename(unquote(url or "").split("?")[0])


def _attach_field_columns() -> list:
    """Every (doctype, fieldname) in the schema that can hold a file URL."""
    columns = []
    for table in ("tabDocField", "tabCustom Field"):
        parent_col = "parent" if table == "tabDocField" else "dt"
        rows = frappe.db.sql(
            f"""SELECT "{parent_col}", fieldname FROM "{table}"
                WHERE fieldtype IN ('Attach', 'Attach Image')""",
        )
        columns.extend((r[0], r[1]) for r in rows if r[0] and r[1])
    columns.extend(EXTRA_URL_FIELDS)
    return columns


def _referenced_local_basenames() -> set:
    """Basenames of private files still pointed at by a live document.

    Raises on any unexpected failure — the caller treats that as "do not delete".
    """
    referenced = set()

    # 1. The File doctype itself — the primary owner of every uploaded file.
    for (url,) in frappe.db.sql(
        """SELECT file_url FROM "tabFile" WHERE file_url LIKE %s""",
        (LOCAL_PREFIX + "%",),
    ):
        if url:
            referenced.add(_basename_of(url))

    # 2. Every attach-ish column in the schema, in case a doc outlived its File row.
    for doctype, fieldname in _attach_field_columns():
        try:
            if not frappe.db.table_exists(doctype):
                continue
            rows = frappe.db.sql(
                f'''SELECT "{fieldname}" FROM "tab{doctype}"
                    WHERE "{fieldname}" LIKE %s''',
                (LOCAL_PREFIX + "%",),
            )
        except Exception:
            # Column dropped, single doctype, or otherwise not queryable. A field
            # we cannot read is a field we cannot vouch for -> refuse to sweep.
            frappe.db.rollback()
            raise
        for (url,) in rows:
            if url:
                referenced.add(_basename_of(url))

    return referenced


def cleanup_orphan_private_files(dry_run=False):
    """Daily cron entry point. Wired in hooks.py scheduler_events.daily.

    Run manually first:
      bench --site <site> execute \
        nirmaan_stack.tasks.cleanup_orphan_private_files.cleanup_orphan_private_files \
        --kwargs "{'dry_run': True}"
    """
    if isinstance(dry_run, str):
        dry_run = dry_run.strip().lower() not in ("", "0", "false", "no")

    private_dir = frappe.utils.get_site_path("private", "files")
    if not os.path.isdir(private_dir):
        return

    try:
        referenced = _referenced_local_basenames()
    except Exception:
        frappe.log_error(
            title="[private janitor] aborted — could not build keep-set",
            message=frappe.get_traceback(),
        )
        return

    cutoff = time.time() - GRACE_SEC
    removed = 0
    freed = 0

    for fname in sorted(os.listdir(private_dir)):
        if os.path.splitext(fname)[1].lower() not in KEEP_EXT:
            continue
        if fname in referenced:
            continue
        path = os.path.join(private_dir, fname)
        try:
            if not os.path.isfile(path) or os.path.getmtime(path) >= cutoff:
                continue
            size = os.path.getsize(path)
            if dry_run:
                janitor_log(f"[private] WOULD remove {fname} ({size / 1048576:.1f} MB)")
            else:
                os.remove(path)
            removed += 1
            freed += size
        except OSError:
            continue

    janitor_log(
        f"[private] {'would remove' if dry_run else 'removed'} {removed} "
        f"orphan workbooks, {freed / 1048576:.1f} MB "
        f"(keep-set: {len(referenced)} referenced names)"
    )
    return {"removed": removed, "mb": round(freed / 1048576, 1), "referenced": len(referenced)}

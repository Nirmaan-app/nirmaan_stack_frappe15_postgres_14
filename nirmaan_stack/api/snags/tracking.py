"""Snag tracking endpoints -- status (+ its remark), manual entry, batch delete, stats.

Wire contract: `frontend/src/pages/SnagList/types.ts`.
Storage decision + delete consequences: `docs/adr/0017-snag-rows-are-standalone-documents.md`.

STATUS ATTRIBUTION IS NOT SET HERE. `status_changed_by` / `status_changed_on` are stamped by
`integrations/controllers/project_snag.before_save`, which is the single owner -- a second
stamping site in this module would be free to drift from it. That is also why every write
below goes through the DOCUMENT LAYER (`frappe.get_doc` + `doc.save`): `frappe.db.set_value`
and raw SQL bypass `doc_events` entirely, so the stamp would never fire and the attribution
would read as authoritative while being quietly stale (root CLAUDE.md, Coding Conventions).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.snags import (
    require_bulk_access,
    require_import_access,
    require_read_access,
    require_status_access,
)

#: Display order, matching SNAG_STATUSES in types.ts.
SNAG_STATUSES = ("Pending", "WIP", "Completed", "Not Applicable")

#: The one status that takes NO remark (owner decision Q2a, plan Revision 2). The UI shows
#: no remark box for it; this is the half a client cannot skip.
NO_REMARK_STATUS = "Not Applicable"


def _assert_status(status):
    if status not in SNAG_STATUSES:
        frappe.throw(
            f"'{status}' is not a Snag status. Expected one of: {', '.join(SNAG_STATUSES)}.",
            title="Unknown status",
        )


def _snag_status_payload(doc):
    return {
        "name": doc.name,
        "status": doc.status,
        "remark": doc.remark,
        "status_changed_by": doc.status_changed_by,
        "status_changed_on": doc.status_changed_on,
    }


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def update_snag_status(snag=None, status=None, remark=None):
    """Move ONE snag to `status`, optionally rewriting its `remark` in the same save.

    Admin / Project Lead / PMO / Project Manager.

    `remark` HAS THREE STATES AND THEY ARE NOT TWO (ADR-0018):
      - `None`  -- not supplied. The stored remark is left exactly as it is.
      - `""`    -- an explicit CLEAR. The stored remark is emptied.
      - text    -- an OVERWRITE. The imported text is destroyed; the source workbook on
                   the batch is the surviving copy.
    Collapsing None into "" would silently wipe the imported remark on every status change
    made by a client that does not send the field.

    `Not Applicable` takes NO remark (owner decision Q2a). The UI shows no remark box for
    it, but a client is not the boundary: a remark sent WITH that status is refused here.
    An empty string is refused too -- it is a CLEAR, which is still a remark write, and
    accepting it would let a client that always sends the field destroy the imported text
    on its way past a rule meant to leave it alone.

    Both fields are set before the SINGLE `doc.save()`, so the write stays one atomic
    transaction and the `before_save` controller sees one status transition, not two saves.
    """
    if not snag:
        frappe.throw("snag is required.", title="Missing field: snag")
    _assert_status(status)
    if status == NO_REMARK_STATUS and remark is not None:
        frappe.throw(
            f"A snag marked '{NO_REMARK_STATUS}' takes no remark. Send the status on its own, "
            f"or choose another status if you need to record a note.",
            title="No remark on Not Applicable",
        )
    require_status_access("change a snag's status")

    doc = frappe.get_doc("Project Snag", snag)
    doc.status = status
    if remark is not None:
        doc.remark = remark
    # Document layer, so the before_save controller stamps the attribution.
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return _snag_status_payload(doc)


@frappe.whitelist(methods=["POST"])
def bulk_update_snag_status(snags=None, status=None):
    """Move MANY snags to `status`. ADMIN ONLY (mirrors Design Tracker's bulk update).

    NO `remark` PARAMETER, DELIBERATELY (owner decision Q12a): the selected snags each
    carry their own remark, and one sentence applied across N rows would overwrite all of
    them with a note written about none of them. A remark belongs to the row it describes,
    so it rides the SINGLE-row endpoint only. Do not add it here for symmetry.

    One `doc.save()` per snag rather than a single bulk UPDATE: a bulk DB write bypasses
    `doc_events`, so the status-change attribution would never be stamped.
    """
    _assert_status(status)
    require_bulk_access("bulk-update snag statuses")

    names = frappe.parse_json(snags) if isinstance(snags, str) else snags
    names = names or []
    if not names:
        frappe.throw("No snags selected.", title="Nothing to update")

    updated = 0
    for name in names:
        doc = frappe.get_doc("Project Snag", name)
        doc.status = status
        doc.save(ignore_permissions=True)
        updated += 1

    frappe.db.commit()
    return {"updated": updated, "status": status}


# ---------------------------------------------------------------------------
# Manual entry
# ---------------------------------------------------------------------------
#
# There is NO standalone remark endpoint. `update_snag_comments` was deleted with the
# `comments` field (ADR-0018): a remark is now written as part of a status change, by
# `update_snag_status` above. If a standalone remark edit is ever wanted, note that it
# would be the only write path on this doctype that does not touch `status` -- and that
# `status_changed_by` / `status_changed_on` would then stop coinciding with the last edit,
# which is exactly the reading ADR-0018 warns not to relabel.


@frappe.whitelist(methods=["POST"])
def add_manual_snag(project=None, area=None, category=None, description=None):
    """Create one snag by hand -- no batch. Admin / Project Lead / PMO."""
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")
    if not (description or "").strip():
        frappe.throw("A description is required.", title="Missing field: description")
    require_import_access("add a snag")

    doc = frappe.get_doc(
        {
            "doctype": "Project Snag",
            "project": project,
            # A Manual Snag has no batch -- that absence is how the UI tells the two apart.
            "batch": None,
            "area": (area or "").strip(),
            "category": (category or "").strip(),
            "description": description.strip(),
            "status": "Pending",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "status": doc.status}


# ---------------------------------------------------------------------------
# Batch delete
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_batch_delete_preview(batch=None):
    """DeleteBatchPreview -- the counts the confirm dialog puts on screen before the click.

    There is NO guard on worked snags (owner decision, ADR-0017 Consequences): `worked_count`
    is shown, not enforced.
    """
    if not batch:
        frappe.throw("batch is required.", title="Missing field: batch")
    require_import_access("delete a snag batch")

    batch_name = frappe.db.get_value("Project Snag Batch", batch, "batch_name")
    if batch_name is None:
        frappe.throw(f"Snag batch '{batch}' not found.", title="Not found")

    snag_count = frappe.db.count("Project Snag", {"batch": batch})
    worked_count = frappe.db.count("Project Snag", {"batch": batch, "status": ("!=", "Pending")})

    return {
        "batch": batch,
        "batch_name": batch_name,
        "snag_count": snag_count,
        "worked_count": worked_count,
    }


@frappe.whitelist(methods=["POST"])
def delete_batch(batch=None):
    """Delete a batch and every snag in it, THROUGH THE DOCUMENT LAYER.

    Deletion is UNGUARDED by design (ADR-0017 Consequences) -- an admin may delete a batch
    whose team has been closing snags for a month. The confirm dialog shows the counts;
    nothing blocks the click.
    """
    if not batch:
        frappe.throw("batch is required.", title="Missing field: batch")
    require_import_access("delete a snag batch")

    if not frappe.db.exists("Project Snag Batch", batch):
        frappe.throw(f"Snag batch '{batch}' not found.", title="Not found")

    names = frappe.get_all(
        "Project Snag",
        filters={"batch": batch},
        pluck="name",
        limit_page_length=0,
    )

    for name in names:
        # ONE frappe.delete_doc PER SNAG, never a bulk DB write and never raw SQL:
        # frappe.delete_doc writes a `Deleted Document` row holding the full JSON of the
        # snag, and ADR-0017 names that row as the ONLY recovery path for this feature.
        # Raw deletion skips it and destroys the snag irrecoverably.
        frappe.delete_doc("Project Snag", name, ignore_permissions=True)

    frappe.delete_doc("Project Snag Batch", batch, ignore_permissions=True)
    frappe.db.commit()

    return {"batch": batch, "deleted_snags": len(names)}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_snag_stats(project=None):
    """SnagStatsSummary for the tab's stats strip.

    A count over many rows is the DATABASE's job (ADR-0010) -- one GROUP BY, never a
    get_doc / row loop in Python. Every status is seeded to 0 so the response is a total
    map over SnagStatus, as `Record<SnagStatus, number>` in types.ts requires.

    READ-GUARDED. It shipped with no guard at all, which made a project's defect counts
    readable by any logged-in session, Accountant included -- the one role the tab is
    hidden from. The tier is wider than write on purpose (plan section 6).
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    require_read_access("view this project's snag list")

    rows = frappe.get_all(
        "Project Snag",
        filters={"project": project},
        fields=["status", "count(name) as cnt"],
        group_by="status",
        limit_page_length=0,
    )

    by_status = {status: 0 for status in SNAG_STATUSES}
    total = 0
    for row in rows:
        count = int(row.get("cnt") or 0)
        total += count
        if row.get("status") in by_status:
            by_status[row["status"]] = count

    return {"total": total, "by_status": by_status}

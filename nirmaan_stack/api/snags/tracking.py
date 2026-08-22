"""Snag tracking endpoints -- status (+ its remark), manual entry, detail edit, batch
delete, stats, field-value suggestions.

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
    require_row_edit_access,
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


#: The three DATA fields a human may write after creation. Owned jointly by
#: `add_manual_snag` (create) and `update_snag_details` (edit) -- and by nothing else.
#: `status` and `remark` are NOT here: they are owned by `update_snag_status` (ADR-0018).
#: `batch` / `source_row` / `project` are NOT here either: provenance answers "where did
#: this come from", which an editable answer would make worthless.
DETAIL_FIELDS = ("area", "category", "description")


def _normalized_details(area, category, description):
    """Strip all three detail fields. ONE definition, shared by create and edit.

    Extracted from `add_manual_snag` rather than copied into the editor: two copies of a
    normalisation rule drift, and the drift presents as a value that matches the dropdown
    suggestions on one screen and not the other (`get_snag_field_values` groups on the
    STORED text, so an unstripped " Kitchen" would list separately from "Kitchen").

    ⚠️ `description` MAY be blank (ADR-0019). Do not re-add a required check here -- the
    doctype dropped `reqd` for exactly this, and a ticked import row with no text anywhere
    lands blank on purpose.
    """
    return {
        "area": (area or "").strip(),
        "category": (category or "").strip(),
        "description": (description or "").strip(),
    }


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
# `update_snag_status` above. Do not add one back.
#
# `update_snag_details` (below, Revision 3) IS a write path that does not touch `status`,
# and it is the reason the caveat above matters: `status_changed_by` / `status_changed_on`
# no longer coincide with the LAST edit, only with the last STATUS change. That is exactly
# what they claim to mean, and exactly the reading ADR-0018 warns not to relabel -- which
# is why a remark is still not editable there.


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
            "status": "Pending",
            # SHARED normalisation with `update_snag_details` -- see `_normalized_details`.
            # (A HAND-TYPED snag still needs its own text: the blank ADR-0019 allows is the
            # honest reading of a workbook row, not a blank someone typed into a form.)
            **_normalized_details(area, category, description),
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "status": doc.status}


# ---------------------------------------------------------------------------
# Detail edit
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def update_snag_details(snag=None, area=None, category=None, description=None):
    """Rewrite ONE snag's area / category / description. Admin / Project Lead / PMO.

    THE FIRST POST-CREATE WRITE PATH FOR THIS DOCTYPE'S DATA FIELDS. Until now the three
    were CREATE-ONLY (`add_manual_snag` / the importer) and a typo could not be corrected.

    WHAT IT DELIBERATELY CANNOT TOUCH, and why each one is out:
      - `status` / `remark` -- owned by `update_snag_status` (ADR-0018). A remark is written
        as part of a status change; a second writer would un-couple the attribution from it.
      - `batch` / `source_row` / `project` -- provenance. It answers "where did this come
        from", and an editable answer is worth nothing.

    PROJECT MANAGER IS EXCLUDED (owner decision Q8a): they may move a snag's status, but
    editing a description rewrites what the consultant reported. Hence `require_row_edit_access`
    and not `require_status_access` -- and hence its own named tier, not an alias of
    `require_import_access` (see `ROW_EDIT_ROLES`).

    DOCUMENT LAYER, never `frappe.db.set_value` or raw SQL: those bypass `doc_events`, so
    `track_changes` would record nothing and the edit would be invisible in the Version log.
    The `before_save` stamp correctly does NOT move here -- `status` is unchanged, so
    `status_changed_by` / `status_changed_on` keep pointing at the last STATUS change, which
    is what they claim to mean.

    `description` MAY be blank (ADR-0019).
    """
    if not snag:
        frappe.throw("snag is required.", title="Missing field: snag")
    require_row_edit_access("edit a snag's details")

    if not frappe.db.exists("Project Snag", snag):
        frappe.throw(f"Snag '{snag}' not found.", title="Not found")

    details = _normalized_details(area, category, description)
    doc = frappe.get_doc("Project Snag", snag)
    for field in DETAIL_FIELDS:
        setattr(doc, field, details[field])
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "name": doc.name,
        "area": doc.area,
        "category": doc.category,
        "description": doc.description,
    }


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


# ---------------------------------------------------------------------------
# Field-value suggestions
# ---------------------------------------------------------------------------


def _distinct_field_values(project, field):
    """One GROUP BY over `field` for this project, most-used first, BLANKS EXCLUDED.

    A distinct-values list over many rows is the DATABASE's job (root CLAUDE.md / ADR-0010)
    -- one GROUP BY per field, never a `get_all` of every snag and a Python set.

    ⚠️ THE BLANK FILTER IS LOAD-BEARING. `add_manual_snag` and the importer both write `""`
    for an unmapped area/category, never NULL, so a naive DISTINCT yields an EMPTY-STRING
    entry -- which renders as a blank, unpickable line in the suggestions list. `is set`
    excludes NULL and `""` together, so it stays correct whichever a future writer stores.
    """
    rows = frappe.get_all(
        "Project Snag",
        filters=[
            ["project", "=", project],
            [field, "is", "set"],
        ],
        fields=[field, "count(name) as cnt"],
        group_by=field,
        order_by="cnt desc",
        limit_page_length=0,
    )
    return [row[field] for row in rows if (row.get(field) or "").strip()]


@frappe.whitelist()
def get_snag_field_values(project=None):
    """SnagFieldValuesResponse -- distinct non-blank areas + categories, most-used first.

    Feeds the Edit dialog's `<datalist>` SUGGESTIONS. The fields stay FREE TEXT (ADR-0016
    amendment), so a value absent from these lists is still typeable -- this list shortens
    typing and surfaces the project's existing vocabulary, it does not constrain the field.

    READ-guarded, the same tier as `get_snag_stats`.

    ⚠️ DO NOT reroute this through `api/data_table/facets.get_facet_values`. It does the
    right GROUP BY, but it guards on the DOCTYPE PERMISSION TABLE rather than this feature's
    deny-list read tier -- so a role with snag-tab access but no `Project Snag` read row
    would get an empty dropdown, silently, and read it as "this project has no areas yet".
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    require_read_access("view this project's snag list")

    return {
        "areas": _distinct_field_values(project, "area"),
        "categories": _distinct_field_values(project, "category"),
    }

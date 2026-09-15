"""Snag tracking endpoints -- status (+ its remark), manual entry, detail edit, batch
rename + delete, stats, field-value suggestions.

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

#: The `by_batch` key a MANUALLY ADDED snag (one with no batch) is counted under.
#: An EMPTY STRING, never None: `by_batch` is a JSON object on the wire and `null` is
#: not a key there. It also folds NULL and "" together, so it stays correct whichever
#: the database holds for an unset Link (`add_manual_snag` writes None; Frappe is free
#: to store either).
MANUAL_BATCH_KEY = ""


def _assert_status(status):
    if status not in SNAG_STATUSES:
        frappe.throw(
            f"'{status}' is not a Snag status. Expected one of: {', '.join(SNAG_STATUSES)}.",
            title="Unknown status",
        )


#: The three ALWAYS-OVERWRITTEN data fields a human may write after creation. Owned jointly
#: by `add_manual_snag` (create) and `update_snag_details` (edit) -- and by nothing else.
#: `remark` is ALSO editable by `update_snag_details` (owner 2026-09-04) but is NOT in this
#: tuple, and must not be added to it: these three are a blind overwrite, while a remark has
#: THREE states (leave / clear / overwrite) and a `Not Applicable` carve-out. Folding it in
#: would turn "not supplied" into a wipe of the imported text.
#: `status` is NOT here: `update_snag_status` owns it, because that is what stamps the
#: attribution. `batch` / `source_row` / `project` are NOT here either: provenance answers
#: "where did this come from", which an editable answer would make worthless.
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
# There is STILL no standalone remark endpoint, and there must not be one: `update_snag_comments`
# was deleted with the `comments` field (ADR-0018). A remark rides one of the TWO existing
# writers -- `update_snag_status` above, or `update_snag_details` below (owner 2026-09-04, which
# REVERSED "a remark is only ever written as part of a status change"). Both share one set of
# three states and one `Not Applicable` carve-out; a third writer is what would let them drift.
#
# `update_snag_details` does not touch `status`, and that is the caveat to keep in view:
# `status_changed_by` / `status_changed_on` do not coincide with the LAST edit, only with the
# last STATUS change. That is exactly what they claim to mean, and exactly the reading ADR-0018
# warns not to relabel -- so a remark saved from the edit dialog is unattributed on the row, and
# the Version log is where its author lives.


@frappe.whitelist(methods=["POST"])
def add_manual_snag(project=None, area=None, category=None, description=None, batch=None):
    """Create one snag by hand. Admin / Project Lead / PMO.

    `batch` IS OPTIONAL AND IS THE TAB THE USER WAS ON (owner decision 2026-09-09,
    NARROWING "a manually added snag belongs to no batch"). Adding a snag while a batch
    tab is open now files it INTO that import, which is what the screen implies: the row
    appears in the list the user is looking at instead of vanishing into "All".

    Omitted (the "Added manually" tab, or any caller that does not send it) the snag
    still has NO batch, and that path is unchanged.

    ⚠️ TWO CONSEQUENCES OF FILING A HAND-TYPED SNAG INTO A BATCH, both accepted:
      - `delete_batch` sweeps every snag with that batch, so a snag added this way CAN
        be deleted with the import -- unlike a batch-less one, which nothing deletes.
      - The batch's `source_file` no longer accounts for every row in it. `source_row`
        stays 0, which is what still tells an imported row from a typed one -- the S.No
        no longer does, because a blank one read as broken beside numbered neighbours.
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")
    if not (description or "").strip():
        frappe.throw("A description is required.", title="Missing field: description")
    require_import_access("add a snag")

    batch = (batch or "").strip() or None
    if batch:
        # The batch must belong to THIS project. Without the check a client could file a
        # snag into another project's import, and nothing downstream would ever notice:
        # the snag's own `project` would still read correctly while its batch pointed
        # somewhere else entirely.
        batch_project = frappe.db.get_value("Project Snag Batch", batch, "project")
        if batch_project is None:
            frappe.throw(f"Snag batch '{batch}' not found.", title="Not found")
        if batch_project != project:
            frappe.throw(
                f"Snag batch '{batch}' belongs to a different project.",
                title="Wrong project",
            )

    doc = frappe.get_doc(
        {
            "doctype": "Project Snag",
            "project": project,
            # The tab the user was on, or None on the manual tab.
            "batch": batch,
            # The next free number in the list it joins -- never blank. See
            # `_next_manual_serial`.
            "source_serial": _next_manual_serial(project, batch),
            "status": "Pending",
            # SHARED normalisation with `update_snag_details` -- see `_normalized_details`.
            # (A HAND-TYPED snag still needs its own text: the blank ADR-0019 allows is the
            # honest reading of a workbook row, not a blank someone typed into a form.)
            **_normalized_details(area, category, description),
        }
    )
    doc.insert(ignore_permissions=True)

    if batch:
        _refresh_batch_snag_count(batch)

    frappe.db.commit()

    return {
        "name": doc.name,
        "status": doc.status,
        "batch": doc.batch,
        "source_serial": doc.source_serial,
    }


def _next_manual_serial(project, batch):
    """The S.No a hand-added snag takes: the next free number in the list it joins.

    A manual snag used to land with a BLANK S.No, which was survivable only while such
    snags had no batch and sat alone. Now that one joins the batch the user is looking
    at, the blank sits in a column where every neighbouring row is numbered -- so the
    row reads as broken rather than as hand-added.

    SCOPE IS THE LIST IT JOINS, matching `import_wizard._serials_for`: a serial is a
    POSITION within its batch, so the count runs over that batch -- or, on the manual
    tab, over the project's batch-less snags.

    ⚠️ `source_serial` is DATA, not Int, and deliberately so: a consultant numbering
    `1.1` or `A-3` keeps it. So the highest INTEGER is what advances, and a scope whose
    numbering is entirely non-numeric falls back to its row count. Both are floored by
    the row count, so the answer can never be lower than the rows already present.

    NOT unique-checked, for the same reason the importer does not check: a real sheet
    restarts its numbering per section, so duplicates are the consultant's data.
    """
    if batch:
        serials = frappe.get_all(
            "Project Snag", filters={"batch": batch}, pluck="source_serial",
            limit_page_length=0,
        )
    else:
        serials = frappe.get_all(
            "Project Snag",
            filters=[["project", "=", project], ["batch", "is", "not set"]],
            pluck="source_serial",
            limit_page_length=0,
        )

    highest = 0
    for value in serials:
        text = (value or "").strip()
        if text.isdigit():
            highest = max(highest, int(text))

    return str(max(highest, len(serials)) + 1)


def _refresh_batch_snag_count(batch):
    """Re-derive `Project Snag Batch.snag_count` from the rows that carry the batch.

    RECOMPUTED FROM SOURCE, never incremented by a delta (root CLAUDE.md): any later
    ordinary save then repairs it exactly, and a reconcile pass can always prove it.
    It stopped being "how many rows this import brought in" the moment a snag could be
    added to a batch by hand -- Import History reads it as the batch's SIZE, so a count
    that ignored hand-added rows would disagree with the tab count beside it.

    `set_value` with `update_modified=False`: this is a derived counter, and touching
    `modified` would make every hand-added snag look like someone edited the import.
    """
    frappe.db.set_value(
        "Project Snag Batch",
        batch,
        "snag_count",
        frappe.db.count("Project Snag", {"batch": batch}),
        update_modified=False,
    )


# ---------------------------------------------------------------------------
# Detail edit
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def update_snag_details(
    snag=None, area=None, category=None, description=None, remark=None, source_serial=None
):
    """Rewrite ONE snag's area / category / description / remark / S.No. Admin / PL / PMO.

    THE FIRST POST-CREATE WRITE PATH FOR THIS DOCTYPE'S DATA FIELDS. Until now the three
    were CREATE-ONLY (`add_manual_snag` / the importer) and a typo could not be corrected.

    `remark` IS EDITABLE HERE (owner decision 2026-09-04), REVERSING the original "a remark is
    only ever written as part of a status change" (ADR-0018). It keeps the SAME THREE STATES as
    `update_snag_status`, and they are not two:
      - `None`  -- not supplied. The stored remark is left exactly as it is.
      - `""`    -- an explicit CLEAR.
      - text    -- an OVERWRITE. The imported text is destroyed; the source workbook on the
                   batch is the surviving copy.
    Collapsing `None` into `""` would wipe the imported remark on every area/category typo fix
    made by a client that does not send the field.

    ⚠️ `Not Applicable` STILL TAKES NO REMARK (owner decision Q2a) -- the rule is one rule, not
    one per write path, so it is enforced here too, against the snag's STORED status (this
    endpoint never moves the status). Without it the carve-out would hold on one screen and not
    the other, and a snag could end up marked Not Applicable WITH a remark.

    ⚠️ ATTRIBUTION IS UNCHANGED AND THAT IS CORRECT: `status_changed_by` / `status_changed_on`
    answer "who last MOVED this snag", so a remark edited here does not touch them (the
    `before_save` controller stamps on a status transition only, and already anticipates a bare
    remark edit). A remark written from this dialog is therefore NOT attributed to its author --
    the Version log is where that lives.

    `source_serial` (the S.No) IS EDITABLE HERE (owner decision 2026-09-05), with the SAME
    THREE STATES as `remark` and for the same reason -- a client that does not send the field
    must not blank it. It is the ONE provenance-shaped field that is editable, and the line is
    not arbitrary: the S.No is a LABEL people quote back to a consultant, so a mis-read cell,
    or a row the import numbered by POSITION because the sheet left it blank, has to be
    correctable by hand. The three below answer a different question and stay shut.

    It is STRIPPED, unlike `remark`: the import strips it too (`import_wizard._serials_for`),
    so a serial typed here and one read off a sheet are stored the same way. It is NOT checked
    for uniqueness -- a real sheet's numbering restarts per section, so duplicates inside one
    project are the consultant's data, not an error to refuse.

    WHAT IT STILL DELIBERATELY CANNOT TOUCH:
      - `status` -- owned by `update_snag_status` (ADR-0018), which is what stamps the
        attribution. Two writers on one field is how the stamp starts lying.
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

    All four fields are set before the SINGLE `doc.save()`, so one edit stays one transaction
    and one Version row.

    `description` MAY be blank (ADR-0019).
    """
    if not snag:
        frappe.throw("snag is required.", title="Missing field: snag")
    require_row_edit_access("edit a snag's details")

    if not frappe.db.exists("Project Snag", snag):
        frappe.throw(f"Snag '{snag}' not found.", title="Not found")

    details = _normalized_details(area, category, description)
    doc = frappe.get_doc("Project Snag", snag)

    # The carve-out is checked against the STORED status: this endpoint cannot move it, so
    # the status the snag has now is the status the remark would land beside. An empty string
    # is refused too -- it is a CLEAR, which is still a remark write.
    if remark is not None and doc.status == NO_REMARK_STATUS:
        frappe.throw(
            f"A snag marked '{NO_REMARK_STATUS}' takes no remark. Change its status first if "
            f"you need to record a note.",
            title="No remark on Not Applicable",
        )

    for field in DETAIL_FIELDS:
        setattr(doc, field, details[field])
    # NOT stripped, exactly as `update_snag_status` leaves it: one remark-write rule, so the
    # same text saved from either dialog is stored the same way.
    if remark is not None:
        doc.remark = remark
    # `read_only` on the doctype is a DESK form flag, not a write guard -- this is the one
    # editor for the field, and it goes through the document layer like every other edit here.
    if source_serial is not None:
        doc.source_serial = (source_serial or "").strip()
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "name": doc.name,
        "area": doc.area,
        "category": doc.category,
        "description": doc.description,
        "remark": doc.remark,
        "source_serial": doc.source_serial,
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
# Batch rename
# ---------------------------------------------------------------------------

#: `Project Snag Batch.batch_name` is a Data field -- varchar(140). Checked here so an
#: over-long name gets a sentence, not Frappe's CharacterLengthExceededError.
BATCH_NAME_MAX_LEN = 140


def _batch_name_key(name):
    """How two batch names are compared for "the same name": case and spacing ignored.

    "Block A", "block a" and " Block  A " read as the same tab, so they count as one name.
    Mirrored by `batchNameKey` in `RenameBatchDialog.tsx`, which only lets the dialog warn
    while typing -- this is the boundary.
    """
    return " ".join((name or "").split()).casefold()


@frappe.whitelist(methods=["POST"])
def rename_batch(batch=None, batch_name=None):
    """Rename a batch -- the label its tab, Import History, the Edit dialog's provenance
    line and the PDF's "File" list all show. Admin / Project Lead / PMO.

    The label starts life as the uploaded file's name (`import_wizard._default_batch_name`),
    which is routinely something like `VRB_Food Box_Snag_List_04.09.2026be17ff (1)`, so it
    has to be correctable after the fact.

    ONLY `batch_name` MOVES, and nothing downstream needs rewriting: every snag links to
    the batch by its document `name` (`SNAGB-...`), never by this label, and every surface
    that shows the label reads it live. `source_file` is untouched, so the original workbook
    stays downloadable under its own file name -- a rename loses no provenance.

    Same tier as `delete_batch`: renaming is managing the batch.

    THE NAME MUST BE UNIQUE WITHIN THE PROJECT (compared by `_batch_name_key`, so case and
    spacing do not make a different name): two tabs reading the same could only be told
    apart by position. A batch in ANOTHER project may share it. Import does NOT apply this
    rule -- uploading one file twice still lands as two same-named tabs, and renaming one
    of them is how they are told apart.

    DOCUMENT LAYER (`doc.save`), not `frappe.db.set_value`, so `track_changes` records the
    old and new name in the Version log.
    """
    if not batch:
        frappe.throw("batch is required.", title="Missing field: batch")
    require_import_access("rename a snag batch")

    label = (batch_name or "").strip()
    if not label:
        frappe.throw("A batch name is required.", title="Missing field: batch_name")
    if len(label) > BATCH_NAME_MAX_LEN:
        frappe.throw(
            f"A batch name can be at most {BATCH_NAME_MAX_LEN} characters.",
            title="Batch name too long",
        )
    project = frappe.db.get_value("Project Snag Batch", batch, "project")
    if project is None:
        frappe.throw(f"Snag batch '{batch}' not found.", title="Not found")

    # A project holds a handful of batches, so its names are compared here in Python --
    # one key function for both sides, rather than re-expressing it in SQL.
    other_names = frappe.get_all(
        "Project Snag Batch",
        filters={"project": project, "name": ("!=", batch)},
        pluck="batch_name",
        limit_page_length=0,
    )
    key = _batch_name_key(label)
    if any(_batch_name_key(other) == key for other in other_names):
        frappe.throw(
            f"Another batch in this project is already called “{label}”. Choose a different name.",
            title="Name already used",
        )

    doc = frappe.get_doc("Project Snag Batch", batch)
    doc.batch_name = label
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"batch": doc.name, "batch_name": doc.batch_name}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_snag_stats(project=None):
    """SnagStatsSummary for the tab's stats strip AND the batch tab strip's counts.

    A count over many rows is the DATABASE's job (ADR-0010) -- ONE GROUP BY, never a
    get_doc / row loop in Python. It groups by `batch, status` rather than `status`
    alone, which is what lets a project with N batches render its tab strip, its
    per-batch counts and its per-batch stats strip from a SINGLE call. The frontend
    slices `by_batch`; it never asks per batch (that would be N round trips on a
    screen that already has the whole grid in hand).

    ⚠️ `by_status` NOW ACCUMULATES (`+=`), and that is load-bearing. With the batch
    dimension added there is one row PER (batch, status), so the assignment this
    replaced would report only the LAST batch's count for each status -- a project
    with two batches would show the smaller number and look like snags had vanished.

    Every status is seeded to 0 on every slice, so each is a total map over SnagStatus
    as `Record<SnagStatus, number>` in types.ts requires.

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
        fields=["batch", "status", "count(name) as cnt"],
        group_by="batch, status",
        limit_page_length=0,
    )

    by_status = {status: 0 for status in SNAG_STATUSES}
    by_batch = {}
    total = 0
    for row in rows:
        count = int(row.get("cnt") or 0)
        status = row.get("status")
        total += count
        if status in by_status:
            by_status[status] += count

        # A snag with no batch was added by hand -- it belongs to the manual slice,
        # not to a batch that does not exist.
        key = row.get("batch") or MANUAL_BATCH_KEY
        slice_ = by_batch.setdefault(
            key, {"total": 0, "by_status": {s: 0 for s in SNAG_STATUSES}}
        )
        slice_["total"] += count
        if status in slice_["by_status"]:
            slice_["by_status"][status] += count

    return {"total": total, "by_status": by_status, "by_batch": by_batch}


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

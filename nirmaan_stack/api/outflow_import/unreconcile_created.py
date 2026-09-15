# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The two reads and the one write an Unreconcile needs for a record the import CREATED (#1278).

`unreconcile.unreconcile_row` asks the pure decision module whether a created record may go; this
module reads its Version history for that question (`edits_of`) and, on a `delete_created` verdict,
deletes it (`delete_created`). Nothing here commits: it runs inside the orchestrator's savepoint.
"""

import frappe

from nirmaan_stack.api.outflow_import.unreconcile_cleanup import delete_statement_file_links
from nirmaan_stack.services.outflow_import.ledgers import project_field_of
from nirmaan_stack.services.outflow_import.settle import _outflow_import_write


def delete_created(doctype: str, name: str, statement_file_url: str | None) -> str | None:
    """Delete a record this import created. Returns its project, read before it is gone.

    ⚠️ THE STATEMENT'S `File` LINK ROWS COME OFF FIRST, BY RAW DELETE. `frappe.delete_doc` deletes every
    `File` attached to the record through the document layer, and the cloud attachment app's `File`
    `on_trash` deletes the blob by `content_hash` -- which on a link row is NULL (it throws with cloud
    deletes on) and, on one carrying the key, is the IMPORT BATCH's statement, shared by every record
    that batch settled. See `unreconcile_cleanup.delete_statement_file_links`.

    ⚠️ `force=True` SKIPS THE LINK CHECK, AND THAT IS NEEDED: the kept Reversed leg's Dynamic Link names
    this record, so the check would refuse the delete. The leg itself is never deleted (ADR-0020 D3).
    The trash hooks still run: `delete_doc_versions.generate_versions` keeps a copy, and the cashflow
    hook -- which evaluates BEFORE the row is gone on `Project Inflows` -- is re-run by the clean-up.
    `_outflow_import_write` holds shut that hook's one committing branch, as for every settle save.
    """
    field = project_field_of(doctype)
    project = frappe.db.get_value(doctype, name, field) if field else None
    delete_statement_file_links(doctype, [name], statement_file_url)
    series = _series_counters_for(name)
    with _outflow_import_write():
        frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
    _restore_series_counters(series)
    return project or None


def edits_of(doctype: str, name: str) -> tuple:
    """`(when, fieldnames)` for every Version row of the record. Which of them count as an edit after
    the match is the decision module's call (`unreconcile._first_edit_after_match`).

    Fieldnames are each `changed` entry's field plus the table field of every added / removed /
    changed child row -- a child-row edit is an edit as much as a field is.
    """
    edits = []
    for version in frappe.get_all(
        "Version",
        filters={"ref_doctype": doctype, "docname": name},
        fields=["creation", "data"],
        order_by="creation asc",
    ):
        parsed = frappe.parse_json(version.data or "{}") or {}
        fields = [change[0] for change in parsed.get("changed") or [] if change]
        for key in ("added", "removed", "row_changed"):
            fields += [row[0] for row in parsed.get(key) or [] if row]
        edits.append((version.creation, tuple(fields)))
    return tuple(edits)


def _series_counters_for(name: str) -> list:
    """Every naming-series counter whose prefix this record's name starts with, as it stands now.

    `LEFT(...) = name`, never `LIKE name || '%'`: a series name is data, and `_` in it would be a
    wildcard.
    """
    return frappe.db.sql(
        """SELECT name, current FROM "tabSeries"
           WHERE name <> '' AND LEFT(%s, LENGTH(name)) = name""",
        (name,),
        as_dict=True,
    )


def _restore_series_counters(series) -> None:
    """Undo `frappe.delete_doc`'s naming-series rewind.

    ⚠️ DELETING THE NEWEST RECORD OF A SERIES WINDS ITS COUNTER BACK (`update_naming_series` ->
    `revert_series_if_last`), so the next record created takes the deleted one's name. The kept
    Reversed leg names that record: reusing the name would make the history point at a DIFFERENT, live
    record -- found by the re-record test, where the new Non-Project Inflow came back as the deleted
    one's name. `GREATEST` never lowers a counter another request advanced meanwhile.

    RAW UPDATE, NO LIFECYCLE SKIPPED: `Series` is a plain counter table with no document behind it.
    """
    for row in series:
        frappe.db.sql(
            """UPDATE "tabSeries" SET current = GREATEST(current, %s) WHERE name = %s""",
            (row.current, row.name),
        )

"""Revised-BoQ entry backend (S2, ADR-0014 D1/D2).

A revision is a NEW `BOQs` doc (`origin="revision"`, `source_boq` -> the original),
uploaded against an already-committed original in the same project. This module owns
the *entry* surface: which originals are revisable, and the eligibility helper the
upload endpoint shares.

Seeding, sheet-mapping and the whole carry pipeline are LATER slices (S3+). Here we
only decide what the picker may offer and re-validate the pick server-side.

D1 eligibility: **same project AND >= 1 committed sheet.** Committed-ness has no field
to filter on (`BOQs.status` never leaves `Draft` in practice), so it is computed from
the committed GRID tier -- the same `(boq, is_current=1)` shape `commit_gate.get_committed_state`
reads. **Filter, don't grey** -- only eligible BOQs are returned. **Chains are allowed**
(a committed revision is itself revisable): no `origin` exclusion.
"""

import frappe


def _boq_has_committed_sheet(boq: str) -> bool:
    """True iff the BoQ has >= 1 CURRENT committed sheet (D1 committed-ness).

    The committed GRID tier (`BoQ Committed Sheet Grid`, is_current=1) is the
    authoritative committed-state source -- it is written for BOTH commit dispositions
    and carries the one-current invariant (mirrors `commit_gate.get_committed_state`).
    A partial commit qualifies (one committed sheet is enough); an uncommitted original
    sheet simply falls through as a NEW sheet in the revision (D4).
    """
    return bool(frappe.db.exists("BoQ Committed Sheet Grid", {"boq": boq, "is_current": 1}))


def assert_revisable_source(source_boq: str, project: str) -> None:
    """Server-side re-validation that `source_boq` is a legitimate revision source (D1).

    The full D1 eligibility rule -- **same project AND >= 1 committed sheet** -- lives here,
    the one owning module (`list_revisable_boqs` is its read-side twin). The upload endpoint
    calls this so a stale picker or a hand-crafted request can never create a revision against
    an ineligible original. Raises `frappe.ValidationError` with a specific message per failure.
    (Chains are allowed, so there is deliberately NO `origin` check.)
    """
    if not frappe.db.exists("BOQs", source_boq):
        frappe.throw(f"Original BoQ '{source_boq}' not found.", title="Not found")
    if frappe.db.get_value("BOQs", source_boq, "project") != project:
        frappe.throw(
            "The selected original belongs to a different project.",
            title="Project mismatch",
        )
    if not _boq_has_committed_sheet(source_boq):
        frappe.throw(
            "The selected BoQ has no committed sheets and cannot be revised.",
            title="Not revisable",
        )


@frappe.whitelist()
def list_revisable_boqs(project: str) -> dict:
    """READ-ONLY. Return the project's revisable BOQs, latest-uploaded first.

    Eligible iff same project AND >= 1 committed sheet (D1). Filter, don't grey: only
    eligible rows are returned, so an empty list is the signal to disable the Revise
    radio. Chains allowed -- no `origin` exclusion; a committed revision lists too.

    Project-less template SEEDS (ADR-0013 A1, `is_template_source=1`) are excluded --
    they carry no project and are never a revision target.

    Returns:
      {"revisable": [
          {"name": str,          # BOQs docname (the picker value + source_boq)
           "boq_name": str,
           "version": int,
           "uploaded_at": str | None},  # as Frappe returns the Datetime; latest first
        ...]}
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")

    # All candidate BOQs in the project. NO origin exclusion (chains allowed); exclude the
    # project-less template seeds defensively. Latest-uploaded first (D1 ordering).
    boqs = frappe.get_all(
        "BOQs",
        filters={"project": project, "is_template_source": 0},
        fields=["name", "boq_name", "version", "uploaded_at"],
        order_by="uploaded_at desc",
    )
    if not boqs:
        return {"revisable": []}

    # Committed-ness in ONE query: which of these BOQs have a current committed grid row.
    names = [b.name for b in boqs]
    committed = frappe.get_all(
        "BoQ Committed Sheet Grid",
        filters={"boq": ["in", names], "is_current": 1},
        fields=["boq"],
        distinct=True,
    )
    committed_names = {r.boq for r in committed}

    revisable = [
        {
            "name": b.name,
            "boq_name": b.boq_name,
            "version": b.version,
            "uploaded_at": b.uploaded_at,
        }
        for b in boqs
        if b.name in committed_names
    ]
    return {"revisable": revisable}

"""
BoQ choices for the Tendering -> Won convert wizard's "BOQ" step.

Read-only. Lists a Tendering project's open BoQs (not Superseded, never a template
source) with the procurement packages each one covers, so the wizard can pre-tick
its Packages step from the BoQs the user picks. Recording the pick (picked BoQs ->
Selected, the rest stay Draft; ADR-0037) is `controllers.boqs.select_project_boqs`, run
by `tendering.convert_tendering_to_won`.
"""
import frappe

from nirmaan_stack.api.projects.tendering import _ensure_tendering_manager


@frappe.whitelist()
def get_convert_boq_options(project):
    """
    Return ``{"boqs": [...]}`` for ``project``, grouped by BoQ name with the
    highest version first in each group.

    Packages come from the BoQ's CURRENT committed sheets:
    ``BoQ Sheet (is_current) -> BoQ Sheet Work Package.work_header ->
    Work Headers.work_package_link``. That link is one-to-one and empty for some
    headers (ELV System and BMS today), so those headers are returned in
    ``unmapped_headers`` -- the wizard names them rather than silently pre-ticking
    an incomplete set. A BoQ with no committed sheet has no packages.

    Each row: name, boq_name, version, origin, source_boq, status, uploaded_at,
    uploaded_by_name, is_latest, committed_sheets, packages, unmapped_headers.
    """
    _ensure_tendering_manager()
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' does not exist.")

    boqs = frappe.db.sql(
        """
        SELECT b.name, b.boq_name, b.version, b.origin, b.source_boq, b.status,
               b.uploaded_at, COALESCE(u.full_name, b.uploaded_by) AS uploaded_by_name
        FROM "tabBOQs" b
        LEFT JOIN "tabUser" u ON u.name = b.uploaded_by
        WHERE b.project = %(project)s
          AND COALESCE(b.status, '') != 'Superseded'
          AND COALESCE(b.is_template_source, 0) = 0
        ORDER BY b.boq_name, b.version DESC, b.name
        """,
        {"project": project},
        as_dict=True,
    )

    sheet_counts = dict(
        frappe.db.sql(
            """
            SELECT s.boq, COUNT(*)
            FROM "tabBoQ Sheet" s
            JOIN "tabBOQs" b ON b.name = s.boq
            WHERE b.project = %(project)s AND s.is_current = 1
            GROUP BY s.boq
            """,
            {"project": project},
        )
    )

    scope_rows = frappe.db.sql(
        """
        SELECT DISTINCT s.boq, wp.work_header, wh.work_package_link
        FROM "tabBoQ Sheet" s
        JOIN "tabBOQs" b ON b.name = s.boq
        JOIN "tabBoQ Sheet Work Package" wp
          ON wp.parent = s.name AND wp.parenttype = 'BoQ Sheet'
        LEFT JOIN "tabWork Headers" wh ON wh.name = wp.work_header
        WHERE b.project = %(project)s AND s.is_current = 1
        """,
        {"project": project},
        as_dict=True,
    )

    packages, unmapped = {}, {}
    for row in scope_rows:
        if row.work_package_link:
            packages.setdefault(row.boq, set()).add(row.work_package_link)
        elif row.work_header:
            unmapped.setdefault(row.boq, set()).add(row.work_header)

    seen_names = set()
    for boq in boqs:
        # Rows arrive highest-version-first within each boq_name.
        boq.is_latest = boq.boq_name not in seen_names
        seen_names.add(boq.boq_name)
        boq.committed_sheets = sheet_counts.get(boq.name, 0)
        boq.packages = sorted(packages.get(boq.name, ()))
        boq.unmapped_headers = sorted(unmapped.get(boq.name, ()))

    return {"boqs": boqs}

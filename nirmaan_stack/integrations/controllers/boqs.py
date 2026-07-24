import json
import frappe
from frappe import _


def next_boq_version(project, boq_name, is_template_source=False, exclude=None):
    """The next `version` for a BoQ in its naming scope: COALESCE(MAX(version), 0) + 1.

    THE one owner of the version rule (M1.25). `before_insert` calls it, and so does
    `api/boq/wizard/revision.convert_revision_entry` -- which must recompute the version after
    the fact, because converting a just-uploaded BoQ between New and Revise CHANGES its
    `boq_name` (a revision reuses the original's name) and therefore its scope, long after
    `before_insert` has run against the old one. They MUST NOT drift, so there is exactly one
    query. Do not re-inline it.

    Scope: `(project, boq_name)` normally; `(is_template_source=1, boq_name)` for the
    project-less template seeds (ADR-0013 A1).

    `exclude` is a BOQs docname to leave out of the MAX. It exists for the recompute case: the
    converting doc already EXISTS and already holds a version, so counting itself would make
    every conversion bump the number by one forever. On insert there is no docname yet, so the
    caller passes nothing and the behaviour is unchanged.
    """
    if is_template_source:
        # Version-scope template-source BoQs by boq_name across the project-less namespace.
        where = 'is_template_source = 1 AND boq_name = %s'
        params = [boq_name]
    else:
        where = 'project = %s AND boq_name = %s'
        params = [project, boq_name]
    if exclude:
        where += ' AND name != %s'
        params.append(exclude)

    result = frappe.db.sql(
        f'SELECT COALESCE(MAX(version), 0) + 1 FROM "tabBOQs" WHERE {where}',
        tuple(params),
    )
    return result[0][0] if result else 1


def before_insert(doc, method):
    # Template-source BoQs (Create-from-Template, ADR-0013 A1) are project-less: a
    # scratch authoring BoQ used to seed the master BoQ Template, not bound to any
    # Projects row. Only real (upload/clone) BoQs require a project -- the upload path
    # is byte-identical.
    if not doc.get("is_template_source") and not doc.project:
        frappe.throw(_("Project is required"))
    if not doc.boq_name:
        frappe.throw(_("BoQ Name is required"))

    doc.version = next_boq_version(
        doc.project, doc.boq_name, is_template_source=bool(doc.get("is_template_source"))
    )

    doc.status = "Draft"
    doc.uploaded_by = frappe.session.user
    doc.uploaded_at = frappe.utils.now()


def validate(doc, method):
    _validate_area_dimensions(doc)

    old_doc = doc.get_doc_before_save()
    if old_doc is None:
        return

    if old_doc.status != "Superseded" and doc.status == "Superseded":
        frappe.throw(_(
            "Status cannot be manually set to Superseded. "
            "This transitions automatically when a new version is uploaded."
        ))

    if old_doc.status == "Superseded" and doc.status != "Superseded":
        frappe.throw(_("A Superseded BoQ cannot be reopened."))


def on_update(doc, method):
    # parent_boq (the master/sub BoQ link) was retired in Phase 4 P4-FINAL, and the
    # Draft->Approved approval cascade it drove was removed with it. on_update has no
    # remaining work; kept as a wired no-op so hooks.py needs no change.
    pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_area_dimensions(doc):
    if not doc.area_dimensions:
        return

    try:
        dims = json.loads(doc.area_dimensions)
    except (json.JSONDecodeError, ValueError):
        frappe.throw(_("area_dimensions must be valid JSON, e.g. [\"B1\", \"B3\"]."))

    if not isinstance(dims, list):
        frappe.throw(_("area_dimensions must be a JSON array, e.g. [\"B1\", \"B3\"]."))

    if not dims:
        return  # empty list [] is valid

    for item in dims:
        if not isinstance(item, str):
            frappe.throw(_("area_dimensions must contain only strings."))

    if len(dims) != len(set(dims)):
        frappe.throw(_("area_dimensions must not contain duplicate area names."))

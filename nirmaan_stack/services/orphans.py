"""BoQ orphan rows: report them, then delete exactly what the owner approved. NOT a patch.

An ORPHAN is a row of a BoQ table that nothing owns any more:
  * a child row whose parent document is gone (`parent` names a row that does not exist);
  * a document whose `boq` link names a BOQs record that is gone;
  * every row BELOW one of those (its child-table rows, recursively) -- counted and deleted with it,
    so a delete never leaves new orphans behind it.
Provenance links (`source_boq`, `carried_from_boq`) and links to non-BoQ targets (a project, a work
header) are REPORTED for information and never deleted: losing what a row was copied from does not
make the row ownerless.

THE PROCEDURE (production): run `report()`, hand its `delete` counts to the owner, and run
`delete(confirm_counts=<the approved counts>)`. `delete` recounts first and refuses -- deleting
nothing -- unless the counts it finds now equal the approved ones exactly, so rows that appeared or
went after the approval are never deleted on an approval that did not see them.

Everything is derived from live meta (every non-virtual nirmaan table whose doctype name contains
"boq", and every Link field pointing at BOQs), so a new BoQ child table is covered without an edit.
Raw deletes on purpose, and skipping doc_events is correct: every row deleted here has lost its
owner, so there is no parent left for a hook to recompute.
"""
from __future__ import annotations

import frappe

_CHUNK = 1000


def _boq_doctypes() -> list[str]:
    modules = tuple(frappe.get_module_list("nirmaan_stack"))
    names = frappe.get_all(
        "DocType",
        filters={"module": ["in", modules], "issingle": 0, "is_virtual": 0, "name": ["like", "%boq%"]},
        pluck="name",
    )
    return sorted(n for n in names if frappe.db.table_exists(n))


def _child_tables(doctype: str) -> list[str]:
    return [f.options for f in frappe.get_meta(doctype).get_table_fields()
            if frappe.db.table_exists(f.options)]


def _scan(scope: str | None = None) -> tuple[dict, dict, dict]:
    """(delete_sets, delete_counts, info_counts). delete_sets: {label: (doctype, [names])}; every row
    appears under exactly one label. `scope`, when given, is a LIKE pattern the MISSING owner's name
    must match (`parent` of a child row, `boq` of a document) -- how a test confines itself to its own
    fixtures on a shared database. Production passes none."""
    owner_sql = " and c.{col} like %(scope)s" if scope else ""
    sets: dict = {}
    taken: dict = {}

    def add(label, doctype, names):
        seen = taken.setdefault(doctype, set())
        fresh = [n for n in names if n not in seen]
        seen.update(fresh)
        if fresh:
            sets[label] = (doctype, sets.get(label, (doctype, []))[1] + fresh)
        return fresh

    doctypes = _boq_doctypes()
    # 1. child rows whose parent is gone
    for dt in doctypes:
        if not frappe.get_meta(dt).istable:
            continue
        for (parenttype,) in frappe.db.sql(f'select distinct parenttype from "tab{dt}" where parenttype is not null'):
            if not frappe.db.table_exists(parenttype):
                continue
            names = [r[0] for r in frappe.db.sql(
                f'''select c.name from "tab{dt}" c where c.parenttype = %(pt)s
                    and not exists (select 1 from "tab{parenttype}" p where p.name = c.parent)'''
                + owner_sql.format(col="parent"), {"pt": parenttype, "scope": scope})]
            add(f"child:{dt}<{parenttype}", dt, names)
    # 2. documents whose `boq` names a missing BOQs; other links to BOQs are info only
    info: dict = {}
    from frappe.model.rename_doc import get_link_fields

    for lf in get_link_fields("BOQs"):
        dt, field = lf["parent"], lf["fieldname"]
        if lf.get("issingle") or not frappe.db.table_exists(dt) or frappe.get_meta(dt).istable:
            continue
        names = [r[0] for r in frappe.db.sql(
            f'''select c.name from "tab{dt}" c where coalesce(c."{field}", '') <> ''
                and not exists (select 1 from "tabBOQs" b where b.name = c."{field}")'''
            + owner_sql.format(col=f'"{field}"'), {"scope": scope})]
        if field == "boq":
            add(f"link:{dt}.boq", dt, names)
        elif names:
            info[f"link:{dt}.{field}"] = len(names)
    # 3. everything below a row being deleted, recursively
    queue = list(sets.items())
    while queue:
        _label, (dt, names) = queue.pop(0)
        for child in _child_tables(dt):
            found = []
            for i in range(0, len(names), _CHUNK):
                found += [r[0] for r in frappe.db.sql(
                    f'select name from "tab{child}" where parenttype = %s and parent in %s',
                    (dt, tuple(names[i:i + _CHUNK])))]
            fresh = add(f"below:{child}<{dt}", child, found)
            if fresh:
                queue.append((f"below:{child}<{dt}", (child, fresh)))
    counts = {label: len(names) for label, (_dt, names) in sets.items()}
    return sets, counts, info


def report(scope: str | None = None) -> dict:
    """Counts only; writes nothing. `delete` is what delete() would remove, by label; `info` is
    reported and never deleted."""
    _sets, counts, info = _scan(scope)
    return {"delete": counts, "delete_total": sum(counts.values()), "info": info}


def delete(confirm_counts: dict, scope: str | None = None) -> dict:
    """Delete the orphans ONLY when `confirm_counts` equals what a fresh scan finds now, label for
    label; otherwise delete nothing and say why. Commits once, at the end."""
    sets, counts, _info = _scan(scope)
    if dict(confirm_counts or {}) != counts:
        return {"deleted": False, "reason": "counts differ from the approved counts; nothing deleted",
                "found": counts, "approved": dict(confirm_counts or {})}
    for label, (dt, names) in sets.items():
        for i in range(0, len(names), _CHUNK):
            frappe.db.delete(dt, {"name": ("in", names[i:i + _CHUNK])})
    frappe.db.commit()
    return {"deleted": True, "counts": counts, "total": sum(counts.values())}

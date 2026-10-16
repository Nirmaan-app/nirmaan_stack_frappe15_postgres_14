"""Asset Master -> its history: the asset being added, and its department set or fixed in Edit.

Department moves made by an assignment are recorded by the Asset Management hooks, and a department
filled in from its holder by the Nirmaan Users hook; both use set_value, so they never reach here.
"""

from nirmaan_stack.services.asset_history import ASSET_ADDED, DEPARTMENT_SET, add_history


def after_insert(doc, method):
    add_history(doc.name, ASSET_ADDED, to_department=doc.department)


def on_update(doc, method):
    if doc.flags.in_insert or not doc.has_value_changed("department"):
        return
    before = doc.get_doc_before_save()
    add_history(
        doc.name,
        DEPARTMENT_SET,
        from_department=before.department if before else None,
        to_department=doc.department,
    )

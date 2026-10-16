"""Nirmaan Department -- only Admin and HR may rename or delete one (validate covers add/edit).

Renaming goes through Frappe's rename, which also updates every person and asset linked to the
department; the asset history keeps the old name, as a log should. Deleting is blocked by Frappe's
link check while anyone or any asset uses the department -- switch it off instead.
"""

from nirmaan_stack.services.departments import require_department_editor


def before_rename(doc, method, old_name, new_name, merge):
    require_department_editor("Only Admin and HR can rename a department.")


def on_trash(doc, method):
    require_department_editor("Only Admin and HR can delete a department.")

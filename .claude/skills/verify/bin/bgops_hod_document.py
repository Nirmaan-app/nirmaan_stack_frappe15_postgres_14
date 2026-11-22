"""Make one from-app handover document downloadable from its row, for the `document-beside-binder` walk (#1671).

    devenv.sh script <task> .claude/skills/verify/bin/bgops_hod_document.py <project> <system> <document key>

The row's Download builds that document's content as a background operation only when the document is Done and
has a saved selection, as a person leaves it after ticking its records and marking it Done. This sets the row
Done with its first source record selected, on the env DB only, and prints `BGOPS {"row", "title", "selected"}`.
"""

import json
import sys

import frappe

from nirmaan_stack.api.hod import binder
from nirmaan_stack.services.hod import index

project, system, document = sys.argv[1:4]
row = frappe.db.get_value(binder.DOCTYPE, {"project": project, "hod_system": system, "document": document}, "name")
if not row:
    sys.exit(f"{project} has no {system} row for {document}")
items = binder.sources_for(project, system, document).get("items") or []
if not items:
    sys.exit(f"{project}'s {system} {document} has no source records to select")
selected = [items[0].name]
doc = frappe.get_doc(binder.DOCTYPE, row)
doc.update({"status": "Done", "disabled": 0, "form_data": json.dumps({"selected": selected})})
doc.save(ignore_permissions=True)
frappe.db.commit()
print("BGOPS " + json.dumps({"row": row, "title": index.get(document)["title"], "selected": selected}))

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Outflow Import Project Alias -- a phrase people write -> the project they mean.

`project_match` can already read a project's whole name or a word unique to it. This table exists
for the three things no rule over the project master can reach, because each is a fact about how
people WRITE rather than about the master:

  * a project known by a name it is not recorded under -- everyone spending money at
    `VR Mall Food Court` writes "VR mall", and no rule can get there: "mall" is shared with
    `Wakefit - Airia Mall`, and "vr" is too short to survive tokenising. Six rows in one statement.
  * an initialism shorter than a token -- "EY" for `Ernst & Young`.
  * a habitual misspelling -- "tekus", "Qubest".

A DOCTYPE rather than a file for the same reason as the expense rules: each row points at the NAME
of a `Projects` record, and a `Link` field is what stops a rename or a delete leaving a phrase
pointing at nothing.

⚠️ THE PHRASE IS UNIQUE BY DB CONSTRAINT, AND THE NORMALISED FORM IS CHECKED ON TOP. `unique: 1`
catches "VR Mall" twice; it does NOT catch "VR Mall" beside "vr  mall", which normalise to the same
phrase. The builder in `project_match` drops a phrase claimed by two projects -- correct, but
SILENT, so the alias someone just wrote would simply never fire. `validate` catches it at the point
of writing, where there is somebody to tell.
"""

import frappe
from frappe.model.document import Document

from nirmaan_stack.services.outflow_import.project_match import alias_haystack


class OutflowImportProjectAlias(Document):
    def validate(self):
        self.keyword = (self.keyword or "").strip()
        if not self.keyword:
            frappe.throw("An alias is required.", title="Missing alias")

        normalized = alias_haystack(self.keyword).strip()
        if not normalized:
            # Punctuation only. It would normalise to nothing and match every remark ever typed.
            frappe.throw(
                "An alias needs at least one letter or number.", title="Nothing to match on"
            )

        for other in frappe.get_all(
            "Outflow Import Project Alias",
            filters={"name": ("!=", self.name or "")},
            fields=["name", "keyword", "project"],
        ):
            if alias_haystack(other.keyword).strip() != normalized:
                continue
            if other.project == self.project:
                frappe.throw(
                    f"'{other.keyword}' already means this project.", title="Duplicate alias"
                )
            # ⚠️ THE SILENT CASE. Two projects claiming one phrase makes the builder drop it
            # entirely, so BOTH aliases stop working -- including the one that was there first.
            frappe.throw(
                f"'{other.keyword}' already means {other.project}. A phrase claimed by two "
                "projects is ignored altogether, so neither alias would work.",
                title="Alias already taken",
            )


def on_doctype_update():
    frappe.db.add_index("Outflow Import Project Alias", ["active"], "oipa_active_idx")

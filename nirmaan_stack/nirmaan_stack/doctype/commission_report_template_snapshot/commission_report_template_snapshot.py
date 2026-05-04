# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class CommissionReportTemplateSnapshot(Document):
    """Immutable, content-addressed snapshot of a commissioning report template.

    The docname is the SHA-256 hex of `payload` (autoname: field:payload_hash).
    Identical payloads share one row. Snapshots must never be mutated after
    insert — historical filled reports depend on the exact payload bytes for
    correct rendering.
    """

    _IMMUTABLE_FIELDS = (
        "payload",
        "payload_hash",
        "template_id",
        "template_version",
        "template_title",
        "first_seen_at",
    )

    def validate(self):
        if self.is_new():
            return
        # Block in-place edits. Snapshots are write-once.
        before = self.get_doc_before_save()
        if not before:
            return
        for fieldname in self._IMMUTABLE_FIELDS:
            if str(self.get(fieldname) or "") != str(before.get(fieldname) or ""):
                frappe.throw(
                    f"Commission Report Template Snapshot is immutable. Field '{fieldname}' cannot be changed after insert.",
                    title="Immutable Snapshot",
                )

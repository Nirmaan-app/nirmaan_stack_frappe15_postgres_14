# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


# Purchase Order statuses excluded when picking the latest `make` per item.
_EXCLUDED_PO_STATUSES = ("Merged", "Inactive", "PO Amendment")


class RemainingItemsReport(Document):
    def validate(self):
        self._validate_one_per_project_per_date()
        self._validate_remaining_quantities()
        if not self.is_new():
            self._validate_edit_window()
        self._stamp_latest_po_make()

    def _validate_one_per_project_per_date(self):
        existing = frappe.db.exists(
            "Remaining Items Report",
            {
                "project": self.project,
                "report_date": self.report_date,
                "name": ("!=", self.name),
            },
        )
        if existing:
            frappe.throw(
                f"A Remaining Items Report already exists for project {self.project} on {self.report_date}"
            )

    def _validate_remaining_quantities(self):
        for item in self.items or []:
            if item.remaining_quantity is not None:
                # -1 is a sentinel meaning "not applicable / no data" — skip validation
                if item.remaining_quantity == -1:
                    continue
                if item.remaining_quantity < 0:
                    frappe.throw(
                        f"Remaining quantity for {item.item_name} cannot be negative"
                    )

    def _validate_edit_window(self):
        if str(self.report_date) != today():
            frappe.throw("Reports can only be edited on the same day they were created")

    def _stamp_latest_po_make(self):
        """Backend-only: stamp the latest PO `make` onto each child row when the
        report is Submitted. Draft reports are left untouched.

        For each (project, item_id), picks `poi.make` from the most recently
        created Purchase Order Item — same rule used by
        `create_transfer_request._build_metadata_snapshot` so the RIR snapshot
        stays consistent with what ITR creation would infer at that moment.
        """
        if (getattr(self, "status", None) or "Draft") != "Submitted":
            return
        if not self.project or not self.items:
            return

        item_ids = tuple({row.item_id for row in self.items if row.item_id})
        if not item_ids:
            return

        rows = frappe.db.sql(
            """
            WITH ranked AS (
                SELECT po.project, poi.item_id, poi.make,
                       ROW_NUMBER() OVER (
                           PARTITION BY po.project, poi.item_id
                           ORDER BY poi.creation DESC
                       ) AS rn
                FROM "tabPurchase Order Item" poi
                JOIN "tabProcurement Orders" po ON poi.parent = po.name
                WHERE po.status NOT IN %(excluded)s
                  AND po.project = %(project)s
                  AND poi.item_id IN %(item_ids)s
            )
            SELECT item_id, make FROM ranked WHERE rn = 1
            """,
            {
                "project": self.project,
                "item_ids": item_ids,
                "excluded": _EXCLUDED_PO_STATUSES,
            },
            as_dict=True,
        )
        make_by_item = {r["item_id"]: r["make"] for r in rows}

        for row in self.items:
            # Items without a PO in this project stay None.
            row.make = make_by_item.get(row.item_id)

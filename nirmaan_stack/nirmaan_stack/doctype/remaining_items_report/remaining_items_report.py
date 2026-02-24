# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today


class RemainingItemsReport(Document):
    def validate(self):
        self._validate_one_per_project_per_date()
        self._validate_remaining_quantities()
        if not self.is_new():
            self._validate_edit_window()

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
                if item.dn_quantity is not None and item.remaining_quantity > item.dn_quantity:
                    frappe.throw(
                        f"Remaining quantity ({item.remaining_quantity}) for {item.item_name} cannot exceed DN quantity ({item.dn_quantity})"
                    )

    def _validate_edit_window(self):
        if str(self.report_date) != today():
            frappe.throw("Reports can only be edited on the same day they were created")

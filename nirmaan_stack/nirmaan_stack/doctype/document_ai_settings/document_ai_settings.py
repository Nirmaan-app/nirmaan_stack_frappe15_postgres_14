# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class DocumentAISettings(Document):
    def validate(self):
        self._validate_and_normalize_service_account_json()
        self._validate_required_fields_when_enabled()
        self._sync_key_configured_flag()

    def _validate_and_normalize_service_account_json(self):
        raw_json = (self.get("service_account_json_input") or "").strip()
        if not raw_json:
            return

        parsed = self._validate_service_account_json(raw_json)
        self.service_account_json_input = json.dumps(parsed, ensure_ascii=True)

    def _sync_key_configured_flag(self):
        self.has_service_account_json = 1 if (self.service_account_json_input or "").strip() else 0

    def _validate_service_account_json(self, raw_json: str):
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            frappe.throw(_("Service account JSON is invalid: {0}").format(str(exc)))

        required_keys = [
            "type",
            "project_id",
            "private_key",
            "client_email",
            "token_uri",
        ]
        missing = [key for key in required_keys if not parsed.get(key)]

        if missing:
            frappe.throw(
                _("Service account JSON is missing required keys: {0}").format(", ".join(missing))
            )

        return parsed

    def _validate_required_fields_when_enabled(self):
        if not cint(self.enabled):
            return

        missing = []
        if not (self.project_id or "").strip():
            missing.append("project_id")
        if not (self.location or "").strip():
            missing.append("location")
        if not (self.processor_id or "").strip():
            if not (self.invoice_processor_id or "").strip() and not (self.expense_processor_id or "").strip():
                missing.append("at least one processor id (default/invoice/expense)")
        if not cint(self.has_service_account_json):
            missing.append("service_account_json")

        if missing:
            frappe.throw(
                _(
                    "Document AI is enabled but required settings are missing: {0}"
                ).format(", ".join(missing))
            )

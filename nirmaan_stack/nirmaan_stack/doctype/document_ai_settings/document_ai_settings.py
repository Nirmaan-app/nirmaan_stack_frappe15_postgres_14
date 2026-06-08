# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class DocumentAISettings(Document):
    def validate(self):
        self._validate_required_fields_when_enabled()

    def _validate_required_fields_when_enabled(self):
        if not cint(self.enabled):
            return

        missing = []
        if not (self.gemini_model or "").strip():
            missing.append("Gemini Model")

        auth_mode = (self.gemini_auth_mode or "Vertex AI").strip()
        if auth_mode == "Vertex AI":
            if not (self.gcp_project_id or "").strip():
                missing.append("GCP Project ID")
            if not (self.gcp_location or "").strip():
                missing.append("GCP Location")
        else:  # API Key
            # Password fields read back falsy until saved; treat an existing
            # encrypted value as configured.
            if not (self.gemini_api_key or "").strip() and not self.get_password(
                "gemini_api_key", raise_exception=False
            ):
                missing.append("Gemini API Key")

        if missing:
            frappe.throw(
                _("Document extraction is enabled but required settings are missing: {0}").format(
                    ", ".join(missing)
                )
            )

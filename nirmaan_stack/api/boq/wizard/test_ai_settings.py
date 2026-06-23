# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for ai_settings.py (Slice AI-2a).

Covers the two reader helpers + the encryption-at-rest invariant on the key field:
  T1 get_boq_ai_api_key -> None when no key is set (fail-closed)
  T2 get_boq_ai_settings -> fail-closed default shape on an unset Single
  T3 get_boq_ai_settings -> reflects non-secret fields once set
  T4 anthropic_api_key field is fieldtype "Password" (encrypted at rest)

No API key value appears anywhere in this file -- the secret is entered manually
via the Frappe UI after this lands.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.ai_settings import (
    SETTINGS_DOCTYPE,
    get_boq_ai_api_key,
    get_boq_ai_settings,
)


class TestAISettings(FrappeTestCase):

    def test_get_boq_ai_api_key_returns_none_when_unset(self):
        """No key configured -> the decrypted read fails closed to None."""
        self.assertIsNone(get_boq_ai_api_key(),
                          "an unset Anthropic key must read back as None (fail-closed)")

    def test_get_boq_ai_settings_defaults(self):
        """On an unset Single the settings reader returns the fail-closed shape:
        enabled False + request_timeout_seconds present."""
        settings = get_boq_ai_settings()
        self.assertIsInstance(settings, dict)
        self.assertFalse(settings["enabled"], "enabled must default to False")
        self.assertIn("request_timeout_seconds", settings,
                      "request_timeout_seconds must always be present")

    def test_get_boq_ai_settings_reads_non_secret_fields(self):
        """Setting non-secret fields is reflected by the reader."""
        orig_enabled = frappe.db.get_single_value(SETTINGS_DOCTYPE, "enabled")
        orig_model = frappe.db.get_single_value(SETTINGS_DOCTYPE, "model")

        def _restore():
            frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", orig_enabled)
            frappe.db.set_single_value(SETTINGS_DOCTYPE, "model", orig_model)

        self.addCleanup(_restore)

        frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", 1)
        frappe.db.set_single_value(SETTINGS_DOCTYPE, "model", "test-model-x")

        settings = get_boq_ai_settings()
        self.assertTrue(settings["enabled"], "enabled=1 must read back True")
        self.assertEqual(settings["model"], "test-model-x",
                         "model must reflect the stored value")

    def test_api_key_field_is_password_type(self):
        """Encryption-at-rest invariant: the key field MUST be a Password field,
        never a plaintext Data field."""
        field = frappe.get_meta(SETTINGS_DOCTYPE).get_field("anthropic_api_key")
        self.assertIsNotNone(field, "anthropic_api_key field must exist")
        self.assertEqual(field.fieldtype, "Password",
                         "anthropic_api_key must be a Password field (encrypted at rest)")

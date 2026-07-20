"""Tests for the master-template lifecycle endpoint (template_admin.py) after the
ADR-0013 Amendment A1 collapse to a singleton.

The old N-template surface (publish / deprecate / unpublish / duplicate / delete of
flagged `BOQs` rows) is gone; the only endpoint left is `set_template_active`, which
toggles the single `BoQ Template` master's `is_active` flag (+ provenance stamps).

These tests build the master `BoQ Template` fixture PROGRAMMATICALLY (mirroring the
fixture style in test_create_from_template.py). The endpoint calls frappe.db.commit(),
so each test starts from a clean slate (all `BoQ Template` rows wiped in setUp -- the
test DB is disposable) and cleans up after itself, rather than relying on FrappeTestCase
transaction rollback.

Run via the bench runner (NOT raw unittest -- see CLAUDE.md BoQ test-runner note):
  bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_template_admin
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.template_admin import set_template_active


def _wipe_all_templates():
    """Remove every BoQ Template (+ its sheets/rows) so 'the single master' is
    deterministic. `work_packages` on BoQ Template Sheet is a list-JSON field, so the
    child rows are removed via raw frappe.db.delete (delete_doc would hit the list-JSON
    wall). The test DB is disposable, so a full wipe is safe."""
    frappe.db.delete("BoQ Template Row", {})
    frappe.db.delete("BoQ Template Sheet", {})
    frappe.db.delete("BoQ Template", {})
    frappe.db.commit()


def _make_master(is_active=0, template_name=None):
    """Create the single master BoQ Template (no sheets -- the toggle test needs only
    the header row + is_active + provenance)."""
    doc = frappe.new_doc("BoQ Template")
    doc.template_name = template_name or f"MASTER_{frappe.generate_hash(length=6)}"
    doc.is_active = is_active
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


class _TemplateAdminBase(FrappeTestCase):
    def setUp(self):
        # Start every test from zero masters so `_master_template_name()` resolves the
        # one we create here (and the no-master test truly sees none).
        _wipe_all_templates()
        self._created_users = []
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        frappe.set_user("Administrator")
        _wipe_all_templates()
        for email in self._created_users:
            if frappe.db.exists("Nirmaan Users", email):
                frappe.delete_doc("Nirmaan Users", email, force=True, ignore_permissions=True)
            if frappe.db.exists("User", email):
                frappe.delete_doc("User", email, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _make_user_with_role(self, role_profile):
        email = f"tmpl_gate_{frappe.generate_hash(length=6)}@example.com"
        if not frappe.db.exists("User", email):
            u = frappe.new_doc("User")
            u.email = email
            u.first_name = "Tmpl Gate"
            u.send_welcome_email = 0
            u.enabled = 1
            u.insert(ignore_permissions=True)
        # User.after_insert may auto-create a Nirmaan Users row (role None). Ensure the
        # desired role_profile is set. Nirmaan Users is named by lowercased email.
        if frappe.db.exists("Nirmaan Users", email):
            frappe.db.set_value("Nirmaan Users", email, "role_profile", role_profile)
        else:
            nu = frappe.new_doc("Nirmaan Users")
            nu.email = email
            nu.first_name = "Tmpl Gate"
            nu.role_profile = role_profile
            nu.insert(ignore_permissions=True)
        frappe.db.commit()
        self._created_users.append(email)
        return email


class TestSetTemplateActive(_TemplateAdminBase):
    def test_toggle_active_on_then_off(self):
        """set_template_active flips is_active and stamps provenance both ways."""
        name = _make_master(is_active=0)

        res_on = set_template_active(active=1)
        self.assertEqual(res_on["status"], "saved")
        self.assertEqual(res_on["is_active"], 1)
        self.assertEqual(res_on["template"], name)
        row = frappe.db.get_value(
            "BoQ Template", name, ["is_active", "last_updated_by", "last_updated_on"], as_dict=True
        )
        self.assertEqual(row.is_active, 1)
        self.assertEqual(row.last_updated_by, "Administrator")
        self.assertIsNotNone(row.last_updated_on)

        res_off = set_template_active(active=0)
        self.assertEqual(res_off["is_active"], 0)
        self.assertEqual(frappe.db.get_value("BoQ Template", name, "is_active"), 0)

    def test_accepts_string_truthy_values(self):
        """The whitelisted arg may arrive as a string ('true'/'false'/'1'/'0')."""
        name = _make_master(is_active=0)

        set_template_active(active="true")
        self.assertEqual(frappe.db.get_value("BoQ Template", name, "is_active"), 1)

        set_template_active(active="false")
        self.assertEqual(frappe.db.get_value("BoQ Template", name, "is_active"), 0)

        set_template_active(active="1")
        self.assertEqual(frappe.db.get_value("BoQ Template", name, "is_active"), 1)

    def test_throws_when_no_master(self):
        """With no master seeded, the endpoint throws a clear error (never a silent no-op)."""
        # setUp already wiped all masters -- assert none exist, then expect a throw.
        self.assertEqual(frappe.db.count("BoQ Template"), 0)
        with self.assertRaises(frappe.ValidationError):
            set_template_active(active=1)

    def test_role_gate_rejects_project_lead(self):
        """A Project Lead may NOT toggle the master (only Admin + Estimates + Administrator)."""
        _make_master(is_active=0)
        lead = self._make_user_with_role("Nirmaan Project Lead Profile")
        frappe.set_user(lead)
        with self.assertRaises(frappe.PermissionError):
            set_template_active(active=1)

    def test_role_gate_allows_estimates_executive(self):
        """An Estimates Executive is permitted to toggle the master."""
        name = _make_master(is_active=0)
        est = self._make_user_with_role("Nirmaan Estimates Executive Profile")
        frappe.set_user(est)
        set_template_active(active=1)  # must not raise
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value("BoQ Template", name, "is_active"), 1)

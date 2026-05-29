# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Unit tests for the Tendering operational guard (Slice 5 / module B5).

Exercises the public interface of `_tendering_guard`:
    - `is_tendering`  — True only for a Tendering project; False for every
      real status (Won/WIP/Completed/Halted/Handover/CEO Hold) and for
      empty/None/non-existent projects.
    - `validate_not_tendering` — raises `frappe.ValidationError` for a
      Tendering project (message names the project) and passes otherwise.

Test projects are created with the minimum required fields:
    - `project_name` (reqd) + `project_city` (drives the {city}-PROJ-#####
      autoname),
    - `project_start_date` / `project_end_date` as "%Y-%m-%d %H:%M:%S" and
      `project_scopes={"scopes": []}` so the `after_insert` `generate_pwm`
      hook does not crash (for status="Tendering" `generate_pwm` early-returns).

All test projects share a marker `project_city` so `tearDown` can clean them
up without touching real data.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects._tendering_guard import (
    is_tendering,
    validate_not_tendering,
)

# Marker city used only by these tests so cleanup never touches real projects.
GUARD_TEST_CITY = "ZzGuardTestCity"


def _make_project(name_suffix, status):
    """Create a minimal Projects doc with the given status; return its docname.

    "CEO Hold" cannot be set through the document lifecycle (the Projects
    `validate` restricts it to a single authorized user), so for that status we
    insert at "Won" and then flip the stored `status` directly with
    `frappe.db.set_value` — which is exactly the runtime shape the guard reads
    (`frappe.db.get_value("Projects", name, "status")`).
    """
    insert_status = "Won" if status == "CEO Hold" else status
    doc = frappe.get_doc(
        {
            "doctype": "Projects",
            "project_name": f"GuardTest {name_suffix}",
            "project_city": GUARD_TEST_CITY,
            "project_state": "Test State",
            "project_start_date": "2025-01-01 00:00:00",
            "project_end_date": "2025-12-31 00:00:00",
            "project_scopes": {"scopes": []},
            "status": insert_status,
        }
    ).insert(ignore_permissions=True)
    if insert_status != status:
        frappe.db.set_value("Projects", doc.name, "status", status)
    return doc.name


class TestTenderingGuard(FrappeTestCase):
    # Statuses that denote a real/awarded project — the guard must allow these.
    REAL_STATUSES = ["Won", "WIP", "Completed", "Halted", "Handover", "CEO Hold"]

    def tearDown(self):
        for name in frappe.get_all(
            "Projects", filters={"project_city": GUARD_TEST_CITY}, pluck="name"
        ):
            frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
        frappe.db.commit()

    # --- is_tendering -----------------------------------------------------

    def test_is_tendering_true_for_tendering_project(self):
        """is_tendering returns True for a project whose status is Tendering."""
        name = _make_project("tendering", "Tendering")
        self.assertTrue(is_tendering(name))

    def test_is_tendering_false_for_real_statuses(self):
        """is_tendering returns False across every real (non-Tendering) status."""
        for status in self.REAL_STATUSES:
            name = _make_project(status.replace(" ", "_").lower(), status)
            self.assertFalse(
                is_tendering(name),
                msg=f"is_tendering should be False for status {status!r}",
            )

    def test_is_tendering_false_for_empty_or_none_project(self):
        """is_tendering handles empty/None/whitespace project names gracefully."""
        self.assertFalse(is_tendering(None))
        self.assertFalse(is_tendering(""))

    def test_is_tendering_false_for_nonexistent_project(self):
        """is_tendering returns False when the project does not exist."""
        self.assertFalse(is_tendering("Nonexistent-PROJ-99999"))

    # --- validate_not_tendering ------------------------------------------

    def test_validate_not_tendering_raises_for_tendering(self):
        """validate_not_tendering raises ValidationError for a Tendering project."""
        name = _make_project("tendering_raise", "Tendering")
        with self.assertRaises(frappe.ValidationError):
            validate_not_tendering(name, "Procurement Request")

    def test_validate_not_tendering_message_names_project_and_label(self):
        """The raised error names both the project and the document label."""
        name = _make_project("tendering_msg", "Tendering")
        with self.assertRaises(frappe.ValidationError) as ctx:
            validate_not_tendering(name, "Procurement Order")
        message = str(ctx.exception)
        self.assertIn(name, message)
        self.assertIn("Procurement Order", message)
        self.assertIn("Tendering prospect", message)

    def test_validate_not_tendering_default_label(self):
        """Without a label, the message falls back to 'this document'."""
        name = _make_project("tendering_default", "Tendering")
        with self.assertRaises(frappe.ValidationError) as ctx:
            validate_not_tendering(name)
        self.assertIn("this document", str(ctx.exception))

    def test_validate_not_tendering_passes_for_real_statuses(self):
        """validate_not_tendering is a no-op (returns None) for real statuses."""
        for status in self.REAL_STATUSES:
            name = _make_project(
                f"ok_{status.replace(' ', '_').lower()}", status
            )
            self.assertIsNone(
                validate_not_tendering(name, "Project Payment"),
                msg=f"validate_not_tendering should pass for status {status!r}",
            )

    def test_validate_not_tendering_passes_for_empty_project(self):
        """validate_not_tendering passes for empty/None project (not a stub)."""
        self.assertIsNone(validate_not_tendering(None, "Project Invoice"))
        self.assertIsNone(validate_not_tendering("", "Project Inflow"))

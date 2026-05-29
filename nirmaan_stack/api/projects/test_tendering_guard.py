# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Unit tests for the Tendering operational guard (v3 dual-field model).

Exercises the public interface of `_tendering_guard`:
    - `is_pre_won`   — True for any project whose `tendering_status` is not
      `"Won"` (i.e. `Tendering` or `Lost`); False for `Won` and for empty/None/
      non-existent projects.
    - `validate_won` — raises `frappe.ValidationError` for a pre-Won project
      (message names the project) and passes otherwise.

Test projects are created with the minimum required fields and a marker
`project_city` so `tearDown` can clean them up without touching real data.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects._tendering_guard import (
    is_pre_won,
    validate_won,
)

# Marker city used only by these tests so cleanup never touches real projects.
GUARD_TEST_CITY = "ZzGuardTestCity"


def _make_project(name_suffix, tendering_status, status=None):
    """Create a minimal Projects doc with the given tendering_status/status.

    `tendering_status` is the bid dimension (Tendering / Won / Lost).
    `status` is the execution dimension; for pre-Won projects it should be
    empty; for Won projects it defaults to "Created".
    """
    if status is None:
        status = "" if tendering_status != "Won" else "Created"
    # "CEO Hold" cannot be set through validate (the Projects controller
    # restricts it to a single authorized user), so for that execution stage
    # we insert at "Created" and flip with frappe.db.set_value — matches the
    # runtime shape the guard reads.
    insert_status = "Created" if status == "CEO Hold" else status
    doc = frappe.get_doc(
        {
            "doctype": "Projects",
            "project_name": f"GuardTest {name_suffix}",
            "project_city": GUARD_TEST_CITY,
            "project_state": "Test State",
            "project_start_date": "2025-01-01 00:00:00",
            "project_end_date": "2025-12-31 00:00:00",
            "project_scopes": {"scopes": []},
            "tendering_status": tendering_status,
            "status": insert_status,
        }
    ).insert(ignore_permissions=True)
    if insert_status != status:
        frappe.db.set_value("Projects", doc.name, "status", status)
    return doc.name


class TestTenderingGuard(FrappeTestCase):
    # Execution stages a Won project can hold — the guard must allow ALL of these.
    WON_EXECUTION_STATUSES = [
        "Created",
        "WIP",
        "Completed",
        "Halted",
        "Handover",
        "CEO Hold",
    ]

    def tearDown(self):
        for name in frappe.get_all(
            "Projects", filters={"project_city": GUARD_TEST_CITY}, pluck="name"
        ):
            frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
        frappe.db.commit()

    # --- is_pre_won -------------------------------------------------------

    def test_is_pre_won_true_for_tendering(self):
        """is_pre_won returns True for a Tendering project."""
        name = _make_project("tendering", "Tendering")
        self.assertTrue(is_pre_won(name))

    def test_is_pre_won_true_for_lost(self):
        """is_pre_won returns True for a Lost project."""
        name = _make_project("lost", "Lost")
        self.assertTrue(is_pre_won(name))

    def test_is_pre_won_false_for_won_across_execution_stages(self):
        """is_pre_won returns False for Won projects regardless of execution stage."""
        for status in self.WON_EXECUTION_STATUSES:
            name = _make_project(
                f"won_{status.replace(' ', '_').lower()}", "Won", status
            )
            self.assertFalse(
                is_pre_won(name),
                msg=f"is_pre_won should be False for Won project at status {status!r}",
            )

    def test_is_pre_won_false_for_empty_or_none_project(self):
        """is_pre_won handles empty/None project names gracefully."""
        self.assertFalse(is_pre_won(None))
        self.assertFalse(is_pre_won(""))

    def test_is_pre_won_false_for_nonexistent_project(self):
        """is_pre_won returns False when the project does not exist."""
        self.assertFalse(is_pre_won("Nonexistent-PROJ-99999"))

    # --- validate_won ----------------------------------------------------

    def test_validate_won_raises_for_tendering(self):
        """validate_won raises ValidationError for a Tendering project."""
        name = _make_project("tendering_raise", "Tendering")
        with self.assertRaises(frappe.ValidationError):
            validate_won(name, "Procurement Request")

    def test_validate_won_raises_for_lost(self):
        """validate_won raises ValidationError for a Lost project."""
        name = _make_project("lost_raise", "Lost")
        with self.assertRaises(frappe.ValidationError):
            validate_won(name, "Procurement Order")

    def test_validate_won_message_names_project_and_label(self):
        """The raised error names both the project and the document label."""
        name = _make_project("tendering_msg", "Tendering")
        with self.assertRaises(frappe.ValidationError) as ctx:
            validate_won(name, "Procurement Order")
        message = str(ctx.exception)
        self.assertIn(name, message)
        self.assertIn("Procurement Order", message)
        self.assertIn("Tendering", message)

    def test_validate_won_default_label(self):
        """Without a label, the message falls back to 'this document'."""
        name = _make_project("tendering_default", "Tendering")
        with self.assertRaises(frappe.ValidationError) as ctx:
            validate_won(name)
        self.assertIn("this document", str(ctx.exception))

    def test_validate_won_passes_for_won_across_execution_stages(self):
        """validate_won is a no-op (returns None) for Won projects."""
        for status in self.WON_EXECUTION_STATUSES:
            name = _make_project(
                f"ok_{status.replace(' ', '_').lower()}", "Won", status
            )
            self.assertIsNone(
                validate_won(name, "Project Payment"),
                msg=f"validate_won should pass for Won project at status {status!r}",
            )

    def test_validate_won_passes_for_empty_project(self):
        """validate_won passes for empty/None project (not a stub)."""
        self.assertIsNone(validate_won(None, "Project Invoice"))
        self.assertIsNone(validate_won("", "Project Inflow"))

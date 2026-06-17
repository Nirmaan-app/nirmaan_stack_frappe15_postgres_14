# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""
End-to-end tests for the v3 dual-field tendering APIs:

  - create_tendering_project (B2)
  - update_tendering_project  (B7)
  - mark_tendering_project_lost (B4b)
  - delete_tendering_project   (B8)
  - create_project_with_address (B9 — direct Won create, dual-field write)

These exercise the public whitelisted endpoints exactly as the frontend
would call them, and assert the resulting (tendering_status, status)
dual-field state on disk.

Cleanup uses a marker city so we never touch real data.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects.tendering import (
    create_tendering_project,
    update_tendering_project,
    delete_tendering_project,
    mark_tendering_project_lost,
)
from nirmaan_stack.api.projects.new_project import create_project_with_address

API_TEST_CITY = "ZzApiTestCity"


def _pick_existing(doctype, **filters):
    rows = frappe.get_all(doctype, filters=filters or None, pluck="name", limit=1)
    return rows[0] if rows else None


class TestTenderingApis(FrappeTestCase):
    """Exercises the create / update / mark-lost / delete flows."""

    def tearDown(self):
        # Delete projects + addresses created by the tests (marker city only).
        for name in frappe.get_all(
            "Projects", filters={"project_city": API_TEST_CITY}, pluck="name"
        ):
            frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
        for name in frappe.get_all(
            "Address", filters={"address_title": ["like", "ApiTest%"]}, pluck="name"
        ):
            frappe.delete_doc("Address", name, ignore_permissions=True, force=True)
        frappe.db.commit()

    # ----- B2: create_tendering_project -------------------------------------

    def test_create_writes_tendering_status_and_empty_status(self):
        """Stub create: tendering_status='Tendering', status='' (empty)."""
        res = create_tendering_project(
            project_name="ApiTest Stub",
            project_state="Test State",
            project_city=API_TEST_CITY,
            customer=None,
        )
        self.assertEqual(res["status"], 200, msg=res)
        name = res["project_name"]
        self.assertEqual(
            frappe.db.get_value("Projects", name, "tendering_status"),
            "Tendering",
        )
        self.assertIn(
            frappe.db.get_value("Projects", name, "status") or "",
            ("", None),
        )

    def test_create_has_no_address_and_no_pwm(self):
        """Stub has no Address doc and no Project Work Milestones (B6 guard)."""
        res = create_tendering_project(
            project_name="ApiTest NoSideEffects",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )
        name = res["project_name"]
        self.assertFalse(
            frappe.db.get_value("Projects", name, "project_address"),
            msg="Stub must not have an Address.",
        )
        self.assertEqual(
            frappe.db.count("Project Work Milestones", {"project": name}),
            0,
            msg="Stub must not generate PWMs.",
        )

    def test_create_docname_uses_city_prefix(self):
        """autoname format is `{city}-PROJ-#####` and is frozen at insert."""
        res = create_tendering_project(
            project_name="ApiTest Docname",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )
        self.assertTrue(res["project_name"].startswith(f"{API_TEST_CITY}-PROJ-"))

    def test_create_rejects_missing_required_fields(self):
        """Missing name/state/city → 400 with a ValidationError message."""
        for missing in ("project_name", "project_state", "project_city"):
            payload = {
                "project_name": "ApiTest Missing",
                "project_state": "Test State",
                "project_city": API_TEST_CITY,
            }
            payload[missing] = ""
            res = create_tendering_project(**payload)
            self.assertEqual(res["status"], 400, msg=f"missing {missing}: {res}")
            self.assertIn(
                "is required", res["error"],
                msg=f"missing {missing}: {res}",
            )

    # ----- B7: update_tendering_project -------------------------------------

    def test_update_changes_stub_fields(self):
        """Edit updates the four stub fields and leaves the docname frozen."""
        name = create_tendering_project(
            project_name="ApiTest Edit-Before",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )["project_name"]

        # Pick any real customer if available; otherwise skip the customer leg.
        customer = _pick_existing("Customers")

        res = update_tendering_project(
            project_name=name,
            project_title="ApiTest Edit-After",
            project_state="Edited State",
            project_city=API_TEST_CITY + "B",  # different city
            customer=customer or "",
        )
        self.assertEqual(res["status"], 200, msg=res)
        # Docname unchanged
        self.assertEqual(res["project_name"], name)
        # Fields updated
        row = frappe.db.get_value(
            "Projects", name,
            ["project_name", "project_state", "project_city", "customer",
             "tendering_status", "status"],
            as_dict=True,
        )
        self.assertEqual(row.project_name, "ApiTest Edit-After")
        self.assertEqual(row.project_state, "Edited State")
        self.assertEqual(row.project_city, API_TEST_CITY + "B")
        if customer:
            self.assertEqual(row.customer, customer)
        # Bid + execution dimensions unchanged
        self.assertEqual(row.tendering_status, "Tendering")
        self.assertIn(row.status or "", ("", None))

    def test_update_rejects_non_tendering_project(self):
        """A Lost or Won project cannot be edited through this endpoint."""
        name = create_tendering_project(
            project_name="ApiTest LostEditReject",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )["project_name"]
        # Move to Lost
        mark_tendering_project_lost(project_name=name)

        res = update_tendering_project(project_name=name, project_title="Hack")
        self.assertEqual(res["status"], 400)
        self.assertIn("not editable as a Tendering stub", res["error"])
        # Title unchanged
        self.assertEqual(
            frappe.db.get_value("Projects", name, "project_name"),
            "ApiTest LostEditReject",
        )

    def test_update_rejects_missing_project(self):
        res = update_tendering_project(project_name="ZzNoSuch-PROJ-99999")
        self.assertEqual(res["status"], 400)
        self.assertIn("does not exist", res["error"])

    # ----- B4b: mark_tendering_project_lost ---------------------------------

    def test_mark_lost_flips_only_tendering_status(self):
        """tendering_status moves Tendering -> Lost; status untouched (stays '')."""
        name = create_tendering_project(
            project_name="ApiTest MarkLost",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )["project_name"]

        res = mark_tendering_project_lost(project_name=name)
        self.assertEqual(res["status"], 200, msg=res)
        self.assertEqual(res["project_name"], name)
        self.assertEqual(
            frappe.db.get_value("Projects", name, "tendering_status"),
            "Lost",
        )
        self.assertIn(
            frappe.db.get_value("Projects", name, "status") or "",
            ("", None),
        )

    def test_mark_lost_is_terminal(self):
        """A Lost project cannot be re-marked Lost (or converted back)."""
        name = create_tendering_project(
            project_name="ApiTest LostTerminal",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )["project_name"]
        mark_tendering_project_lost(project_name=name)

        # Re-mark must be rejected
        res = mark_tendering_project_lost(project_name=name)
        self.assertEqual(res["status"], 400)
        self.assertIn("cannot be marked Lost", res["error"])

    def test_mark_lost_rejects_won_project(self):
        """A Won project (created directly) cannot be marked Lost."""
        # Build a minimal real project with a backfilled status. Commit after
        # the insert so the API's rollback (on ValidationError) does NOT undo
        # the test's setup — the API uses frappe.db.begin()/rollback() which
        # would otherwise wipe the whole transaction including our insert.
        won_doc = frappe.get_doc({
            "doctype": "Projects",
            "project_name": "ApiTest WonFromInsert",
            "project_city": API_TEST_CITY,
            "project_state": "Test State",
            "project_start_date": "2025-01-01 00:00:00",
            "project_end_date": "2025-12-31 00:00:00",
            "project_scopes": {"scopes": []},
            "tendering_status": "Won",
            "status": "Won",
        }).insert(ignore_permissions=True)
        frappe.db.commit()

        res = mark_tendering_project_lost(project_name=won_doc.name)
        self.assertEqual(res["status"], 400)
        self.assertIn("cannot be marked Lost", res["error"])
        # Untouched
        self.assertEqual(
            frappe.db.get_value("Projects", won_doc.name, "tendering_status"),
            "Won",
        )

    # ----- B8: delete_tendering_project -------------------------------------

    def test_delete_allows_tendering(self):
        """Tendering stubs are deletable."""
        name = create_tendering_project(
            project_name="ApiTest DeleteTendering",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )["project_name"]
        res = delete_tendering_project(project_name=name)
        self.assertEqual(res["status"], 200, msg=res)
        self.assertFalse(frappe.db.exists("Projects", name))

    def test_delete_allows_lost(self):
        """Lost stubs are also deletable (Admin/PMO)."""
        name = create_tendering_project(
            project_name="ApiTest DeleteLost",
            project_state="Test State",
            project_city=API_TEST_CITY,
        )["project_name"]
        mark_tendering_project_lost(project_name=name)
        res = delete_tendering_project(project_name=name)
        self.assertEqual(res["status"], 200, msg=res)
        self.assertFalse(frappe.db.exists("Projects", name))

    def test_delete_rejects_won(self):
        """Won projects can NEVER be deleted through this endpoint."""
        won_doc = frappe.get_doc({
            "doctype": "Projects",
            "project_name": "ApiTest DeleteWonReject",
            "project_city": API_TEST_CITY,
            "project_state": "Test State",
            "project_start_date": "2025-01-01 00:00:00",
            "project_end_date": "2025-12-31 00:00:00",
            "project_scopes": {"scopes": []},
            "tendering_status": "Won",
            "status": "Won",
        }).insert(ignore_permissions=True)
        # Commit so the API's rollback doesn't undo our setup.
        frappe.db.commit()

        res = delete_tendering_project(project_name=won_doc.name)
        self.assertEqual(res["status"], 400)
        self.assertIn("cannot be deleted here", res["error"])
        self.assertTrue(frappe.db.exists("Projects", won_doc.name))


class TestDirectWonCreate(FrappeTestCase):
    """B9: create_project_with_address writes both dimensions in one shot."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.wp = _pick_existing("Procurement Packages")
        cls.cat = _pick_existing("Category", work_package=cls.wp) or _pick_existing("Category")
        cls.make = _pick_existing("Makelist")

    def tearDown(self):
        for name in frappe.get_all(
            "Projects", filters={"project_city": API_TEST_CITY}, pluck="name"
        ):
            frappe.delete_doc("Projects", name, ignore_permissions=True, force=True)
        for name in frappe.get_all(
            "Address", filters={"address_title": ["like", "ApiTest%"]}, pluck="name"
        ):
            frappe.delete_doc("Address", name, ignore_permissions=True, force=True)
        frappe.db.commit()

    def _payload(self):
        return {
            "project_name": "ApiTest Direct Won",
            "customer": None,
            "project_type": None,
            "project_value": "1000",
            "project_value_gst": "1180",
            "carpet_area": "500",
            "project_gst": None,
            "project_start_date": "2025-01-01T00:00:00.000Z",
            "project_end_date": "2025-12-31T00:00:00.000Z",
            "project_city": API_TEST_CITY,
            "project_state": "Test State",
            "address_line_1": "Line 1",
            "address_line_2": "Line 2",
            "pin": "560001",
            "email": "apitest@example.com",
            "phone": "9999999999",
            "project_scopes": {"scopes": []},
            "enable_project_milestone_tracking": False,
            "project_work_packages": {
                "work_packages": [
                    {
                        "work_package_name": self.wp,
                        "category_list": {
                            "list": [
                                {
                                    "name": self.cat,
                                    "makes": [{"label": self.make, "value": self.make}],
                                }
                            ]
                        },
                    }
                ]
            },
            "project_work_header_entries": [],
        }

    def test_direct_create_writes_tendering_won_and_status_won(self):
        """Direct Won create: tendering_status='Won' AND status='Won'."""
        res = create_project_with_address(self._payload())
        self.assertEqual(res["status"], 200, msg=res)
        name = res["project_name"]

        row = frappe.db.get_value(
            "Projects", name,
            ["tendering_status", "status", "project_address"],
            as_dict=True,
        )
        self.assertEqual(row.tendering_status, "Won")
        self.assertEqual(row.status, "Won")
        # Won create always populates address + child rows
        self.assertTrue(row.project_address)
        self.assertTrue(frappe.db.exists("Address", row.project_address))
        self.assertGreaterEqual(
            frappe.db.count("Project Work Package Category Make", {"parent": name}),
            1,
        )

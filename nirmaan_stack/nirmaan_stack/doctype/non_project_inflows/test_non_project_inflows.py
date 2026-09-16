# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Non Project Inflows -- the record's own rules, its role permissions, and receipt adoption.

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.nirmaan_stack.doctype.non_project_inflows.test_non_project_inflows

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every record inserted here is company money-in as far as any
future reader of this table is concerned, so each one is tracked and purged in `tearDownClass`
together with its `Version` rows (the doctype carries `track_changes`). File rows are written with
`db_insert` on purpose: a real `File.insert()` fires the S3 / GCP attachment hooks and would upload
test bytes to a live bucket.
"""

import unittest
from unittest.mock import patch

import frappe
from frappe.permissions import get_role_permissions

from nirmaan_stack.integrations.controllers.non_project_inflows import (
    get_permission_query_conditions,
    has_permission,
)
from nirmaan_stack.nirmaan_stack.doctype.non_project_inflows.non_project_inflows import INFLOW_TYPES

DOCTYPE = "Non Project Inflows"

# The ROLES each role profile carries on the live site (queried 2026-09-14). The permission rows are
# per ROLE, but people hold PROFILES, so the table in the ticket is about these unions.
PROFILE_ROLES = {
    "admin": ["System Manager", "Nirmaan Accountant", "Nirmaan Project Lead", "Nirmaan Estimates Executive"],
    "accountant_lead": ["Nirmaan Accountant", "Nirmaan Accountant Lead"],
    "accountant": ["Nirmaan Accountant"],
    "sales_executive": ["Nirmaan Sales Executive"],
    "sales_lead": ["Nirmaan Sales Lead"],
}

# The PROFILE each key stands for. The access table in #1265 is about profiles, and roles alone
# cannot express it: System Manager (the only role that deletes) also rides on PMO, Project Lead,
# Estimates, HR and Design Lead.
PROFILE_NAMES = {
    "admin": "Nirmaan Admin Profile",
    "accountant_lead": "Nirmaan Accountant Lead Profile",
    "accountant": "Nirmaan Accountant Profile",
    "pmo": "Nirmaan PMO Executive Profile",
    "project_lead": "Nirmaan Project Lead Profile",
}


class NonProjectInflowsFixture(unittest.TestCase):
    created: list = []
    files: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.created = []
        cls.files = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created:
            frappe.db.delete("Version", {"ref_doctype": DOCTYPE, "docname": name})
            frappe.db.delete(DOCTYPE, {"name": name})
        for name in cls.files:
            frappe.db.delete("File", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _insert(self, **fields):
        doc = frappe.get_doc({
            "doctype": DOCTYPE,
            "inflow_type": "Interest Payouts",
            "amount": 1000,
            "payment_date": "2026-09-01",
            "utr": f"TEST-NPI-{frappe.generate_hash(length=8)}",
            **fields,
        })
        doc.insert(ignore_permissions=True)
        self.created.append(doc.name)
        return doc


class TestValidation(NonProjectInflowsFixture):
    def assertRefused(self, **fields):
        before = frappe.db.count(DOCTYPE)
        with self.assertRaises(frappe.ValidationError):
            self._insert(**fields)
        self.assertEqual(frappe.db.count(DOCTYPE), before, "a refused insert must write nothing")

    def test_zero_amount_is_refused(self):
        self.assertRefused(amount=0)

    def test_negative_amount_is_refused(self):
        self.assertRefused(amount=-500)

    def test_missing_amount_is_refused(self):
        self.assertRefused(amount=None)

    def test_unknown_type_is_refused(self):
        self.assertRefused(inflow_type="Vendor Refund")

    def test_missing_type_is_refused(self):
        self.assertRefused(inflow_type=None)

    def test_others_without_description_is_refused(self):
        self.assertRefused(inflow_type="Others", description=None)

    def test_others_with_a_blank_description_is_refused(self):
        self.assertRefused(inflow_type="Others", description="   ")

    def test_each_valid_type_is_accepted(self):
        for inflow_type in INFLOW_TYPES:
            with self.subTest(inflow_type=inflow_type):
                doc = self._insert(inflow_type=inflow_type, description="Returned advance")
                self.assertEqual(frappe.db.get_value(DOCTYPE, doc.name, "inflow_type"), inflow_type)

    def test_description_is_optional_for_a_named_type(self):
        doc = self._insert(inflow_type="FD Closures", description=None)
        self.assertTrue(frappe.db.exists(DOCTYPE, doc.name))

    def test_an_existing_record_cannot_be_edited_into_a_refused_state(self):
        doc = self._insert(inflow_type="Loan Received")
        doc.amount = 0
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_name_follows_the_npi_series(self):
        doc = self._insert()
        yy = frappe.utils.nowdate()[2:4]
        self.assertRegex(doc.name, rf"^NPI-{yy}-\d{{5}}$")

    def test_the_amount_is_stored_as_currency(self):
        doc = self._insert(amount=1234.5)
        self.assertEqual(frappe.db.get_value(DOCTYPE, doc.name, "amount"), 1234.5)


class TestSchema(unittest.TestCase):
    def test_fields_and_tracking(self):
        meta = frappe.get_meta(DOCTYPE)
        self.assertTrue(meta.track_changes)
        expected = {
            "inflow_type": "Select",
            "description": "Text",
            "utr": "Text",
            "inflow_attachment": "Attach",
            "amount": "Currency",
            "payment_date": "Date",
        }
        for fieldname, fieldtype in expected.items():
            with self.subTest(fieldname=fieldname):
                self.assertEqual(meta.get_field(fieldname).fieldtype, fieldtype)
        # The leading blank is deliberate: a Select with no blank option silently fills a MISSING type
        # with its first value, which would book an unknown receipt as Interest Payouts.
        self.assertEqual(tuple(meta.get_field("inflow_type").options.split("\n")), ("",) + INFLOW_TYPES)
        for absent in ("project", "customer", "invoice", "status"):
            self.assertIsNone(meta.get_field(absent), f"{absent} must not exist on this doctype")


class TestRolePermissions(unittest.TestCase):
    """The access table in #1265, asserted on the role UNION each profile actually holds."""

    def _perms(self, profile):
        user = f"npi-perm-test-{profile}@example.invalid"
        with patch("frappe.get_roles", return_value=PROFILE_ROLES[profile]):
            frappe.local.role_permissions = {}
            return get_role_permissions(frappe.get_meta(DOCTYPE), user=user)

    def test_admin_can_do_everything_including_delete(self):
        perms = self._perms("admin")
        for ptype in ("read", "create", "write", "delete"):
            self.assertTrue(perms.get(ptype), ptype)

    def test_accountant_lead_creates_and_edits_but_does_not_delete(self):
        perms = self._perms("accountant_lead")
        self.assertTrue(perms.get("read"))
        self.assertTrue(perms.get("create"))
        self.assertTrue(perms.get("write"))
        self.assertFalse(perms.get("delete"))

    def test_accountant_creates_but_does_not_edit(self):
        perms = self._perms("accountant")
        self.assertTrue(perms.get("read"))
        self.assertTrue(perms.get("create"))
        self.assertFalse(perms.get("write"))
        self.assertFalse(perms.get("delete"))

    def test_sales_roles_cannot_see_it(self):
        for profile in ("sales_executive", "sales_lead"):
            with self.subTest(profile=profile):
                perms = self._perms(profile)
                for ptype in ("read", "select", "create", "write", "delete"):
                    self.assertFalse(perms.get(ptype), ptype)


class TestProfileGate(unittest.TestCase):
    """The server enforces the access table by PROFILE, on top of the role rows.

    Without it every System Manager holder -- PMO, Project Lead, Estimates, HR, Design Lead -- could
    read, edit and delete through the REST API; only the route guard hid the page from them.
    """

    PMO_ROLES = ["System Manager", "Nirmaan PMO Executive"]
    LEAD_ROLES = ["System Manager", "Nirmaan Project Lead"]

    def _as(self, profile, roles):
        return (
            patch("nirmaan_stack.services.role_profiles.get_role_profile", return_value=PROFILE_NAMES.get(profile)),
            patch("frappe.get_roles", return_value=roles),
        )

    def _hook(self, profile, roles, ptype):
        a, b = self._as(profile, roles)
        with a, b:
            return has_permission(doc=frappe._dict(doctype=DOCTYPE), ptype=ptype, user=f"npi-{profile}@example.invalid")

    def _list_condition(self, profile, roles):
        a, b = self._as(profile, roles)
        with a, b:
            return get_permission_query_conditions(f"npi-{profile}@example.invalid")

    def test_admin_passes_every_check(self):
        for ptype in ("read", "create", "write", "delete"):
            self.assertIsNot(self._hook("admin", PROFILE_ROLES["admin"], ptype), False, ptype)
        self.assertFalse(self._list_condition("admin", PROFILE_ROLES["admin"]))

    def test_accountant_lead_is_refused_delete_only(self):
        roles = PROFILE_ROLES["accountant_lead"]
        for ptype in ("read", "create", "write"):
            self.assertIsNot(self._hook("accountant_lead", roles, ptype), False, ptype)
        self.assertIs(self._hook("accountant_lead", roles, "delete"), False)

    def test_accountant_is_refused_write_and_delete(self):
        roles = PROFILE_ROLES["accountant"]
        for ptype in ("read", "create"):
            self.assertIsNot(self._hook("accountant", roles, ptype), False, ptype)
        for ptype in ("write", "delete"):
            self.assertIs(self._hook("accountant", roles, ptype), False, ptype)

    def test_system_manager_on_another_profile_gets_nothing(self):
        for profile, roles in (("pmo", self.PMO_ROLES), ("project_lead", self.LEAD_ROLES)):
            with self.subTest(profile=profile):
                for ptype in ("read", "create", "write", "delete", "export", "print"):
                    self.assertIs(self._hook(profile, roles, ptype), False, ptype)
                self.assertTrue(self._list_condition(profile, roles), "the list must be emptied for them")

    def test_administrator_is_never_narrowed(self):
        self.assertIsNot(has_permission(doc=frappe._dict(doctype=DOCTYPE), ptype="delete", user="Administrator"), False)
        self.assertFalse(get_permission_query_conditions("Administrator"))

    def test_the_hook_is_wired_into_frappe(self):
        """A PMO user holding System Manager is refused through frappe's own check, not just our function."""
        doc = frappe.get_doc({"doctype": DOCTYPE, "inflow_type": "Loan Received", "amount": 1})
        a, b = self._as("pmo", self.PMO_ROLES)
        with a, b:
            frappe.local.role_permissions = {}
            for ptype in ("create", "delete"):
                self.assertFalse(
                    frappe.has_permission(DOCTYPE, ptype, doc=doc, user="npi-pmo@example.invalid"), ptype
                )


class TestReceiptAdoption(NonProjectInflowsFixture):
    """The add dialog uploads the receipt as a loose private File BEFORE the record exists, because
    Frappe's upload asks for WRITE on the target doctype and an Accountant holds only CREATE. Saving
    the record then claims that File, so everyone who can read the record can open its proof."""

    def _orphan_file(self, attached_to_doctype=None, attached_to_name=None):
        f = frappe.get_doc({
            "doctype": "File",
            "file_name": "receipt.pdf",
            # The GCP attachment app's URL shape -- what every real receipt on this site carries. Frappe's
            # own `attach_files_to_document` adopts only `/files` / `/private/files` URLs and skips this
            # one, which is exactly why the app needs its own hook.
            "file_url": (
                "/api/method/frappe_gcp_attachment.controller.generate_file"
                f"?key=attachments/npi-test/{frappe.generate_hash(length=10)}.pdf&file_name=receipt.pdf"
            ),
            "is_private": 1,
            "attached_to_doctype": attached_to_doctype,
            "attached_to_name": attached_to_name,
        })
        f.name = frappe.generate_hash(length=10)
        f.db_insert()
        self.files.append(f.name)
        return f

    def test_saving_the_record_claims_its_loose_receipt(self):
        f = self._orphan_file()
        doc = self._insert(inflow_attachment=f.file_url)
        row = frappe.db.get_value(
            "File", f.name, ["attached_to_doctype", "attached_to_name", "attached_to_field"], as_dict=True
        )
        self.assertEqual(row.attached_to_doctype, DOCTYPE)
        self.assertEqual(row.attached_to_name, doc.name)
        self.assertEqual(row.attached_to_field, "inflow_attachment")

    def test_a_file_owned_by_another_record_is_never_taken(self):
        f = self._orphan_file(attached_to_doctype="Project Inflows", attached_to_name="PAYIN-TEST-01")
        self._insert(inflow_attachment=f.file_url)
        self.assertEqual(frappe.db.get_value("File", f.name, "attached_to_doctype"), "Project Inflows")

    def test_a_replacement_receipt_is_claimed_on_edit(self):
        doc = self._insert()
        f = self._orphan_file()
        doc.inflow_attachment = f.file_url
        doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("File", f.name, "attached_to_name"), doc.name)

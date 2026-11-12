"""The guards of BOQ Line Estimate (New Estimations): who may change one, on which line, on which project, which rows
are accepted, which fields the server fills, malformed requests, the after-commit copy job, the BoQ Sheet hook, and
that an estimate never blocks deleting a BOQ line, sheet or BOQ.

Each test tries to break a guard through every way in: the endpoints, and a plain document insert / save / delete
(what `/api/resource` runs). The DocPerm gives create / write / delete to ten roles, so the controller's profile gate
is the only thing that stops them.

Fixtures are invented and written with bare `db_insert` (no BOQ controllers run). The clean-up rolls back first,
then deletes each scope by name in its own try, and commits.
"""

import json
from unittest.mock import patch

import frappe
from frappe.model.delete_doc import check_if_doc_is_linked
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.estimations import boq_view, estimate_writes
from nirmaan_stack.integrations.controllers import boq_line_estimate as controller
from nirmaan_stack.services import role_profiles as rp

DOCTYPE = "BOQ Line Estimate"
ITEM_DOCTYPE = "BOQ Line Estimate Item"
PROFILE_PATH = "nirmaan_stack.services.role_profiles.get_role_profile"
EDIT_ROLE = "Nirmaan Estimates Executive"


class TestEstimateGuards(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        s = frappe.generate_hash(length=6)
        cls.s = s
        cls.project = f"TEST-ESTG-PRJ-{s}"
        cls.boq = f"TEST-ESTG-BOQ-{s}"
        cls.other_boq = f"TEST-ESTG-BOQ2-{s}"
        cls.sheet_name = "Made-up guard sheet"
        cls.sheet_old = f"TEST-ESTG-SH0-{s}"
        cls.sheet_cur = f"TEST-ESTG-SH1-{s}"
        cls.category = f"TEST-ESTG-CAT-{s}"
        cls.package = f"TEST-ESTG-PKG-{s}"
        cls.item_sqm = f"TEST-ESTG-ITEM-SQM-{s}"
        cls.item_nos = f"TEST-ESTG-ITEM-NOS-{s}"
        cls.item_b = f"TEST-ESTG-ITEM-B-{s}"
        cls.created = {d: [] for d in ("Projects", "BOQs", "BoQ Sheet", "BOQ Nodes", "Items", "Category")}

        def put(doctype, values):
            doc = frappe.get_doc(dict(values, doctype=doctype))
            doc.db_insert()
            cls.created[doctype].append(doc.name)

        put("Projects", {"name": cls.project, "project_name": f"Made-up guard project {s}", "status": "WIP"})
        put("BOQs", {"name": cls.boq, "project": cls.project, "boq_name": "Made-up guard BOQ", "status": "Selected"})
        put("BOQs", {"name": cls.other_boq, "project": cls.project, "boq_name": "Made-up other BOQ", "status": "Draft"})
        put("BoQ Sheet", {"name": cls.sheet_old, "boq": cls.boq, "sheet_name": cls.sheet_name, "is_current": 0,
                          "commit_version": 0, "treat_as": "data"})
        put("BoQ Sheet", {"name": cls.sheet_cur, "boq": cls.boq, "sheet_name": cls.sheet_name, "is_current": 1,
                          "commit_version": 1, "treat_as": "data"})
        cls.nodes = {}
        for key, sheet, current, row, ntype, desc, unit in (
            ("old15", cls.sheet_old, 0, 15, "Line Item", "Made-up wall panel", "Sqm"),
            ("old16", cls.sheet_old, 0, 16, "Line Item", "Made-up grille", "Nos"),
            ("head", cls.sheet_cur, 1, 13, "Preamble", "MADE-UP GUARD HEADING", None),
            ("cur15", cls.sheet_cur, 1, 15, "Line Item", "Made-up wall panel", "Sqm"),
            ("cur16", cls.sheet_cur, 1, 16, "Line Item", "Made-up grille", "Nos"),
            ("cur17", cls.sheet_cur, 1, 17, "Line Item", "Made-up ceiling", "Sqm"),
        ):
            name = f"TEST-ESTG-N-{key}-{s}"
            put("BOQ Nodes", {"name": name, "boq": cls.boq, "sheet": sheet, "is_current": current,
                              "source_row_number": row, "node_type": ntype, "description": desc, "qty": 10,
                              "unit": unit, "sort_order": row})
            cls.nodes[key] = name
        put("Category", {"name": cls.category, "category_name": cls.category, "work_package": cls.package})
        put("Items", {"name": cls.item_sqm, "item_name": "Made-up panel", "unit_name": "sqm", "category": cls.category})
        put("Items", {"name": cls.item_nos, "item_name": "Made-up bracket", "unit_name": "NOS", "category": cls.category})
        put("Items", {"name": cls.item_b, "item_name": "Made-up board", "unit_name": "Nos", "category": cls.category})
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        problems = []
        try:
            names = frappe.get_all(DOCTYPE, filters={"boq": ["in", cls.created["BOQs"]]}, pluck="name")
            names += frappe.get_all(DOCTYPE, filters={"boq_node": ["in", list(cls.nodes.values())]}, pluck="name")
            names = sorted(set(names))
            if names:
                frappe.db.delete(ITEM_DOCTYPE, {"parent": ["in", names]})
                frappe.db.delete(DOCTYPE, {"name": ["in", names]})
            frappe.db.commit()
        except Exception as e:
            frappe.db.rollback()
            problems.append(f"estimates: {e}")
        for doctype in ("BOQ Nodes", "BoQ Sheet", "BOQs", "Items", "Category", "Projects"):
            try:
                if cls.created[doctype]:
                    frappe.db.delete(doctype, {"name": ["in", cls.created[doctype]]})
                frappe.db.commit()
            except Exception as e:
                frappe.db.rollback()
                problems.append(f"{doctype}: {e}")
        super().tearDownClass()
        if problems:
            raise AssertionError("clean-up left records: " + "; ".join(problems))

    def setUp(self):
        frappe.set_user("Administrator")
        frappe.local.message_log = []
        self.addCleanup(self._purge)

    def tearDown(self):
        frappe.set_user("Administrator")

    # --- helpers ---------------------------------------------------------------------------------------------------

    def _purge(self):
        """Every estimate on this module's BOQ or nodes; only ever by those names (never an empty filter)."""
        frappe.db.rollback()
        frappe.set_user("Administrator")
        names = frappe.get_all(DOCTYPE, filters={"boq": self.boq}, pluck="name")
        names += frappe.get_all(DOCTYPE, filters={"boq_node": ["in", list(self.nodes.values())]}, pluck="name")
        names = sorted(set(names))
        if names:
            frappe.db.delete(ITEM_DOCTYPE, {"parent": ["in", names]})
            frappe.db.delete(DOCTYPE, {"name": ["in", names]})
        frappe.db.commit()

    def _row(self, item=None, quantity=3, **over):
        return dict({"item_type": "Normal", "item_id": item or self.item_sqm, "quantity": quantity}, **over)

    def _custom(self, name="Made-up clip", unit="NOS", quantity=2, **over):
        return dict({"item_type": "Custom", "item_name": name, "unit": unit, "category": self.category,
                     "quantity": quantity}, **over)

    def _save(self, key, rows, expected=None):
        return estimate_writes.save_estimate(boq_node=self.nodes[key], items=rows, expected_modified=expected)

    def _estimate(self, key):
        return frappe.db.get_value(DOCTYPE, {"boq_node": self.nodes[key]}, ["name", "modified"], as_dict=True)

    def _items(self, key):
        est = self._estimate(key)
        if not est:
            return []
        return frappe.get_all(ITEM_DOCTYPE, filters={"parent": est.name, "parenttype": DOCTYPE},
                              fields=["name", "item_type", "item_id", "item_name", "unit", "quantity", "category",
                                      "procurement_package", "make"], order_by="idx asc")

    def _older(self, key, rows, name=None):
        """An estimate left on an older version (written bare: the controller refuses a frozen line item)."""
        name = name or f"TEST-ESTG-E-{key}-{frappe.generate_hash(length=6)}"
        doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes[key], "boq": self.boq,
                              "boq_sheet": self.sheet_old, "item_count": len(rows)})
        doc.name = name
        doc.db_insert()
        for idx, values in enumerate(rows, start=1):
            row = frappe.get_doc(dict(values, doctype=ITEM_DOCTYPE, parent=name, parenttype=DOCTYPE,
                                      parentfield="items", idx=idx))
            row.name = f"{name}-r{idx}"
            row.db_insert()
        return name

    def _user(self, role):
        """A throwaway user holding `role`, allowed on this module's project only (User Permission on Projects).

        Written straight to the tables (`db_insert`), as `test_estimations_api._scoped_user` does: a normal insert runs
        our User hooks. The role PROFILE is patched per test (`get_role_profile`), so no Nirmaan Users row is needed."""
        user = f"estg-{frappe.generate_hash(length=8)}@example.com"

        def drop():
            frappe.db.rollback()
            frappe.db.delete("User Permission", {"user": user})
            frappe.db.delete("Has Role", {"parent": user, "parenttype": "User"})
            frappe.db.delete("User", {"name": user})
            frappe.db.commit()
            frappe.cache.hdel("user_permissions", user)
            frappe.clear_cache(user=user)

        self.addCleanup(drop)
        now = frappe.utils.now()

        def bare(values, name):
            doc = frappe.get_doc(values)
            doc.name = name
            doc.creation = doc.modified = now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()

        bare({"doctype": "User", "email": user, "first_name": "Estimate guard test", "enabled": 1,
              "user_type": "System User", "send_welcome_email": 0}, user)
        bare({"doctype": "Has Role", "parent": user, "parenttype": "User", "parentfield": "roles", "idx": 1,
              "role": role}, f"estg-{frappe.generate_hash(length=10)}")
        bare({"doctype": "User Permission", "user": user, "allow": "Projects", "for_value": self.project,
              "apply_to_all_doctypes": 1}, f"estg-{frappe.generate_hash(length=10)}")
        frappe.db.commit()
        frappe.cache.hdel("user_permissions", user)
        frappe.clear_cache(user=user)
        return user

    def _set_project_status(self, status):
        frappe.db.set_value("Projects", self.project, "status", status, update_modified=False)
        frappe.db.commit()

    # --- who may change an estimate --------------------------------------------------------------------------------

    def test_viewers_are_refused_through_every_way_in(self):
        # Each pair: the role that carries the DocPerm (create / write / delete) and the profile that does not edit.
        # Last: the Estimates Executive ROLE without its profile -- the role alone is not enough (Project Lead has it).
        saved = self._save("cur15", [self._row(quantity=5)])
        cases = (
            ("Nirmaan Project Lead", rp.PROJECT_LEAD_PROFILE),
            ("Nirmaan Project Manager", rp.PROJECT_MANAGER_PROFILE),
            ("Nirmaan Procurement Executive", rp.PROCUREMENT_EXECUTIVE_PROFILE),
            ("Nirmaan Accountant", rp.ACCOUNTANT_PROFILE),
            (EDIT_ROLE, None),
        )
        for role, profile in cases:
            with self.subTest(role=role, profile=profile):
                user = self._user(role)
                with patch(PROFILE_PATH, return_value=profile):
                    frappe.set_user(user)
                    # The endpoints.
                    for call in (
                        lambda: self._save("cur16", [self._row(self.item_nos)]),
                        lambda: self._save("cur15", [self._row(quantity=1)], saved["modified"]),
                        lambda: self._save("cur15", [], saved["modified"]),
                        lambda: estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name),
                        lambda: estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name, estimates="[]"),
                    ):
                        with self.assertRaises(frappe.PermissionError):
                            call()
                        frappe.db.rollback()
                    # What /api/resource runs: a plain insert, save and delete of the document.
                    with self.assertRaises(frappe.PermissionError):
                        frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes["cur16"],
                                        "items": [self._row(self.item_nos)]}).insert()
                    frappe.db.rollback()
                    doc = frappe.get_doc(DOCTYPE, saved["name"])
                    doc.items[0].quantity = 99
                    with self.assertRaises(frappe.PermissionError):
                        doc.save()
                    frappe.db.rollback()
                    with self.assertRaises(frappe.PermissionError):
                        frappe.delete_doc(DOCTYPE, saved["name"])
                    frappe.db.rollback()
                frappe.set_user("Administrator")
        # Nothing changed.
        self.assertIsNone(self._estimate("cur16"))
        self.assertEqual([i.quantity for i in self._items("cur15")], [5])

    def test_a_project_lead_still_reads_estimates(self):
        # Viewing is for everyone the BoQ tab is shown to; only the changes are gated.
        self._save("cur15", [self._row(quantity=5)])
        user = self._user("Nirmaan Project Lead")
        with patch(PROFILE_PATH, return_value=rp.PROJECT_LEAD_PROFILE):
            frappe.set_user(user)
            sheet = boq_view.get_estimates_overview(project=self.project)["boqs"][0]["sheets"][0]
            self.assertEqual((sheet["line_items"], sheet["estimated"]), (3, 1))
            current = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["current"]
            self.assertEqual([[i["quantity"] for i in e["items"]] for e in current], [[5]])

    def test_admin_pmo_and_estimates_executive_add_change_and_delete(self):
        for profile in (rp.ADMIN_PROFILE, rp.PMO_EXECUTIVE_PROFILE, rp.ESTIMATES_EXECUTIVE_PROFILE):
            with self.subTest(profile=profile):
                user = self._user(EDIT_ROLE)
                with patch(PROFILE_PATH, return_value=profile):
                    frappe.set_user(user)
                    saved = self._save("cur16", [self._row(self.item_nos, quantity=4)])
                    saved = self._save("cur16", [self._row(self.item_nos, quantity=6)], saved["modified"])
                    self.assertEqual(saved["item_count"], 1)
                    self.assertEqual(self._save("cur16", [], saved["modified"]), {"deleted": True})
                frappe.set_user("Administrator")
                self.assertIsNone(self._estimate("cur16"))

    # --- which line ------------------------------------------------------------------------------------------------

    def test_an_estimate_goes_only_on_a_current_line_item(self):
        refused = (
            ("head", "only be added to line items"),
            ("old15", "older version of the sheet"),
        )
        for key, message in refused:
            with self.subTest(line=key):
                with self.assertRaisesRegex(frappe.ValidationError, message):
                    self._save(key, [self._row()])
                frappe.db.rollback()
                self.assertIsNone(self._estimate(key))
        # A line item that does not exist: Frappe's link check refuses it before the controller runs (its own
        # "no longer exists" sentence is for a node read as missing), so the message is Frappe's. Refused all the same.
        missing = f"TEST-ESTG-N-missing-{self.s}"
        with self.assertRaisesRegex(frappe.LinkValidationError, "Could not find BOQ Line Item"):
            estimate_writes.save_estimate(boq_node=missing, items=[self._row()])
        frappe.db.rollback()
        self.assertFalse(frappe.db.exists(DOCTYPE, {"boq_node": missing}))

    def test_one_line_holds_one_estimate(self):
        # The controller refuses a second estimate on a line (a plain insert, past save_estimate's lookup) ...
        self._save("cur15", [self._row()])
        with self.assertRaisesRegex(frappe.ValidationError, "already has an estimate"):
            frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes["cur15"], "items": [self._row(quantity=9)]}).insert()
        frappe.db.rollback()
        self.assertEqual(frappe.db.count(DOCTYPE, {"boq_node": self.nodes["cur15"]}), 1)
        # ... and the database does too, for two first saves racing past that check at the same moment.
        unique = frappe.db.sql(
            """select indexdef from pg_indexes where tablename = 'tabBOQ Line Estimate'
               and indexdef ilike 'create unique index%%' and indexdef ilike '%%(boq_node)%%'""")
        self.assertTrue(unique, "no unique index on boq_node")

    # --- read-only projects ----------------------------------------------------------------------------------------

    def test_a_read_only_project_refuses_every_change_but_still_reads(self):
        self.addCleanup(self._set_project_status, "WIP")
        saved = self._save("cur15", [self._row(quantity=5)])
        waiting = self._older("old16", [self._row(self.item_nos, quantity=2)])  # same row and text: can be copied
        frappe.db.commit()
        for status in ("Completed", "Handover"):
            with self.subTest(status=status):
                self._set_project_status(status)
                message = f"read-only on a {status} project"
                for call in (
                    lambda: self._save("cur15", [self._row(quantity=1)], saved["modified"]),  # change
                    lambda: self._save("cur15", [], saved["modified"]),  # delete through the endpoint
                    lambda: frappe.delete_doc(DOCTYPE, saved["name"]),  # delete as /api/resource does
                    lambda: self._save("cur17", [self._row()]),  # add
                    lambda: estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name,
                                                         estimates=[waiting]),  # Remove from the notice
                ):
                    with self.assertRaisesRegex(frappe.ValidationError, message):
                        call()
                    frappe.db.rollback()
                # Re-attach copies nothing and says why, per estimate.
                frappe.local.message_log = []
                out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
                self.assertEqual(out["copied"], 0)
                self.assertEqual([f["estimate"] for f in out["failed"]], [waiting])
                self.assertIn(message, out["failed"][0]["reason"])
                # Reads still work, and nothing moved.
                got = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)
                self.assertEqual([e["name"] for e in got["current"]], [saved["name"]])
                self.assertEqual({e["name"]: e["state"] for e in got["older"]}, {waiting: "can_copy"})
                self.assertEqual([i.quantity for i in self._items("cur15")], [5])
                self.assertIsNone(self._estimate("cur17"))
                self.assertIsNone(self._estimate("cur16"))
                self.assertEqual(frappe.db.get_value(DOCTYPE, waiting, "settled"), 0)

    # --- rows ------------------------------------------------------------------------------------------------------

    def test_invalid_rows_are_refused_with_their_row_number(self):
        refused = (
            ([self._row(quantity=0)], "Row 1: Enter a quantity above 0"),
            ([self._row(quantity=-2)], "Row 1: Enter a quantity above 0"),
            ([self._row(quantity="abc")], "Row 1: Enter a quantity above 0"),
            ([self._row(self.item_nos, quantity=2.5)], "Row 1: NOS is counted in whole numbers"),
            ([self._row(), self._custom(quantity=1.5)], "Row 2: NOS is counted in whole numbers"),
            ([self._row(item_type="Other")], "Row 1: Choose Normal or Custom"),
            ([{"item_type": "Normal", "quantity": 1}], "Row 1: Pick an item from the Items list"),
            ([self._custom(item_id=self.item_sqm)], "Row 1: A custom item cannot point to an Items record"),
            ([self._custom(name="  ")], "Row 1: Type the custom item's name"),
            ([self._custom(unit="")], "Row 1: Choose the custom item's unit"),
            ([self._custom(category=None)], "Row 1: Choose the custom item's category"),
            ([self._row(make="Made-up make"), self._row(make="Made-up make", quantity=1)], "twice with the same make"),
            ([self._custom(name="Made-up clip"), self._custom(name=" made-up CLIP ")], "custom item .* twice"),
        )
        for rows, message in refused:
            with self.subTest(message=message):
                with self.assertRaisesRegex(frappe.ValidationError, message):
                    self._save("cur16", rows)
                frappe.db.rollback()
                self.assertIsNone(self._estimate("cur16"))
        # The same item with two makes, and the same custom name in two units, are accepted.
        saved = self._save("cur16", [self._row(make="Made-up make A"), self._row(make="Made-up make B"),
                                     self._custom(unit="NOS"), self._custom(unit="Sqm", quantity=1.5)])
        self.assertEqual(saved["item_count"], 4)

    def test_the_server_fills_copied_fields_and_ignores_forged_ones(self):
        self._save("cur15", [self._row(make="Made-up make"),
                             self._custom(name="  Made-up clip  ", make="Made-up make that must go")])
        normal, custom = self._items("cur15")
        self.assertEqual((normal.item_name, normal.unit, normal.category, normal.procurement_package, normal.make),
                         ("Made-up panel", "sqm", self.category, self.package, "Made-up make"))
        self.assertEqual((custom.item_name, custom.make, custom.procurement_package), ("Made-up clip", None, self.package))
        est = frappe.db.get_value(DOCTYPE, {"boq_node": self.nodes["cur15"]},
                                  ["boq", "boq_sheet", "item_count", "settled"], as_dict=True)
        self.assertEqual((est.boq, est.boq_sheet, est.item_count, est.settled), (self.boq, self.sheet_cur, 2, 0))

        # Pointing a saved Normal row at another item takes that item's name, unit and category.
        est = self._estimate("cur15")
        moved = {"name": normal.name, "item_type": "Normal", "item_id": self.item_b, "quantity": 3}
        self._save("cur15", [moved, dict(custom)], str(est.modified))
        normal, _custom = self._items("cur15")
        self.assertEqual((normal.item_id, normal.item_name, normal.unit), (self.item_b, "Made-up board", "Nos"))

        # A plain insert naming a BOQ that does not exist is refused (Frappe's link check) ...
        with self.assertRaises(frappe.LinkValidationError):
            frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes["cur17"], "boq": f"TEST-ESTG-FORGED-{self.s}",
                            "items": [self._row()]}).insert()
        frappe.db.rollback()
        self.assertIsNone(self._estimate("cur17"))
        # ... and one naming another real BOQ and an older sheet gets the line's own BOQ and sheet, and a true count.
        doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes["cur17"], "boq": self.other_boq,
                              "boq_sheet": self.sheet_old, "settled": 0, "item_count": 99,
                              "items": [self._row()]})
        doc.insert()
        frappe.db.commit()
        self.assertEqual((doc.boq, doc.boq_sheet, doc.item_count), (self.boq, self.sheet_cur, 1))

    # --- malformed requests ----------------------------------------------------------------------------------------

    def test_malformed_requests_are_refused_or_harmless(self):
        refused = (
            (lambda: estimate_writes.save_estimate(boq_node=None, items=[self._row()]), "boq_node is required"),
            (lambda: estimate_writes.reattach_estimates(boq=self.boq, sheet_name=None), "boq and sheet_name are required"),
            (lambda: estimate_writes.settle_older(boq=None, sheet_name=self.sheet_name, estimates="[]"),
             "boq and sheet_name are required"),
            (lambda: boq_view.get_estimates_overview(project=None), "project is required"),
            (lambda: boq_view.get_estimates(boq=None), "boq is required"),
            # The browser loaded an estimate that someone deleted meanwhile.
            (lambda: self._save("cur17", [self._row()], "2026-01-01 00:00:00.000000"), "was deleted while you had it open"),
        )
        for call, message in refused:
            with self.subTest(message=message):
                with self.assertRaisesRegex(frappe.ValidationError, message):
                    call()
                frappe.db.rollback()
        # An empty save on a line with no estimate writes nothing, as a list or as JSON text.
        for empty in ([], "[]", None):
            self.assertEqual(self._save("cur17", empty), {"deleted": True})
        self.assertIsNone(self._estimate("cur17"))
        # Rows sent as JSON text are read like a list.
        self.assertEqual(self._save("cur17", json.dumps([self._row()]))["item_count"], 1)
        # Remove takes a JSON list of names too.
        waiting = self._older("old16", [self._row(self.item_nos, quantity=2)])
        frappe.db.commit()
        out = estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name, estimates=json.dumps([waiting]))
        self.assertEqual(out, {"settled": 1})
        # A name that is not one of this sheet's waiting estimates is ignored.
        out = estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name,
                                           estimates=[f"TEST-ESTG-NOT-AN-ESTIMATE-{self.s}"])
        self.assertEqual(out, {"settled": 0})

    # --- the after-commit copy -------------------------------------------------------------------------------------

    def test_the_copy_job_logs_what_it_could_not_copy_and_is_safe_to_run_twice(self):
        good = self._older("old15", [self._row(quantity=7)])
        bad = self._older("old16", [self._custom(quantity=2.5)])  # 2.5 NOS: refused by today's rule
        frappe.db.commit()
        with patch("frappe.log_error") as log_error:
            out = estimate_writes.copy_estimates_after_commit(self.boq, self.sheet_name)
        self.assertEqual((out["copied"], [f["estimate"] for f in out["failed"]]), (1, [bad]))
        log_error.assert_called_once()
        self.assertIn(bad, log_error.call_args.kwargs["message"])
        self.assertEqual([i.quantity for i in self._items("cur15")], [7])
        self.assertEqual(frappe.db.get_value(DOCTYPE, good, "settled"), 1)
        self.assertEqual(frappe.db.get_value(DOCTYPE, bad, "settled"), 0)
        sheet = boq_view.get_estimates_overview(project=self.project)["boqs"][0]["sheets"][0]
        self.assertEqual(sheet["older"], 1)  # the settled one is no longer counted

        # Run again (a second commit of another sheet, a retry): nothing is copied twice.
        with patch("frappe.log_error"):
            again = estimate_writes.copy_estimates_after_commit(self.boq, self.sheet_name)
        self.assertEqual(again["copied"], 0)
        self.assertEqual(frappe.db.count(DOCTYPE, {"boq_node": self.nodes["cur15"]}), 1)
        self.assertIsNone(self._estimate("cur16"))

    def test_a_committed_sheet_queues_the_copy_through_the_real_hook(self):
        hooks = frappe.get_hooks("doc_events")
        self.assertIn(controller.__name__ + ".queue_copy_after_commit", hooks["BoQ Sheet"]["after_insert"])
        self.assertIn(controller.__name__ + ".validate", hooks[DOCTYPE]["validate"])
        self.assertIn(controller.__name__ + ".on_trash", hooks[DOCTYPE]["on_trash"])
        self._save("cur15", [self._row()])  # the BOQ has an estimate now

        def sheet(name, **over):
            values = dict({"doctype": "BoQ Sheet", "boq": self.boq, "sheet_name": "Made-up guard sheet 2",
                           "is_current": 1, "commit_version": 0, "treat_as": "data", "sheet_order": 99}, **over)
            self.created["BoQ Sheet"].append(name)
            return frappe.get_doc(values).insert(set_name=name)

        with patch("frappe.enqueue") as enqueue:
            sheet(f"TEST-ESTG-SHN-{self.s}")
            enqueue.assert_called_once_with(controller.COPY_AFTER_COMMIT_JOB, queue="default",
                                            enqueue_after_commit=True, boq=self.boq,
                                            sheet_name="Made-up guard sheet 2")
            enqueue.reset_mock()
            sheet(f"TEST-ESTG-SHF-{self.s}", is_current=0)  # a frozen version
            sheet(f"TEST-ESTG-SHM-{self.s}", treat_as="master_preamble",
                  sheet_name="Made-up guard specs")  # a specs sheet (one current sheet per name: uq_boq_sheet_current)
            enqueue.assert_not_called()
        frappe.db.rollback()  # the inserted sheets are not kept

    # --- deletes elsewhere -----------------------------------------------------------------------------------------

    def test_an_estimate_never_blocks_deleting_its_line_sheet_or_boq(self):
        # Frappe's link check only, nothing is deleted. A line item, a sheet and a BOQ that only an estimate points
        # at pass it; with "BOQ Line Estimate" left out of `ignore_links_on_delete` the same check refuses all three,
        # so the hook entry is what keeps a BOQ delete unchanged.
        boq_x, sheet_x, node_x = (f"TEST-ESTG-{k}X-{self.s}" for k in ("BOQ", "SH", "N"))
        lone_name = f"TEST-ESTG-E-lone-{self.s}"

        def drop_lone():
            # Its own clean-up, by name: the lone estimate's BOQ is not this module's BOQ, so `_purge` would miss it.
            frappe.db.rollback()
            for doctype, name in ((DOCTYPE, lone_name), ("BOQ Nodes", node_x), ("BoQ Sheet", sheet_x), ("BOQs", boq_x)):
                frappe.db.delete(doctype, {"name": name})
            frappe.db.commit()

        self.addCleanup(drop_lone)
        self.created["BOQs"].append(boq_x)  # and in the class clean-up, should this test stop half-way
        self.created["BoQ Sheet"].append(sheet_x)
        self.created["BOQ Nodes"].append(node_x)
        frappe.get_doc({"doctype": "BOQs", "name": boq_x, "project": self.project, "boq_name": "Made-up lone BOQ",
                        "status": "Draft"}).db_insert()
        frappe.get_doc({"doctype": "BoQ Sheet", "name": sheet_x, "boq": self.boq, "sheet_name": "Made-up lone sheet",
                        "is_current": 0, "treat_as": "data"}).db_insert()
        frappe.get_doc({"doctype": "BOQ Nodes", "name": node_x, "boq": self.boq, "sheet": self.sheet_cur,
                        "is_current": 0, "source_row_number": 99, "node_type": "Line Item",
                        "description": "Made-up lone line"}).db_insert()
        lone = frappe.get_doc({"doctype": DOCTYPE, "boq_node": node_x, "boq": boq_x, "boq_sheet": sheet_x})
        lone.name = lone_name
        lone.db_insert()
        frappe.db.commit()

        targets = (("BOQ Nodes", node_x), ("BoQ Sheet", sheet_x), ("BOQs", boq_x))
        for doctype, name in targets:
            check_if_doc_is_linked(frappe.get_doc(doctype, name))  # no LinkExistsError

        real_get_hooks = frappe.get_hooks

        def without_estimates(hook=None, *args, **kwargs):
            value = real_get_hooks(hook, *args, **kwargs)
            return [v for v in value if v != DOCTYPE] if hook == "ignore_links_on_delete" else value

        with patch("frappe.get_hooks", side_effect=without_estimates):
            for doctype, name in targets:
                with self.subTest(doctype=doctype), self.assertRaises(frappe.LinkExistsError):
                    check_if_doc_is_linked(frappe.get_doc(doctype, name))
        frappe.local.message_log = []

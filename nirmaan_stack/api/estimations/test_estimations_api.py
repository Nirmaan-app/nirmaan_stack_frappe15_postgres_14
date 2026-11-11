"""The Estimates tab API (api/estimations): the overview and estimate reads, save, and re-attach.

Fixtures are invented and written with bare `db_insert` (no BOQ controllers run), on the live dev site like every
suite here, so the clean-up rolls back first, then deletes each scope in its own try, and commits.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.estimations import boq_view, estimate_writes

DOCTYPE = "BOQ Line Estimate"
EDIT_PROFILE = "Nirmaan Estimates Executive Profile"
EDIT_ROLE = "Nirmaan Estimates Executive"


class TestEstimationsApi(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        s = frappe.generate_hash(length=6)
        cls.s = s
        cls.project = f"TEST-EST-PRJ-{s}"
        cls.other_project = f"TEST-EST-PRJ2-{s}"
        cls.boq = f"TEST-EST-BOQ-{s}"
        cls.other_boq = f"TEST-EST-BOQ2-{s}"
        cls.sheet_name = "Made-up HVAC sheet  "  # trailing spaces on purpose: matched verbatim, never trimmed
        cls.sheet_v0 = f"TEST-EST-SH0-{s}"
        cls.sheet_v1 = f"TEST-EST-SH1-{s}"
        cls.sheet_v2 = f"TEST-EST-SH2-{s}"
        cls.item = f"TEST-EST-ITEM-{s}"
        cls.category = f"TEST-EST-CAT-{s}"  # its own record, never "any Category row" (residence rule T1)
        cls.created = {"Projects": [], "BOQs": [], "BoQ Sheet": [], "BOQ Nodes": [], "Items": [], "Category": []}

        def put(doctype, values):
            doc = frappe.get_doc(dict(values, doctype=doctype))
            doc.db_insert()
            cls.created[doctype].append(doc.name)

        put("Projects", {"name": cls.project, "project_name": f"Made-up project {s}", "status": "WIP"})
        put("Projects", {"name": cls.other_project, "project_name": f"Made-up other project {s}", "status": "WIP"})
        put("BOQs", {"name": cls.boq, "project": cls.project, "boq_name": "Made-up BOQ", "status": "Selected"})
        put("BOQs", {"name": cls.other_boq, "project": cls.project, "boq_name": "Made-up draft", "status": "Draft"})
        put("BoQ Sheet", {"name": cls.sheet_v0, "boq": cls.boq, "sheet_name": cls.sheet_name, "is_current": 0,
                          "commit_version": 0, "treat_as": "data"})
        put("BoQ Sheet", {"name": cls.sheet_v1, "boq": cls.boq, "sheet_name": cls.sheet_name, "is_current": 0,
                          "commit_version": 1, "treat_as": "data"})
        put("BoQ Sheet", {"name": cls.sheet_v2, "boq": cls.boq, "sheet_name": cls.sheet_name, "is_current": 1,
                          "commit_version": 2, "treat_as": "data"})
        cls.nodes = {}
        for key, sheet, current, row, ntype, desc in (
            ("v0_15", cls.sheet_v0, 0, 15, "Line Item", "Made-up plenum"),
            ("old15", cls.sheet_v1, 0, 15, "Line Item", "Made-up plenum"),
            ("old16", cls.sheet_v1, 0, 16, "Line Item", "Made-up diffuser"),
            ("new15", cls.sheet_v2, 1, 15, "Line Item", "Made-up plenum"),
            ("new16", cls.sheet_v2, 1, 16, "Line Item", "Made-up diffuser, revised"),
            ("head", cls.sheet_v2, 1, 13, "Preamble", "MADE-UP HEADING"),
        ):
            name = f"TEST-EST-N-{key}-{s}"
            put("BOQ Nodes", {"name": name, "boq": cls.boq, "sheet": sheet, "is_current": current,
                              "source_row_number": row, "node_type": ntype, "description": desc, "qty": 10,
                              "unit": "Sqm", "sort_order": row})
            cls.nodes[key] = name
        put("Category", {"name": cls.category, "category_name": cls.category})
        put("Items", {"name": cls.item, "item_name": "Made-up panel", "unit_name": "sqm", "category": cls.category})
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        problems = []
        try:
            names = frappe.get_all(DOCTYPE, filters={"boq": ["in", [cls.boq, cls.other_boq]]}, pluck="name")
            names += frappe.get_all(DOCTYPE, filters={"boq_node": ["in", list(cls.nodes.values())]}, pluck="name")
            if names:
                frappe.db.delete("BOQ Line Estimate Item", {"parent": ["in", names]})
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

    def tearDown(self):
        frappe.set_user("Administrator")

    def _row(self, **over):
        row = {"item_type": "Normal", "item_id": self.item, "quantity": 12}
        row.update(over)
        return row

    def _scoped_user(self, *projects):
        """A throwaway user with the Estimates Executive role whose Projects User Permissions allow only `projects`.

        Written straight to the tables (`db_insert`), as `test_snag_api._restricted_user` does: a normal User or
        User Permission insert runs our hooks (a Nirmaan Users profile, a mirror row). The role profile is patched
        in each test (`get_role_profile`), so no Nirmaan Users row is needed. Caches are dropped on the way in and out.
        """
        user = f"est-scope-{frappe.generate_hash(length=8)}@example.com"

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

        bare({"doctype": "User", "email": user, "first_name": "Estimates scope test", "enabled": 1,
              "user_type": "System User", "send_welcome_email": 0}, user)
        bare({"doctype": "Has Role", "parent": user, "parenttype": "User", "parentfield": "roles", "idx": 1,
              "role": EDIT_ROLE}, f"est-scope-{frappe.generate_hash(length=10)}")
        for project in projects:
            bare({"doctype": "User Permission", "user": user, "allow": "Projects", "for_value": project,
                  "apply_to_all_doctypes": 1}, f"est-scope-{frappe.generate_hash(length=10)}")
        frappe.db.commit()
        frappe.cache.hdel("user_permissions", user)
        frappe.clear_cache(user=user)
        return user

    def _estimate_on(self, node):
        return frappe.db.get_value(DOCTYPE, {"boq_node": node}, ["name", "modified"], as_dict=True)

    def _purge(self):
        frappe.db.rollback()
        names = frappe.get_all(DOCTYPE, filters={"boq_node": ["in", list(self.nodes.values())]}, pluck="name")
        if names:
            frappe.db.delete("BOQ Line Estimate Item", {"parent": ["in", names]})
            frappe.db.delete(DOCTYPE, {"name": ["in", names]})
        frappe.db.commit()

    def test_overview_counts_line_items_estimates_and_older_versions(self):
        self.addCleanup(self._purge)
        out = boq_view.get_estimates_overview(project=self.project)
        self.assertEqual([b["name"] for b in out["boqs"]], [self.boq])  # the Draft BOQ is not listed (Q3)
        sheet = out["boqs"][0]["sheets"][0]
        self.assertEqual((sheet["name"], sheet["sheet_name"], sheet["line_items"], sheet["estimated"], sheet["older"]),
                         (self.sheet_v2, self.sheet_name, 2, 0, 0))
        estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row()])
        sheet = boq_view.get_estimates_overview(project=self.project)["boqs"][0]["sheets"][0]
        self.assertEqual(sheet["estimated"], 1)

    def test_save_creates_reads_updates_and_deletes(self):
        self.addCleanup(self._purge)
        saved = estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row()])
        self.assertEqual(saved["item_count"], 1)
        got = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual(len(got["current"]), 1)
        entry = got["current"][0]
        self.assertEqual((entry["line"]["excel_row"], entry["items"][0]["item_name"], entry["items"][0]["unit"]),
                         (15, "Made-up panel", "sqm"))

        # The Items record is renamed; re-saving the same row keeps the name copied when it was added.
        frappe.db.set_value("Items", self.item, "item_name", "Made-up panel, renamed")
        frappe.db.commit()
        row = dict(entry["items"][0], quantity=20)
        saved = estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[row],
                                              expected_modified=entry["modified"])
        items = boq_view.get_estimates(boq=self.boq)["current"][0]["items"]
        self.assertEqual((items[0]["item_name"], items[0]["quantity"]), ("Made-up panel", 20))
        frappe.db.set_value("Items", self.item, "item_name", "Made-up panel")
        frappe.db.commit()

        # A stale save (someone saved in between) is refused and changes nothing.
        with self.assertRaisesRegex(frappe.ValidationError, "Someone else changed"):
            estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row(quantity=1)],
                                          expected_modified=entry["modified"])
        frappe.db.rollback()

        # An empty list deletes the estimate.
        out = estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[], expected_modified=saved["modified"])
        self.assertEqual(out, {"deleted": True})
        self.assertIsNone(self._estimate_on(self.nodes["new15"]))

    def _older(self, key, sheet, qty, name=None, stamp=None):
        """An estimate left on an older version, with one material row (written bare: the controller refuses an
        older line item)."""
        name = name or f"TEST-EST-E-{key}-{self.s}"
        doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes[key], "boq": self.boq, "boq_sheet": sheet,
                              "item_count": 1})
        doc.name = name
        if stamp:
            doc.creation = doc.modified = stamp
        doc.db_insert()
        row = frappe.get_doc({"doctype": "BOQ Line Estimate Item", "parent": name, "parenttype": DOCTYPE,
                              "parentfield": "items", "idx": 1, "item_type": "Normal", "item_id": self.item,
                              "item_name": "Made-up panel", "unit": "sqm", "quantity": qty, "category": self.category})
        row.name = f"{name}-r1"
        row.db_insert()
        return name

    def _older_states(self):
        older = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["older"]
        return {e["name"]: e["state"] for e in older}

    def _on(self, key):
        got = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["current"]
        return [[i["quantity"] for i in e["items"]] for e in got if e["boq_node"] == self.nodes[key]]

    def test_reattach_copies_unchanged_lines_keeps_the_older_ones_and_lists_changed_ones(self):
        self.addCleanup(self._purge)
        e15, e16 = self._older("old15", self.sheet_v1, 12), self._older("old16", self.sheet_v1, 5)
        frappe.db.commit()
        self.assertEqual(boq_view.get_estimates_overview(project=self.project)["boqs"][0]["sheets"][0]["older"], 2)
        self.assertEqual(self._older_states(), {e15: "can_copy", e16: "changed"})  # row 16's text changed

        out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual(out["copied"], 1)
        self.assertEqual([u["excel_row"] for u in out["unmatched"]], [16])  # listed, never guessed
        self.assertEqual(self._on("new15"), [[12]])  # the copy on the current version
        self.assertEqual(frappe.db.get_value(DOCTYPE, e15, "boq_node"), self.nodes["old15"])  # the backup stays
        self.assertEqual(self._older_states(), {e15: "copied", e16: "changed"})

        # A second Re-attach has nothing left to copy; the trimmed sheet name finds nothing (matched verbatim).
        self.assertEqual(estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)["copied"], 0)
        self.assertEqual(estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name.strip()),
                         {"copied": 0, "unmatched": []})

    def test_undo_removes_the_copy_but_never_an_edited_one(self):
        self.addCleanup(self._purge)
        e15 = self._older("old15", self.sheet_v1, 12)
        frappe.db.commit()
        estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual(estimate_writes.undo_reattach(boq=self.boq, sheet_name=self.sheet_name),
                         {"undone": 1, "skipped": []})
        self.assertEqual(self._on("new15"), [])
        self.assertEqual(self._older_states(), {e15: "can_copy"})  # back to waiting, the backup untouched

        # Copied again, then edited on the current version: Undo would lose the edit, so it is refused.
        estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        copy = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["current"][0]
        estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[dict(copy["items"][0], quantity=20)],
                                      expected_modified=copy["modified"])
        self.assertEqual(self._older_states(), {e15: "copied_edited"})
        self.assertEqual(estimate_writes.undo_reattach(boq=self.boq, sheet_name=self.sheet_name, estimates=[e15]),
                         {"undone": 0, "skipped": [e15]})
        self.assertEqual(self._on("new15"), [[20]])

    def test_remove_old_deletes_backups_and_keeps_the_copies(self):
        self.addCleanup(self._purge)
        e15, e16 = self._older("old15", self.sheet_v1, 12), self._older("old16", self.sheet_v1, 5)
        frappe.db.commit()
        estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        # "Remove all old" takes the copied backups only; the changed row still needs a person.
        self.assertEqual(estimate_writes.remove_older(boq=self.boq, sheet_name=self.sheet_name), {"removed": 1})
        self.assertIsNone(frappe.db.exists(DOCTYPE, e15))
        self.assertEqual(self._on("new15"), [[12]])
        self.assertEqual(self._older_states(), {e16: "changed"})
        # Remove on one row takes that row, whatever its state.
        self.assertEqual(estimate_writes.remove_older(boq=self.boq, sheet_name=self.sheet_name, estimates=[e16]),
                         {"removed": 1})
        self.assertEqual(self._older_states(), {})

    def test_reattach_copies_the_newest_estimate_when_two_want_one_line(self):
        # Committed twice without a Re-attach: one estimate on version 0's row 15, a later one on version 1's row 15.
        # Re-attach copies the version-1 one (qty 10) to the current row 15; the version-0 one (qty 6) is listed.
        # Names are chosen so the OLDER estimate sorts first by name: only the newest-first rule can pick the other.
        self.addCleanup(self._purge)
        stale = self._older("v0_15", self.sheet_v0, 6, name=f"TEST-EST-E-A-stale-{self.s}", stamp="2026-11-01 10:00:00")
        latest = self._older("old15", self.sheet_v1, 10, name=f"TEST-EST-E-Z-latest-{self.s}", stamp="2026-11-05 10:00:00")
        frappe.db.commit()

        out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual(out["copied"], 1)
        self.assertEqual(self._on("new15"), [[10]])
        self.assertEqual([u["estimate"] for u in out["unmatched"]], [stale])
        self.assertEqual(self._older_states(), {stale: "changed", latest: "copied"})

    def test_an_estimate_whose_line_was_deleted_is_listed_never_hidden(self):
        # An estimate never blocks deleting a BOQ line item or sheet (hooks.py `ignore_links_on_delete`). Once its line
        # is gone the estimate must still be listed ("line missing") and removable, never vanish from every view.
        # A: its old line is deleted, its sheet stays. B: its line and its sheet are both gone (no sheet name).
        self.addCleanup(self._purge)
        gone_sheet = f"TEST-EST-SHX-{self.s}"
        for key, sheet in (("goneA", self.sheet_v1), ("goneB", gone_sheet)):
            name = f"TEST-EST-N-{key}-{self.s}"
            frappe.get_doc({"doctype": "BOQ Nodes", "name": name, "boq": self.boq, "sheet": sheet, "is_current": 0,
                            "source_row_number": 20, "node_type": "Line Item", "description": "Made-up damper",
                            "qty": 2, "unit": "Nos", "sort_order": 20}).db_insert()
            self.created["BOQ Nodes"].append(name)
            self.nodes[key] = name
        a, b = self._older("goneA", self.sheet_v1, 3), self._older("goneB", gone_sheet, 4)
        frappe.db.delete("BOQ Nodes", {"name": ["in", [self.nodes["goneA"], self.nodes["goneB"]]]})
        frappe.db.commit()

        older = {e["name"]: e for e in boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["older"]}
        self.assertEqual({n: e["state"] for n, e in older.items()}, {a: "line_missing", b: "line_missing"})
        self.assertEqual((older[a]["line"]["sheet_name"], older[b]["line"]["sheet_name"]), (self.sheet_name, None))
        self.assertEqual([i["quantity"] for i in older[a]["items"]], [3])  # its materials still show
        self.assertEqual(boq_view.get_estimates(boq=self.boq)["current"], [])  # never counted as current
        # B (no sheet name) is listed on every sheet; A only on its own.
        other = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name.strip())["older"]
        self.assertEqual([e["name"] for e in other], [b])
        self.assertEqual(boq_view.get_estimates_overview(project=self.project)["boqs"][0]["sheets"][0]["older"], 2)

        # Never copied; listed by Re-attach as needing a person; not a backup, so "Remove all old" leaves it.
        out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual((out["copied"], sorted(u["estimate"] for u in out["unmatched"])), (0, sorted([a, b])))
        self.assertEqual(estimate_writes.remove_older(boq=self.boq, sheet_name=self.sheet_name), {"removed": 0})
        # Remove on the row deletes it.
        self.assertEqual(estimate_writes.remove_older(boq=self.boq, sheet_name=self.sheet_name, estimates=[a, b]),
                         {"removed": 2})
        self.assertEqual(self._older_states(), {})

    def test_a_draft_boq_reads_empty(self):
        self.assertEqual(boq_view.get_estimates(boq=self.other_boq), {"current": [], "older": []})

    def test_a_save_on_a_draft_boq_is_refused(self):
        # The screens show Selected BOQs only; the server refuses a save through the API on any other (review issue 5).
        self.addCleanup(self._purge)
        name = f"TEST-EST-N-draft15-{self.s}"
        frappe.get_doc({"doctype": "BOQ Nodes", "name": name, "boq": self.other_boq, "sheet": f"TEST-EST-SHD-{self.s}",
                        "is_current": 1, "source_row_number": 15, "node_type": "Line Item",
                        "description": "Made-up plenum", "qty": 10, "unit": "Sqm", "sort_order": 15}).db_insert()
        self.created["BOQ Nodes"].append(name)
        self.nodes["draft15"] = name
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "only be saved on a Selected BOQ. This BOQ is Draft"):
            estimate_writes.save_estimate(boq_node=name, items=[self._row()])
        frappe.db.rollback()
        self.assertIsNone(self._estimate_on(name))
        # The same line on the Selected BOQ saves as before.
        self.assertEqual(estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row()])["item_count"], 1)

    def test_guest_can_neither_read_nor_save(self):
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            boq_view.get_estimates_overview(project=self.project)
        with self.assertRaises(frappe.PermissionError):
            estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row()])
        with self.assertRaises(frappe.PermissionError):
            estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        with self.assertRaises(frappe.PermissionError):
            estimate_writes.undo_reattach(boq=self.boq, sheet_name=self.sheet_name)
        with self.assertRaises(frappe.PermissionError):
            estimate_writes.remove_older(boq=self.boq, sheet_name=self.sheet_name)

    def test_project_access_limits_reads_and_writes(self):
        # Same role and profile, different User Permissions: the user allowed on the project reads and saves; the
        # user allowed only on another project gets nothing and changes nothing (reads, save, delete, re-attach).
        self.addCleanup(self._purge)
        insider = self._scoped_user(self.project)
        outsider = self._scoped_user(self.other_project)
        with patch("nirmaan_stack.services.role_profiles.get_role_profile", return_value=EDIT_PROFILE):
            frappe.set_user(insider)
            self.assertEqual([b["name"] for b in boq_view.get_estimates_overview(project=self.project)["boqs"]],
                             [self.boq])
            saved = estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row()])
            self.assertEqual(len(boq_view.get_estimates(boq=self.boq)["current"]), 1)

            frappe.set_user(outsider)
            with self.assertRaises(frappe.PermissionError):
                boq_view.get_estimates_overview(project=self.project)
            with self.assertRaises(frappe.PermissionError):
                boq_view.get_estimates(boq=self.boq)
            with self.assertRaises(frappe.PermissionError):
                estimate_writes.save_estimate(boq_node=self.nodes["new16"], items=[self._row()])
            frappe.db.rollback()
            with self.assertRaises(frappe.PermissionError):
                estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row(quantity=1)],
                                              expected_modified=saved["modified"])
            frappe.db.rollback()
            with self.assertRaises(frappe.PermissionError):
                estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[],
                                              expected_modified=saved["modified"])
            frappe.db.rollback()
            with self.assertRaises(frappe.PermissionError):
                estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        frappe.set_user("Administrator")
        self.assertIsNone(self._estimate_on(self.nodes["new16"]))
        items = boq_view.get_estimates(boq=self.boq)["current"][0]["items"]
        self.assertEqual([i["quantity"] for i in items], [12])  # the refused update and delete changed nothing

    def test_a_saved_normal_row_keeps_its_name_unit_and_category(self):
        # A request that sends another name, unit or category for a saved Normal row (same item) is not believed:
        # the saved values stay, so the whole-number rule and the material totals see the real unit.
        self.addCleanup(self._purge)
        estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row()])
        entry = boq_view.get_estimates(boq=self.boq)["current"][0]
        forged = dict(entry["items"][0], item_name="Forged name", unit="KGS", category=None, quantity=2.5)
        estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[forged], expected_modified=entry["modified"])
        item = boq_view.get_estimates(boq=self.boq)["current"][0]["items"][0]
        self.assertEqual((item["item_name"], item["unit"], item["category"], item["quantity"]),
                         ("Made-up panel", "sqm", self.category, 2.5))

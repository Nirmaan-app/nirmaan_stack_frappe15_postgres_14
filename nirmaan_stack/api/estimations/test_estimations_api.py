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

    def test_one_refused_copy_does_not_stop_the_rest_of_reattach(self):
        # Review issue 4: each copy is saved on its own. Row 18's older estimate holds 2.5 of a NOS custom item (saved
        # before the whole-number rule, say); its copy is refused and listed with the reason, row 15 is still copied.
        created = []

        def drop_nodes():
            frappe.db.rollback()
            frappe.db.delete("BOQ Nodes", {"name": ["in", created]})
            frappe.db.commit()

        self.addCleanup(drop_nodes)
        self.addCleanup(self._purge)  # runs first: the estimates, then their nodes
        for key, sheet, current in (("old18", self.sheet_v1, 0), ("new18", self.sheet_v2, 1)):
            name = f"TEST-EST-N-{key}-{self.s}"
            frappe.get_doc({"doctype": "BOQ Nodes", "name": name, "boq": self.boq, "sheet": sheet, "is_current": current,
                            "source_row_number": 18, "node_type": "Line Item", "description": "Made-up grille",
                            "qty": 3, "unit": "Nos", "sort_order": 18}).db_insert()
            created.append(name)
            self.nodes[key] = name
        good = self._older("old15", self.sheet_v1, 12)
        bad = f"TEST-EST-E-old18-{self.s}"
        doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": self.nodes["old18"], "boq": self.boq,
                              "boq_sheet": self.sheet_v1, "item_count": 1})
        doc.name = bad
        doc.db_insert()
        row = frappe.get_doc({"doctype": "BOQ Line Estimate Item", "parent": bad, "parenttype": DOCTYPE,
                              "parentfield": "items", "idx": 1, "item_type": "Custom", "item_name": "Made-up clip",
                              "unit": "NOS", "quantity": 2.5, "category": self.category})
        row.name = f"{bad}-r1"
        row.db_insert()
        frappe.db.commit()
        self.assertEqual(self._older_states(), {good: "can_copy", bad: "can_copy"})

        frappe.local.message_log = []  # earlier tests in this process leave their thrown messages here
        out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual(out["copied"], 1)
        self.assertEqual([(f["estimate"], f["excel_row"]) for f in out["failed"]], [(bad, 18)])
        self.assertIn("whole numbers", out["failed"][0]["reason"])
        self.assertEqual(self._on("new15"), [[12]])  # the good one was copied (and is history now, not listed)
        self.assertEqual(self._on("new18"), [])  # the refused one was not
        self.assertEqual(self._older_states(), {bad: "can_copy"})  # still there to fix or remove
        self.assertEqual(frappe.local.message_log, [])  # reported in the reply, not as an error message

    def test_reattach_copies_unchanged_lines_keeps_history_and_lists_changed_ones(self):
        # Owner 2026-11-12: copied, not moved -- the BOQ keeps every version, and so does each version's estimate.
        self.addCleanup(self._purge)
        e15, e16 = self._older("old15", self.sheet_v1, 12), self._older("old16", self.sheet_v1, 5)
        frappe.db.commit()
        self.assertEqual(boq_view.get_estimates_overview(project=self.project)["boqs"][0]["sheets"][0]["older"], 2)
        self.assertEqual(self._older_states(), {e15: "can_copy", e16: "changed"})  # row 16's text changed

        out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual(out["copied"], 1)
        self.assertEqual([u["excel_row"] for u in out["unmatched"]], [16])  # listed, never guessed
        self.assertEqual(self._on("new15"), [[12]])  # the copy on the current version
        self.assertEqual(frappe.db.get_value(DOCTYPE, e15, ["boq_node", "settled"]), (self.nodes["old15"], 1))  # kept, settled
        self.assertEqual(self._older_states(), {e16: "changed"})  # history is not listed

        # A second Re-attach has nothing left to copy; the trimmed sheet name finds nothing (matched verbatim).
        self.assertEqual(estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)["copied"], 0)
        self.assertEqual(estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name.strip()),
                         {"copied": 0, "unmatched": [], "failed": []})

    def test_history_is_never_listed_and_remove_settles_only_chosen_ones(self):
        # An older estimate whose line already holds materials (a copy edited since, or typed by hand) is history: not
        # listed, not settled from the notice. Remove settles only chosen estimates that still need a person; "[]"
        # (review issue 1), [], None and "" settle nothing.
        self.addCleanup(self._purge)
        e15, e16 = self._older("old15", self.sheet_v1, 12), self._older("old16", self.sheet_v1, 5)
        frappe.db.commit()
        estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[self._row(quantity=20)])  # typed by hand
        self.assertEqual(self._older_states(), {e16: "changed"})
        for none_chosen in ("[]", [], None, ""):
            self.assertEqual(estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name,
                                                          estimates=none_chosen), {"settled": 0}, none_chosen)
        self.assertEqual(estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name, estimates=[e15]),
                         {"settled": 0})  # history: not listed, so not settled here
        self.assertEqual(estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)["copied"], 0)
        self.assertTrue(frappe.db.exists(DOCTYPE, e15))
        self.assertEqual(self._on("new15"), [[20]])
        self.assertEqual(estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name, estimates=[e16]),
                         {"settled": 1})
        # Option B: settled, not deleted -- kept on its version as history, no longer listed.
        self.assertEqual(frappe.db.get_value(DOCTYPE, e16, "settled"), 1)
        self.assertEqual(self._older_states(), {})

    def test_settling_a_changed_line_never_brings_an_earlier_versions_estimate_back(self):
        # The walk on 12 Nov: row 16 had estimates on v0 and v1 (same text), and its text changed on v2. Resolving the
        # v1 one (Remove, or Add to a line) used to delete it, and then the v0 one came back into the notice. Now it
        # is settled, and the v0 one stays history.
        self.addCleanup(self._purge)
        v0_16 = f"TEST-EST-N-v0_16-{self.s}"
        frappe.get_doc({"doctype": "BOQ Nodes", "name": v0_16, "boq": self.boq, "sheet": self.sheet_v0, "is_current": 0,
                        "source_row_number": 16, "node_type": "Line Item", "description": "Made-up diffuser",
                        "qty": 10, "unit": "Sqm", "sort_order": 16}).db_insert()
        self.created["BOQ Nodes"].append(v0_16)
        self.nodes["v0_16"] = v0_16
        e_v0 = self._older("v0_16", self.sheet_v0, 4, name=f"TEST-EST-E-v0-16-{self.s}", stamp="2026-11-01 10:00:00")
        e_v1 = self._older("old16", self.sheet_v1, 5, name=f"TEST-EST-E-v1-16-{self.s}", stamp="2026-11-05 10:00:00")
        frappe.db.commit()
        self.assertEqual(self._older_states(), {e_v1: "changed"})  # v0's is history: v1's stands for that line

        self.assertEqual(estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name, estimates=[e_v1]),
                         {"settled": 1})
        self.assertEqual(self._older_states(), {})  # v0's does not come back
        self.assertTrue(frappe.db.exists(DOCTYPE, e_v0) and frappe.db.exists(DOCTYPE, e_v1))  # both kept as history

    def test_reattach_copies_the_newest_estimate_when_two_want_one_line(self):
        # Committed twice without a copy in between: one estimate on version 0's row 15, a later one on version 1's.
        # The version-1 one (qty 10) is copied to the current row 15; the version-0 one is history (version 1's stands
        # for that line), so it is neither copied nor listed. Names are chosen so the OLDER estimate sorts first by
        # name: only the newest-first rule can pick the other.
        self.addCleanup(self._purge)
        stale = self._older("v0_15", self.sheet_v0, 6, name=f"TEST-EST-E-A-stale-{self.s}", stamp="2026-11-01 10:00:00")
        latest = self._older("old15", self.sheet_v1, 10, name=f"TEST-EST-E-Z-latest-{self.s}", stamp="2026-11-05 10:00:00")
        frappe.db.commit()
        self.assertEqual(self._older_states(), {latest: "can_copy"})

        out = estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)
        self.assertEqual((out["copied"], out["unmatched"]), (1, []))
        self.assertEqual(self._on("new15"), [[10]])
        self.assertEqual(self._older_states(), {})
        self.assertTrue(frappe.db.exists(DOCTYPE, stale) and frappe.db.exists(DOCTYPE, latest))  # both kept

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
        self.assertEqual(estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name), {"settled": 0})
        # Remove on the row deletes it.
        self.assertEqual(estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name, estimates=[a, b]),
                         {"settled": 2})
        self.assertEqual(self._older_states(), {})

    def test_a_deleted_items_record_never_blocks_or_breaks_an_estimate(self):
        # Review fix 2, owner 2026-11-11: a material row keeps item / category / package / make as text, not links.
        # Deleting the Items record is not refused, and the estimate shows and saves on with what was chosen (as a
        # Link, the next save failed Link validation).
        self.addCleanup(self._purge)
        gone = f"TEST-EST-ITEM-GONE-{self.s}"
        frappe.get_doc({"doctype": "Items", "name": gone, "item_name": "Made-up bracket", "unit_name": "NOS",
                        "category": self.category}).db_insert()
        self.created["Items"].append(gone)
        frappe.db.commit()
        estimate_writes.save_estimate(boq_node=self.nodes["new15"],
                                      items=[{"item_type": "Normal", "item_id": gone, "quantity": 4}])
        frappe.delete_doc("Items", gone)  # not refused because an estimate uses it
        frappe.db.commit()
        self.assertFalse(frappe.db.exists("Items", gone))

        entry = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["current"][0]
        self.assertEqual((entry["items"][0]["item_name"], entry["items"][0]["unit"]), ("Made-up bracket", "NOS"))
        estimate_writes.save_estimate(boq_node=self.nodes["new15"], items=[dict(entry["items"][0], quantity=6)],
                                      expected_modified=entry["modified"])
        row = boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["current"][0]["items"][0]
        self.assertEqual((row["item_id"], row["item_name"], row["unit"], row["quantity"]), (gone, "Made-up bracket", "NOS", 6))

    def test_a_copy_keeps_the_saved_name_and_unit(self):
        # Review fix 5: the item was renamed and its unit changed in the Items list after the estimate was saved.
        # The copy keeps the older estimate's saved name and unit (12 sqm stays 12 sqm), not today's Items values.
        self.addCleanup(self._purge)

        def restore_item():
            frappe.db.rollback()
            frappe.db.set_value("Items", self.item, {"item_name": "Made-up panel", "unit_name": "sqm"})
            frappe.db.commit()

        self.addCleanup(restore_item)  # runs before the purge
        e15 = self._older("old15", self.sheet_v1, 12)  # saved as "Made-up panel", sqm
        frappe.db.set_value("Items", self.item, {"item_name": "Made-up panel, renamed", "unit_name": "NOS"})
        frappe.db.commit()

        self.assertEqual(estimate_writes.reattach_estimates(boq=self.boq, sheet_name=self.sheet_name)["copied"], 1)
        copy = [e for e in boq_view.get_estimates(boq=self.boq, sheet_name=self.sheet_name)["current"]
                if e["boq_node"] == self.nodes["new15"]][0]["items"][0]
        self.assertEqual((copy["item_name"], copy["unit"], copy["quantity"]), ("Made-up panel", "sqm", 12))
        self.assertTrue(frappe.db.exists(DOCTYPE, e15))  # the older one stays on its version

    def test_a_commit_queues_the_copy_and_the_job_copies_the_estimates(self):
        # Owner 2026-11-12: after a commit, estimates are always copied to the new version. The BoQ Sheet insert queues
        # a job only after the commit's transaction (enqueue_after_commit), and only when the BOQ has estimates; the
        # job copies the matched ones, keeps the older ones on their version, and leaves changed lines for a person.
        from nirmaan_stack.integrations.controllers import boq_line_estimate as controller

        self.addCleanup(self._purge)
        e15, e16 = self._older("old15", self.sheet_v1, 12), self._older("old16", self.sheet_v1, 5)
        frappe.db.commit()

        def sheet(**over):
            return frappe._dict(dict({"is_current": 1, "treat_as": "data", "boq": self.boq,
                                      "sheet_name": self.sheet_name}, **over))

        with patch("frappe.enqueue") as enqueue:
            controller.queue_copy_after_commit(sheet())
            enqueue.assert_called_once_with(controller.COPY_AFTER_COMMIT_JOB, queue="default",
                                            enqueue_after_commit=True, boq=self.boq, sheet_name=self.sheet_name)
            enqueue.reset_mock()
            for skipped in (sheet(is_current=0), sheet(treat_as="master_preamble"), sheet(boq=self.other_boq)):
                controller.queue_copy_after_commit(skipped)  # frozen version, specs sheet, BOQ with no estimates
            enqueue.assert_not_called()

        out = estimate_writes.copy_estimates_after_commit(self.boq, self.sheet_name)
        self.assertEqual((out["copied"], out["failed"]), (1, []))
        self.assertEqual(self._on("new15"), [[12]])
        self.assertEqual(frappe.db.get_value(DOCTYPE, e15, ["boq_node", "settled"]), (self.nodes["old15"], 1))  # history
        self.assertEqual(self._older_states(), {e16: "changed"})  # its text changed: still for a person
        # A BOQ that is not Selected is left alone (estimates are saved only on Selected BOQs).
        self.assertEqual(estimate_writes.copy_estimates_after_commit(self.other_boq, self.sheet_name),
                         {"copied": 0, "failed": []})

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
            estimate_writes.settle_older(boq=self.boq, sheet_name=self.sheet_name)

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

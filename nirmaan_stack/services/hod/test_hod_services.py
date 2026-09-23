# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Unit tests for the pure HOD rules. No site, no database.

Run: bench --site localhost run-tests --module nirmaan_stack.services.hod.test_hod_services
(or plain `python -m unittest` from the app root -- nothing here imports frappe).
"""

import json
import os
import unittest
from datetime import date

from nirmaan_stack.services.hod import blanks, checklist, dates, escalation, index, maintenance, sources

_DOCTYPE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "nirmaan_stack", "doctype")


def _row(key, **kw):
	base = {"document": key, "status": "Pending", "disabled": 0, "remarks": "", "attachment": None, "form_data": {}}
	base.update(kw)
	return base


class TestIndex(unittest.TestCase):
	def test_sixteen_documents_numbered_in_order(self):
		self.assertEqual(len(index.DOCUMENTS), 16)
		self.assertEqual([d["no"] for d in index.DOCUMENTS], list(range(1, 17)))
		self.assertEqual(len(set(index.KEYS)), 16)

	def test_every_template_library_and_source_is_known(self):
		for d in index.DOCUMENTS:
			self.assertIn(d["kind"], (index.FORM, index.TEMPLATE, index.FROM_APP))
			if d.get("library"):
				self.assertIn(d["library"], index.LIBRARY_DOCUMENTS)
			if d["kind"] == index.FROM_APP:
				self.assertIn(d["source"], (index.SRC_COMMISSION, index.SRC_TDS, index.SRC_SNAG, index.SRC_DESIGN))

	def test_only_inventory_prints_landscape(self):
		self.assertEqual([d["key"] for d in index.DOCUMENTS if d.get("landscape")], ["inventory_list"])

	def test_doctype_select_options_match_the_index(self):
		"""`Project HOD Document.document` must offer exactly the index keys, in index order."""
		path = os.path.join(_DOCTYPE_DIR, "project_hod_document", "project_hod_document.json")
		fields = {f["fieldname"]: f for f in json.load(open(path))["fields"]}
		self.assertEqual(fields["document"]["options"].split("\n"), list(index.KEYS))

	def test_library_select_options_match(self):
		path = os.path.join(_DOCTYPE_DIR, "hod_library_content", "hod_library_content.json")
		fields = {f["fieldname"]: f for f in json.load(open(path))["fields"]}
		self.assertEqual(tuple(fields["document"]["options"].split("\n")), index.LIBRARY_DOCUMENTS)


class TestChecklist(unittest.TestCase):
	def test_default_disabled_keeps_only_valid_keys(self):
		self.assertEqual(
			checklist.default_disabled_keys("material_tds\n  attic_stock_list \nnot_a_key\n\n"),
			{"material_tds", "attic_stock_list"},
		)

	def test_untouched_respects_the_default_switch(self):
		self.assertTrue(checklist.is_untouched(_row("material_tds", disabled=1), default_disabled=True))
		self.assertFalse(checklist.is_untouched(_row("material_tds", disabled=0), default_disabled=True))
		self.assertTrue(checklist.is_untouched(_row("om_manual"), default_disabled=False))

	def test_untouched_is_false_once_anything_is_filled(self):
		self.assertFalse(checklist.is_untouched(_row("om_manual", remarks="x"), False))
		self.assertFalse(checklist.is_untouched(_row("om_manual", attachment="/files/a.pdf"), False))
		self.assertFalse(checklist.is_untouched(_row("om_manual", form_data={"included": ["DX"]}), False))
		self.assertFalse(checklist.is_untouched(_row("om_manual", form_data='{"a": 1}'), False))
		self.assertTrue(checklist.is_untouched(_row("om_manual", form_data="{}"), False))
		# an empty shell is not an entry
		self.assertTrue(checklist.is_untouched(_row("escalation_chart", form_data={"levels": [{}, {}, {}]}), False))

	def test_counts_by_derived_status(self):
		rows = [_row(k) for k in index.KEYS]
		rows[0]["form_data"] = {"levels": [{"name": "Ravi"}]}  # escalation: Form Filled
		rows[1]["attachment"] = "/files/signed.pdf"  # demo training: Completed
		rows[14]["disabled"] = 1
		rows[14]["attachment"] = "/files/x.pdf"  # a switched-off row counts as off, whatever it holds
		self.assertEqual(
			checklist.counts(rows), {"completed": 1, "filled": 1, "pending": 13, "off": 1, "needed": 15}
		)

	def test_status_is_derived_from_actions(self):
		d = checklist.derive_status
		self.assertEqual(d("escalation_chart", None, {}), checklist.STATUS_PENDING)
		self.assertEqual(d("escalation_chart", None, {"levels": [{}, {}]}), checklist.STATUS_PENDING)
		self.assertEqual(d("escalation_chart", None, '{"levels": [{"name": "Ravi"}]}'), checklist.STATUS_FILLED)
		self.assertEqual(d("escalation_chart", "/files/s.pdf", {"levels": [{"name": "Ravi"}]}), checklist.STATUS_COMPLETED)
		# the maintenance results are a form too
		self.assertEqual(
			d("maintenance_checklist", None, {"checks": {"b1": {"list_1": {"results": {"Clean filters": {"result": "OK"}}}}}}),
			checklist.STATUS_FILLED,
		)
		self.assertEqual(d("maintenance_checklist", None, {"checks": {"b1": {"list_1": {"comments": " "}}}}), checklist.STATUS_PENDING)
		self.assertEqual(d("recommended_tools", None, {"tool_remarks": {"Multimeter": "2 nos handed over"}}), checklist.STATUS_FILLED)
		self.assertEqual(d("recommended_tools", None, {"tool_remarks": {"Multimeter": ""}}), checklist.STATUS_PENDING)
		# nothing to fill on these: only the upload moves them
		self.assertEqual(d("dos_donts", None, {"included": ["DX"]}), checklist.STATUS_PENDING)
		self.assertEqual(d("demo_training", None, {"x": 1}), checklist.STATUS_PENDING)
		self.assertEqual(d("demo_training", "/files/s.pdf", None), checklist.STATUS_COMPLETED)

	def test_fill_flag_marks_exactly_the_fillable_documents(self):
		self.assertEqual(
			{d["key"] for d in index.DOCUMENTS if d.get("fill")},
			{"escalation_chart", "maintenance_checklist", "inventory_list", "recommended_tools",
			 "attic_stock_list", "key_list", "equipment_warranty", "completion_certificate"},
		)

	def test_doctype_status_options_match(self):
		with open(os.path.join(_DOCTYPE_DIR, "project_hod_document", "project_hod_document.json")) as f:
			meta = json.load(f)
		status = next(x for x in meta["fields"] if x["fieldname"] == "status")
		self.assertEqual(status["options"].split("\n"), list(checklist.STATUSES))

	def test_printable_rows_close_up_the_numbers(self):
		rows = [_row(k) for k in index.KEYS]
		for r in rows:
			if r["document"] == "snag_list":
				r["disabled"] = 1
		printed = checklist.printable_rows(rows)
		self.assertEqual(len(printed), 15)
		self.assertEqual(printed[-1][0], 15)
		self.assertEqual(printed[-1][1]["document"], "as_built_drawings")
		self.assertNotIn("snag_list", [r["document"] for _, r in printed])


class TestBlanks(unittest.TestCase):
	def test_find_blanks_unique_in_order(self):
		text = "in [Facility Name] and [Type: upright, pendant] and [Facility Name] again"
		self.assertEqual(blanks.find_blanks(text), ["Facility Name", "Type: upright, pendant"])

	def test_find_ignores_tags_and_single_characters(self):
		self.assertEqual(blanks.find_blanks("<p>[a]</p> [<b>x</b>] [ok]"), ["ok"])

	def test_fill_escapes_and_keeps_unfilled_blanks(self):
		out = blanks.fill_blanks("in [Facility Name] by [Owner]", {"Facility Name": "A & B <C>", "Owner": "  "})
		self.assertEqual(out, "in A &amp; B &lt;C&gt; by [Owner]")

	def test_fill_without_escaping(self):
		self.assertEqual(blanks.fill_blanks("[Owner]", {"Owner": "a&b"}, escape=False), "a&b")


class TestDates(unittest.TestCase):
	def test_owner_sample(self):
		self.assertEqual(dates.dlp_end(date(2025, 1, 8)), date(2026, 1, 7))

	def test_end_of_month_and_leap_day(self):
		self.assertEqual(dates.add_months(date(2025, 1, 31), 1), date(2025, 2, 28))
		self.assertEqual(dates.dlp_end(date(2024, 2, 29)), date(2025, 2, 27))
		self.assertEqual(dates.dlp_end(date(2025, 3, 1)), date(2026, 2, 28))


class TestSources(unittest.TestCase):
	def test_commission_buckets(self):
		self.assertEqual(sources.commission_bucket("HVAC VRF/DX Training Report"), "training")
		self.assertEqual(sources.commission_bucket("LT Panel Factory Test Report"), "factory_test")
		self.assertEqual(sources.commission_bucket("VRF Commissioning Report"), "commissioning")
		self.assertEqual(sources.commission_bucket("Earthing Test Report"), "commissioning")

	def test_keywords(self):
		self.assertTrue(sources.matches_keywords("Gas Supression System Commissioning Report", ["gas supression"]))
		self.assertFalse(sources.matches_keywords("VESDA Commissioning Report", ["Gas Supression"]))
		self.assertTrue(sources.matches_keywords("anything", []))

	def test_keywords_match_whole_words_only(self):
		self.assertTrue(sources.matches_keywords("FA Layout", ["FA"]))
		self.assertTrue(sources.matches_keywords("FA System Training Report", ["FA"]))
		self.assertFalse(sources.matches_keywords("False Ceiling Layout", ["FA"]))
		self.assertTrue(sources.matches_keywords("RR Commissioning Report", ["RR"]))
		self.assertFalse(sources.matches_keywords("Critical Room ELV System Training Report", ["RR"]))
		self.assertTrue(sources.matches_keywords("Critical Room ELV System Training Report", ["Critical Room ELV"]))
		self.assertTrue(sources.matches_keywords("Vesda Layout", ["VESDA"]))

	def test_default_included_from_categories(self):
		subs = ["DX", "Duct", "Chilled Water", "AHU", "Air Washer", "VRF"]
		self.assertEqual(sources.default_included(subs, ["HVAC Ducting", "HVAC VRF/DX"]), ["DX", "Duct", "VRF"])
		self.assertEqual(sources.default_included(["General", "Panel"], ["Electrical"]), ["General", "Panel"])
		self.assertEqual(sources.default_included(subs, []), subs)


if __name__ == "__main__":
	unittest.main()


class TestBinder(unittest.TestCase):
	def test_parts_follow_the_checklist_and_skip_switched_off_rows(self):
		rows = [_row(k) for k in index.KEYS]
		rows[1]["disabled"] = 1  # demo_training off
		parts = checklist.binder_parts(rows)
		self.assertEqual(len(parts), 15)
		self.assertEqual([p[0] for p in parts], list(range(1, 16)))
		self.assertNotIn("demo_training", [p[1]["document"] for p in parts])

	def test_part_kinds(self):
		rows = [_row(k) for k in index.KEYS]
		kinds = {r["document"]: part for _, r, part in checklist.binder_parts(rows)}
		self.assertEqual(kinds["escalation_chart"], checklist.PART_PAGE)
		self.assertEqual(kinds["om_manual"], checklist.PART_PAGE)
		self.assertEqual(kinds["commissioning_report"], checklist.PART_SOURCES)
		self.assertEqual(kinds["snag_list"], checklist.PART_SOURCES)

	def test_an_upload_replaces_generated_content_even_for_from_app(self):
		rows = [_row(k) for k in index.KEYS]
		for r in rows:
			if r["document"] in ("key_list", "demo_training"):
				r["attachment"] = "/private/files/signed.pdf"
		kinds = {r["document"]: part for _, r, part in checklist.binder_parts(rows)}
		self.assertEqual(kinds["key_list"], checklist.PART_UPLOAD)
		self.assertEqual(kinds["demo_training"], checklist.PART_UPLOAD)

	def test_commission_task_pick_order(self):
		pick = sources.commission_binder_source
		self.assertEqual(pick({"approval_proof": "/f/signed.pdf", "has_report": True}), sources.COMMISSION_SIGNED)
		self.assertEqual(pick({"has_report": True, "file_link": "/f/x.pdf"}), sources.COMMISSION_REPORT)
		self.assertEqual(pick({"has_report": False, "file_link": "/f/x.pdf"}), sources.COMMISSION_FILE)
		self.assertIsNone(pick({"has_report": False}))

	def test_drawing_download_url(self):
		u = sources.drawing_download_url
		self.assertEqual(
			u("https://drive.google.com/file/d/1LlcF6_ZT3koeBuhH79qslYGSLL3aGVHc/view?usp=drive_link"),
			"https://drive.usercontent.google.com/download?id=1LlcF6_ZT3koeBuhH79qslYGSLL3aGVHc&export=download&confirm=t",
		)
		self.assertTrue(u("https://drive.google.com/open?id=1LlcF6_ZT3koeBuhH79qslYGSLL3aGVHc").endswith("confirm=t"))
		self.assertEqual(u("/private/files/asbuilt.pdf"), "/private/files/asbuilt.pdf")
		self.assertIsNone(u("https://example.com/drawing.pdf"))
		self.assertIsNone(u(""))

	def test_design_category_belongs(self):
		b = sources.design_category_belongs
		self.assertTrue(b("Electrical", None, "Electrical", "Electrical Work"))
		self.assertTrue(b("Fire Sprinkler", None, "Sprinkler", "Fire Fighting System"))
		self.assertTrue(b("Data Networking", "", "Networking", "Data & Networking"))
		self.assertFalse(b("ELV", None, "CCTV", "CCTV System"))
		self.assertFalse(b("Electrical", None, "HVAC", "HVAC System"))
		# a category with a Work Package goes by it, not by its name
		self.assertTrue(b("Anything", "HVAC System", "HVAC", "HVAC System"))
		self.assertFalse(b("HVAC", "Electrical Work", "HVAC", "HVAC System"))


class TestMaintenance(unittest.TestCase):
	BLOCK = {"name": "b1", "title": "VRF Maintenance", "list_1": ["Clean filters", "Check drain"], "list_2": ["Gas leak test"]}

	def test_one_sheet_per_non_empty_list(self):
		out = maintenance.sheets([self.BLOCK, {"name": "b2", "title": "Duct", "list_1": [], "list_2": ["Inspect"]}], {})
		self.assertEqual([(s["title"], s["period"]) for s in out], [
			("VRF Maintenance", "Six Months Report"), ("VRF Maintenance", "Yearly Report"), ("Duct", "Yearly Report"),
		])
		# nothing entered: every row prints blank, numbered from 1 on each sheet
		self.assertEqual(out[0]["rows"][1], {"no": 2, "item": "Check drain", "result": "", "remarks": ""})
		self.assertEqual(out[0]["comments"], "")

	def test_results_follow_the_item_text_not_the_position(self):
		fd = {"checks": {"b1": {
			"list_1": {"results": {"Check drain": {"result": "Not OK", "remarks": " choked "}, "Old wording": {"result": "OK"}},
					   "comments": " Recheck in a week "},
		}}}
		rows = maintenance.sheets([self.BLOCK], fd)[0]["rows"]
		self.assertEqual([(r["item"], r["result"], r["remarks"]) for r in rows],
						 [("Clean filters", "", ""), ("Check drain", "Not OK", "choked")])
		self.assertEqual(maintenance.sheets([self.BLOCK], fd)[0]["comments"], "Recheck in a week")

	def test_bad_shapes_read_as_empty(self):
		for fd in (None, "x", {"checks": []}, {"checks": {"b1": "x"}}, {"checks": {"b1": {"list_1": {"results": ["x"]}}}}):
			rows = maintenance.sheets([self.BLOCK], fd)[0]["rows"]
			self.assertEqual({r["result"] for r in rows}, {""})


class TestEscalation(unittest.TestCase):
	def test_label_is_the_position(self):
		self.assertEqual(
			[escalation.level_label(i) for i in range(5)],
			["1st Level", "2nd Level", "3rd Level", "4th Level", "5th Level"],
		)
		self.assertEqual(escalation.level_label(10), "11th Level")  # not "11st"

	def test_three_blank_levels_when_nothing_is_filled(self):
		for fd in (None, {}, {"levels": "junk"}, {"levels": []}):
			rows = escalation.levels(fd)
			self.assertEqual([r["label"] for r in rows], ["1st Level", "2nd Level", "3rd Level"])
			self.assertEqual({r["name"] for r in rows}, {""})

	def test_a_project_can_add_a_fourth_level(self):
		fd = {"levels": [{"name": "Ravi", "phone": " 98 "}, {}, {}, {"name": "Client PM", "email": "pm@x.com"}]}
		rows = escalation.levels(fd)
		self.assertEqual(len(rows), 4)
		self.assertEqual(rows[3], {"label": "4th Level", "name": "Client PM", "designation": "", "phone": "", "email": "pm@x.com"})
		self.assertEqual(rows[0]["phone"], "98")

	def test_only_finished_records_are_handed_over(self):
		# owner 2026-09-23: an unfinished report / drawing is not offered for download
		done, not_done = sources.commission_is_done, lambda x: not sources.commission_is_done(x)
		self.assertTrue(all(done(x) for x in ("Submitted", "Client Accepted", " Submitted ")))
		self.assertTrue(all(not_done(x) for x in ("Pending", "Pending Approval", "Not Applicable", "", None)))
		self.assertTrue(all(sources.design_is_done(x) for x in ("Submitted", "Approved")))
		self.assertTrue(not any(sources.design_is_done(x) for x in ("Pending", "WIP", "Not Applicable", None)))
		self.assertEqual(sources.SNAG_DONE, "Completed")

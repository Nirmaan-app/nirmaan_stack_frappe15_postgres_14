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

from nirmaan_stack.services.hod import (
	blanks,
	checklist,
	dates,
	escalation,
	header_logos,
	index,
	maintenance,
	pages,
	sources,
)

_DOCTYPE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "nirmaan_stack", "doctype")


def _row(key, **kw):
	base = {"document": key, "status": "NO", "disabled": 0, "remarks": "", "form_data": {}}
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
		self.assertFalse(checklist.is_untouched(_row("om_manual", form_data={"completed": True}), False))
		self.assertFalse(checklist.is_untouched(_row("om_manual", form_data={"included": ["DX"]}), False))
		self.assertFalse(checklist.is_untouched(_row("om_manual", form_data='{"a": 1}'), False))
		self.assertTrue(checklist.is_untouched(_row("om_manual", form_data="{}"), False))
		# an empty shell is not an entry
		self.assertTrue(checklist.is_untouched(_row("escalation_chart", form_data={"levels": [{}, {}, {}]}), False))

	def test_counts_read_the_picked_status(self):
		rows = [_row(k) for k in index.KEYS]
		rows[1]["status"] = "YES"
		rows[2]["status"] = "NA"
		rows[14]["disabled"] = 1
		rows[14]["status"] = "YES"  # switched off counts as off, whatever it answers
		self.assertEqual(
			checklist.counts(rows),
			{"completed": 1, "no": 13, "na": 1, "off": 1, "needed": 15},
		)

	def test_status_is_the_hand_picked_handover_answer(self):
		"""Owner 2026-09-24: `status` REPLACED the derived Pending / Form Filled / Completed with the
		checklist answer the user picks. `derive_status` is gone -- nothing computes it any more."""
		self.assertFalse(hasattr(checklist, "derive_status"))
		self.assertEqual(checklist.STATUSES, ("YES", "NO", "NA"))
		# the options themselves are pinned by test_doctype_status_options_match; these two are not
		path = os.path.join(_DOCTYPE_DIR, "project_hod_document", "project_hod_document.json")
		fields = {f["fieldname"]: f for f in json.load(open(path))["fields"]}
		self.assertEqual(fields["status"]["default"], checklist.STATUS_NO)
		self.assertFalse(fields["status"].get("read_only"))

	def test_only_a_from_nirmaan_document_needs_saving_before_yes(self):
		"""Owner 2026-09-28: a document that needs no filling must be answerable YES as it stands. A FORM
		and a LIBRARY text both print from their OWN layout -- a blank Key List or Attic Stock List is a
		real handover page, written in by hand -- so neither is gated. Only a FROM NIRMAAN document is:
		what it hands over IS the records ticked on it, so with none ticked there is nothing to print."""
		for key in ("om_manual", "dos_donts", "escalation_chart", "maintenance_checklist",
		            "recommended_tools", "inventory_list", "attic_stock_list", "key_list",
		            "equipment_warranty", "completion_certificate"):
			self.assertFalse(checklist.needs_saving(key), key)
			self.assertTrue(checklist.can_be_yes(key, {}), key)
			self.assertTrue(checklist.can_be_yes(key, None), key)
		for key in ("demo_training", "commissioning_report", "material_tds", "factory_test_reports",
		            "snag_list", "as_built_drawings"):
			self.assertTrue(checklist.needs_saving(key), key)
			self.assertFalse(checklist.can_be_yes(key, {}), key)
			self.assertTrue(checklist.can_be_yes(key, {"selected": ["REPORT-1"]}), key)

	def test_the_fill_flag_no_longer_gates_yes(self):
		"""`fill` still says a row gets an editor; it is NOT the YES gate (owner 2026-09-28). Every
		fillable document that is not read from the app is answerable with an empty form."""
		for d in index.DOCUMENTS:
			if d.get("fill") and d["kind"] != index.FROM_APP:
				self.assertTrue(checklist.can_be_yes(d["key"], {}), d["key"])

	def test_a_retired_status_heals_to_no(self):
		"""No backfill script (owner 2026-09-24): rows still carrying Pending / Form Filled / Completed
		read as NO at once, and are written back as NO the next time they are saved."""
		n = checklist.normalise_status
		self.assertEqual(n("Pending"), checklist.STATUS_NO)
		self.assertEqual(n("Form Filled"), checklist.STATUS_NO)
		self.assertEqual(n("Completed"), checklist.STATUS_NO)
		self.assertEqual(n(""), checklist.STATUS_NO)
		self.assertEqual(n(None), checklist.STATUS_NO)
		self.assertEqual(n("whatever"), checklist.STATUS_NO)
		# the three answers survive, however they were typed
		self.assertEqual(n("YES"), checklist.STATUS_YES)
		self.assertEqual(n(" yes "), checklist.STATUS_YES)
		self.assertEqual(n("na"), checklist.STATUS_NA)

	def test_is_saved_is_one_rule_for_all_three_kinds(self):
		saved = checklist.is_saved
		# a form keeps its entries, a library text its parts, a From Nirmaan document its ticked records
		self.assertTrue(saved({"levels": [{"name": "Ravi"}]}))
		self.assertTrue(saved({"included": ["DX"]}))
		self.assertTrue(saved({"selected": ["REPORT-1"]}))
		self.assertTrue(saved('{"levels": [{"name": "Ravi"}]}'))
		# an empty shell is not saved
		self.assertFalse(saved({}))
		self.assertFalse(saved(None))
		self.assertFalse(saved({"levels": [{}, {}]}))
		self.assertFalse(saved({"tool_remarks": {"Multimeter": "  "}}))

	def test_the_yes_gate_ignores_the_screens_own_bookkeeping(self):
		"""`completed` is left over from the retired hand mark: it must NOT make a row look saved, or
		an untouched document could be answered YES."""
		self.assertFalse(checklist.can_be_yes("demo_training", {"completed": True}))
		self.assertFalse(checklist.is_saved({"completed": True}))
		self.assertTrue(checklist.can_be_yes("demo_training", {"completed": True, "selected": ["X"]}))

	def test_no_and_na_are_never_gated(self):
		"""Only YES is guarded -- a document nobody will ever fill must still be answerable NA."""
		self.assertTrue(checklist.STATUS_NO in checklist.STATUSES)
		self.assertTrue(checklist.STATUS_NA in checklist.STATUSES)
		# `can_be_yes` is asked ONLY for YES; on a document that needs saving it reads `is_saved`.
		self.assertEqual(
			checklist.can_be_yes("demo_training", {"x": 1}), checklist.is_saved({"x": 1})
		)

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


class TestHeaderLogos(unittest.TestCase):
	"""Which stakeholder logos head a project's handover documents (owner 2026-09-24)."""

	# Shaped like KOLKATA-PROJ-00102's real TDS Setting: three complete roles, one named-but-logoless
	# (Nirmaan), one logo with no name, two empty.
	SETTING = {
		"client_name": "Maresk", "client_logo": "/files/maersk.png",
		"gc_contractor_name": "ANJ Group", "gc_contractor_logo": "/files/anj.png",
		"architect_name": "The Canvas Design", "architect_logo": "/files/canvas.png",
		"mep_contractor_name": "Nirmaan", "mep_contractorlogo": "",
		"manager_name": "", "mananger_logo": "/files/pm.png",
		"data_tjxu": "", "consultant_logo": "",
	}

	def test_a_role_needs_both_a_name_and_a_logo(self):
		self.assertEqual(
			header_logos.selectable(self.SETTING),
			["mep_contractor", "gc_contractor", "client", "architect"],
		)
		# The PM has a logo but no name, so it cannot be picked.
		self.assertNotIn("manager", header_logos.selectable(self.SETTING))
		self.assertNotIn("consultant", header_logos.selectable(self.SETTING))
		# whitespace is not a logo
		self.assertEqual(
			header_logos.selectable({"client_name": "X", "client_logo": "   "}), ["mep_contractor"]
		)

	def test_nirmaan_is_always_selectable_and_never_waits_on_an_upload(self):
		"""Owner 2026-09-25: the MEP row uses Nirmaan's own logo -- the SAME url the TDS report falls
		back to -- so it is pickable even on a project with no TDS Setting at all."""
		for setting in ({}, None, self.SETTING):  # SETTING names Nirmaan but uploads no logo
			self.assertIn("mep_contractor", header_logos.selectable(setting))
		self.assertEqual(header_logos.logo_of({}, "mep_contractor"), header_logos.BUNDLED_LOGO)
		self.assertEqual(header_logos.name_of({}, "mep_contractor"), "Nirmaan")
		# a project that DID upload one keeps its own
		own = {"mep_contractorlogo": "/files/mine.png", "mep_contractor_name": "Nirmaan South"}
		self.assertEqual(header_logos.logo_of(own, "mep_contractor"), "/files/mine.png")
		self.assertEqual(header_logos.name_of(own, "mep_contractor"), "Nirmaan South")
		# no other role gets a fallback
		self.assertEqual(header_logos.logo_of({}, "client"), "")
		self.assertEqual(header_logos.name_of({}, "client"), "")

	def test_nothing_picked_prints_nirmaan_alone(self):
		"""Owner 2026-09-25: a fresh project is headed with the one logo that is always right; the
		client and GC are added deliberately, not by default."""
		self.assertEqual(
			[x["role"] for x in header_logos.header_logos(self.SETTING, "")], ["mep_contractor"]
		)
		self.assertEqual(
			header_logos.header_logos(self.SETTING, None), header_logos.header_logos(self.SETTING, "")
		)
		# even with no TDS Setting at all
		self.assertEqual([x["role"] for x in header_logos.header_logos({}, "")], ["mep_contractor"])

	def test_a_pick_is_narrowed_to_what_is_still_selectable(self):
		# the PM was ticked, then its name went away: it stops printing rather than leaving a gap.
		self.assertEqual(
			[x["role"] for x in header_logos.header_logos(self.SETTING, "manager\nclient")],
			["client"],
		)

	def test_print_order_is_fixed_not_pick_order(self):
		self.assertEqual(
			[x["role"] for x in header_logos.header_logos(self.SETTING, "architect\nclient\nmep_contractor")],
			["mep_contractor", "client", "architect"],
		)

	def test_what_prints_carries_its_label_name_and_logo(self):
		first = header_logos.header_logos(self.SETTING, "gc_contractor")[0]
		self.assertEqual(first, {
			"role": "gc_contractor", "label": "GC Contractor",
			"name": "ANJ Group", "logo": "/files/anj.png",
		})

	def test_parse_and_valid_roles_drop_junk(self):
		self.assertEqual(header_logos.parse_roles("client\nnope\n\ngc_contractor"), ["gc_contractor", "client"])
		self.assertEqual(header_logos.parse_roles(""), [])
		self.assertEqual(header_logos.valid_roles(["client", "bogus"]), ["client"])
		self.assertEqual(header_logos.valid_roles(None), [])
		# a repeat is not two logos
		self.assertEqual(header_logos.valid_roles(["client", "client"]), ["client"])

	def test_the_two_letterhead_documents(self):
		self.assertTrue(header_logos.uses_letterhead("completion_certificate"))
		self.assertTrue(header_logos.uses_letterhead("equipment_warranty"))
		self.assertFalse(header_logos.uses_letterhead("om_manual"))
		self.assertFalse(header_logos.uses_letterhead(""))
		# a typo in that list would silently give a document the logo strip instead
		self.assertTrue(header_logos.letterhead_documents_are_real())

	def test_every_role_carries_a_label_and_its_two_fields(self):
		self.assertEqual(set(header_logos.ROLES), set(header_logos.ROLE_ORDER))
		self.assertEqual(len(header_logos.ROLES), 6)
		for role, (label, name_f, logo_f) in header_logos.ROLES.items():
			self.assertTrue(label and name_f and logo_f, role)

	def test_the_doctype_stores_the_choice(self):
		path = os.path.join(_DOCTYPE_DIR, "project_hod_setting", "project_hod_setting.json")
		meta = json.load(open(path))
		self.assertEqual(meta["autoname"], "field:project")  # one row per project, by construction
		fields = {f["fieldname"]: f for f in meta["fields"]}
		self.assertEqual(set(fields), {"project", "header_roles"})
		self.assertEqual(fields["project"]["options"], "Projects")
		self.assertTrue(fields["project"]["unique"])


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


class TestPages(unittest.TestCase):
	def test_text_without_a_marker_is_one_page_unchanged(self):
		self.assertEqual(pages.split_pages("<h4>A</h4><p>b</p>"), ["<h4>A</h4><p>b</p>"])

	def test_each_marker_starts_a_page(self):
		text = f"<p>toc</p>{pages.PAGE_BREAK}<h1>T</h1><p>one</p>\n{pages.PAGE_BREAK}\n<h4>two</h4>"
		self.assertEqual(pages.split_pages(text), ["<p>toc</p>", "<h1>T</h1><p>one</p>\n", "\n<h4>two</h4>"])

	def test_marker_at_either_end_or_doubled_prints_no_empty_page(self):
		pb = pages.PAGE_BREAK
		self.assertEqual(pages.split_pages(f"{pb}<p>a</p>{pb}\n{pb}<p>b</p>{pb}"), ["<p>a</p>", "<p>b</p>"])

	def test_hand_typed_variants_are_recognised(self):
		# the editor is a plain text box: attribute order, extra classes, quotes, case and inner space vary
		for marker in (
			"<div class='page-break'></div>",
			'<div class="page-break"> </div>',
			'<div style="x" class="hd page-break other"></div>',
			'<DIV CLASS="page-break"></DIV>',
		):
			self.assertEqual(pages.split_pages(f"<p>a</p>{marker}<p>b</p>"), ["<p>a</p>", "<p>b</p>"], marker)

	def test_only_an_empty_page_break_div_splits(self):
		# a div that HOLDS text is content, and a class that merely contains the word is another class
		for text in ('<div class="page-break">keep</div>', '<div class="no-page-breaks"></div>', "[page-break]"):
			self.assertEqual(pages.split_pages(text), [text])

	def test_empty_text_still_prints_its_page(self):
		self.assertEqual(pages.split_pages(None), [""])
		self.assertEqual(pages.split_pages(pages.PAGE_BREAK), [pages.PAGE_BREAK])

	def test_start_key_reads_library_html_and_printed_text_alike(self):
		html_key = pages.start_key("<h4>3.2.Access Control Panel</h4><ul><li><strong>Mounting</strong>: Secure &amp; dry</li></ul>")
		pdf_key = pages.start_key("3.2.Access Control Panel\n• Mounting: Secure & dry")
		self.assertEqual(html_key, pdf_key)
		self.assertEqual(pages.start_key("Mounting Surface: Must be ﬂat"), "mountingsurfacemustbeflat")  # ligature
		self.assertEqual(len(pages.start_key("x" * 200)), pages.KEY_LEN)

	def test_bullet_marks_are_not_read_as_text(self):
		# The print draws "•" and, for a sub-list, "◦". They must stay out of the key -- a LETTER "o" as the
		# sub-list mark made every page opening on a sub-list unrecognisable (VESDA, 2026-10-06).
		html_key = pages.start_key("<li><strong>Action</strong>:<ul><li>Activate emergency procedures.</li></ul></li>")
		self.assertEqual(pages.start_key("• Action:\n   ◦ Activate emergency procedures."), html_key)
		self.assertNotEqual(pages.start_key("• Action:\n   o Activate emergency procedures."), html_key)


def _blk(name, *starts):
	return {"name": name, "starts": [pages.start_key(s) for s in starts]}


class TestPageFit(unittest.TestCase):
	# Two manuals the way the Electrical row prints: a marked block (4 pages) then a flowing one.
	MARKED = _blk("general", "O&M Manuals for Electrical Systems", "Electrical Systems again", "Shutdown Procedure", "Troubleshooting")
	FLOWING = _blk("panel", "O&M Manual - Electrical Panel")

	def keys(self, *texts):
		return [pages.start_key(t) for t in texts]

	def test_each_marked_page_on_its_own_sheet_fits(self):
		printed = self.keys("O&M Manuals for Electrical Systems toc", "Electrical Systems again 1. Intro",
			"Shutdown Procedure: switch", "Troubleshooting x", "O&M Manual - Electrical Panel 1.", "panel page 2")
		self.assertEqual(pages.overflowing([self.MARKED, self.FLOWING], printed), set())

	def test_a_page_that_spills_onto_a_second_sheet_is_caught(self):
		printed = self.keys("O&M Manuals for Electrical Systems toc", "Electrical Systems again 1. Intro",
			"Perform regular inspections", "Shutdown Procedure", "Troubleshooting", "O&M Manual - Electrical Panel")
		self.assertEqual(pages.overflowing([self.MARKED, self.FLOWING], printed), {"general"})

	def test_the_last_marked_page_spilling_is_caught_too(self):
		printed = self.keys("O&M Manuals for Electrical Systems", "Electrical Systems again", "Shutdown Procedure",
			"Troubleshooting", "8. Warranty Information", "O&M Manual - Electrical Panel")
		self.assertEqual(pages.overflowing([self.MARKED, self.FLOWING], printed), {"general"})
		# ... and when the marked block is the last one, spilling past the end counts as well
		self.assertEqual(pages.overflowing([self.MARKED], printed[:5]), {"general"})
		self.assertEqual(pages.overflowing([self.MARKED], printed[:4]), set())

	def test_the_pictures_page_after_the_manual_is_not_a_spill(self):
		pics = _blk(None, "Operations & Maintenance Manual - Pictures")
		printed = self.keys("O&M Manuals for Electrical Systems", "Electrical Systems again", "Shutdown Procedure",
			"Troubleshooting", "Operations & Maintenance Manual – Pictures")
		self.assertEqual(pages.overflowing([self.MARKED, pics], printed), set())

	def test_a_page_that_cannot_be_found_is_not_taken_as_fitting(self):
		printed = self.keys("O&M Manuals for Electrical Systems", "something else", "Shutdown Procedure", "Troubleshooting")
		self.assertEqual(pages.overflowing([self.MARKED], printed), {"general"})

	def test_a_flowing_block_is_never_reported(self):
		printed = self.keys("O&M Manual - Electrical Panel", "more", "and more")
		self.assertEqual(pages.overflowing([self.FLOWING], printed), set())

	# Do's & Don'ts: every block is laid out page by page (strict), and its box grows with its text.
	WLD = _blk("wld", "WATER LEAK DETECTION SYSTEM - Do's & Don't")
	RRS = _blk("rrs", "RODENT REPELLANT SYSTEM - Do's & Don't", "Don't: 1. Neglecting routine maintenance")

	# What each printed sheet opens with (its title, or the Don'ts heading, then the list).
	WLD_P1 = "WATER LEAK DETECTION SYSTEM - Do's & Don't Do's: 1. Conduct periodic tests"
	RRS_P1 = "RODENT REPELLANT SYSTEM - Do's & Don't Do's: 1. Conduct routine inspections"
	RRS_P2 = "Don't: 1. Neglecting routine maintenance; regularly check and clean"

	def test_strict_one_sheet_block_that_runs_on_is_caught(self):
		printed = self.keys(self.WLD_P1, "7. Exclude relevant staff", self.RRS_P1, self.RRS_P2)
		self.assertEqual(pages.overflowing([self.WLD, self.RRS], printed, strict=True), {"wld"})
		# ... where the non-strict reading treats a single-start block as flowing and lets it pass
		self.assertEqual(pages.overflowing([self.WLD, self.RRS], printed), set())

	def test_strict_split_block_fits_on_its_two_sheets(self):
		printed = self.keys(self.WLD_P1, self.RRS_P1, self.RRS_P2)
		self.assertEqual(pages.overflowing([self.WLD, self.RRS], printed, strict=True), set())

	def test_a_sheet_printing_below_the_box_line_is_caught(self):
		printed = self.keys(self.WLD_P1, self.RRS_P1, self.RRS_P2)
		ok = [250.0, 260.0, 200.0]
		low = [250.0, 279.0, 200.0]  # one page, but its last line sits on the box's bottom rule
		self.assertEqual(pages.overflowing([self.WLD, self.RRS], printed, strict=True, bottoms=ok, limit=272.5), set())
		self.assertEqual(pages.overflowing([self.WLD, self.RRS], printed, strict=True, bottoms=low, limit=272.5), {"rrs"})


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

	def test_tds_belongs_only_narrows_a_shared_package(self):
		# Critical Room ELV: three systems, categories named after the system.
		gss = ["GSS", "Gas Supression", "Gas Suppression", "Critical Room ELV"]
		wld = ["WLD", "RR", "RRS", "Water Leak", "Rodent", "Critical Room ELV"]
		self.assertFalse(sources.tds_belongs("WLD", "WLD Hooter Cum Strobe", gss, True))
		self.assertFalse(sources.tds_belongs("RR", "Ultrasonic RR Transducer", gss, True))
		self.assertTrue(sources.tds_belongs("WLD", "WLD Hooter Cum Strobe", wld, True))
		self.assertTrue(sources.tds_belongs("RR", "Ultrasonic RR Transducer", wld, True))
		self.assertTrue(sources.tds_belongs("Vesda", "VESDA Detector", ["VESDA"], True))

	def test_tds_belongs_keeps_everything_on_a_one_system_package(self):
		# A TDS category names the PART, not the system: narrowing here would empty the list.
		self.assertTrue(sources.tds_belongs("IP Cameras", "Dome Camera", ["CCTV"], False))
		self.assertTrue(sources.tds_belongs("Lock & Accessories", "EM Lock", ["Access Control", "ACS"], False))
		self.assertTrue(sources.tds_belongs("Addressable Detectors", "Smoke Detector", ["FA", "Fire Alarm"], False))
		self.assertTrue(sources.tds_belongs("Speaker", "Ceiling Speaker", ["PA"], False))
		# ... and the same rows WOULD be lost if the package were treated as shared.
		self.assertFalse(sources.tds_belongs("IP Cameras", "Dome Camera", ["CCTV"], True))

	def test_tds_belongs_matches_the_item_name_too(self):
		# A category that says nothing, an item name that does.
		self.assertTrue(sources.tds_belongs("Panel", "4 Zone WLD Panel", ["WLD"], True))
		self.assertFalse(sources.tds_belongs("Panel", "4 Zone WLD Panel", ["VESDA"], True))

	def test_tds_belongs_without_keywords_keeps_everything(self):
		self.assertTrue(sources.tds_belongs("Wires & Cables", "2.5 sqmm", [], True))

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

	def test_there_is_no_uploaded_part_any_more(self):
		"""A row's part is decided by its KIND alone. The upload that came back on 2026-10-06 does not bring
		back a part of its own: every row keeps its kind's part and the binder reads the file through
		`uploaded_file` instead."""
		self.assertFalse(hasattr(checklist, "PART_UPLOAD"))
		upload = {"upload": {"url": "/private/files/x.pdf", "file_name": "x.pdf"}}
		rows = [_row(k, form_data=upload) for k in index.KEYS]
		kinds = {r["document"]: part for _, r, part in checklist.binder_parts(rows)}
		self.assertEqual(kinds["key_list"], checklist.PART_PAGE)
		self.assertEqual(kinds["om_manual"], checklist.PART_PAGE)
		self.assertEqual(kinds["demo_training"], checklist.PART_SOURCES)

	def test_uploaded_file_reads_the_upload_of_every_document(self):
		f = checklist.uploaded_file
		upload = {"upload": {"url": "/private/files/om.pdf", "file_name": "om.pdf"}}
		for key in index.KEYS:  # owner 2026-10-06: every document, not just the library texts
			self.assertEqual(f(key, upload), "/private/files/om.pdf", key)
		self.assertEqual(f("dos_donts", json.dumps(upload)), "/private/files/om.pdf")
		# the generated document stays when nothing (or nothing usable) is uploaded
		self.assertIsNone(f("om_manual", {}))
		self.assertIsNone(f("om_manual", None))
		self.assertIsNone(f("om_manual", {"included": ["all"]}))
		self.assertIsNone(f("om_manual", {"upload": {"url": "  "}}))
		self.assertIsNone(f("om_manual", {"upload": "/private/files/om.pdf"}))
		# a row that is not a handover document has nothing to hand over
		self.assertIsNone(f("not_a_document", upload))

	def test_an_upload_counts_as_entries_and_answers_a_from_nirmaan_document(self):
		upload = {"upload": {"url": "/private/files/x.pdf", "file_name": "x.pdf"}}
		self.assertTrue(checklist.can_be_yes("om_manual", upload))
		self.assertFalse(checklist.is_untouched(_row("om_manual", form_data=upload), False))
		# a From Nirmaan document with no records ticked may be YES once its file is uploaded
		self.assertFalse(checklist.can_be_yes("commissioning_report", {}))
		self.assertTrue(checklist.can_be_yes("commissioning_report", upload))

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

	def test_each_period_carries_its_own_date(self):
		fd = {"dates": {"list_1": "2026-03-14", "list_2": "2026-09-14"}}
		self.assertEqual([(s["period"], s["date"]) for s in maintenance.sheets([self.BLOCK], fd)],
						 [("Six Months Report", "2026-03-14"), ("Yearly Report", "2026-09-14")])

	def test_a_period_left_empty_prints_blank(self):
		fd = {"dates": {"list_1": " 2026-03-14 ", "list_2": ""}}
		self.assertEqual([s["date"] for s in maintenance.sheets([self.BLOCK], fd)], ["2026-03-14", ""])

	def test_the_single_pre_split_date_is_the_fallback_for_both(self):
		# a row saved before the two dates keeps printing the one it had, on both sheets
		self.assertEqual([s["date"] for s in maintenance.sheets([self.BLOCK], {"date": "2026-01-09"})],
						 ["2026-01-09", "2026-01-09"])
		# ... and a period that HAS its own date does not fall back to it
		fd = {"date": "2026-01-09", "dates": {"list_2": "2026-09-14"}}
		self.assertEqual([s["date"] for s in maintenance.sheets([self.BLOCK], fd)], ["2026-01-09", "2026-09-14"])

	def test_period_date_reads_bad_shapes_as_blank(self):
		for fd in (None, "x", {"dates": "x"}, {"dates": []}, {"dates": {"list_1": None}}):
			self.assertEqual(maintenance.period_date(fd, "list_1"), "")


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
		# ... but the SNAG LIST is handed over in full, open items included (owner 2026-09-25), so no
		# snag status filter exists to import.
		self.assertFalse(hasattr(sources, "SNAG_DONE"))

	def test_selected_items_follows_the_ticks(self):
		items = [{"name": "a"}, {"name": "b"}, {"name": "c"}]
		self.assertEqual(sources.selected_items(items, None), items)  # nothing ticked = all of them
		self.assertEqual(sources.selected_items(items, "junk"), items)
		self.assertEqual([i["name"] for i in sources.selected_items(items, ["b", "c"])], ["b", "c"])
		self.assertEqual(sources.selected_items(items, []), [])
		self.assertEqual(sources.selected_items(None, ["a"]), [])

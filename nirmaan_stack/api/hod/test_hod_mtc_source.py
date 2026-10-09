# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt
"""14 Factory Test Reports reads Material Test Certificates, package-wise -- end to end on the DB.

Runs against the LIVE site: raw fixtures (a project, a vendor, three MTCs) inside ONE transaction whose
commits are stubbed, rolled back in `tearDown`. The HOD Systems themselves are the site's real records,
read only (HVAC, Electrical, FAS, and the three that share Critical Room ELV).

Run ONLY this module:
    bench --site localhost run-tests --skip-before-tests --skip-test-records \
        --module nirmaan_stack.api.hod.test_hod_mtc_source
"""

import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.hod import binder
from nirmaan_stack.api.hod.from_app import mtc_for_system, sources_for, system_meta

MTC = "Material Test Certificate"
MTC_ITEM = "Material Test Certificate Item"
URL = "/api/method/frappe_gcp_attachment.controller.generate_file?key=hod-mtc-test&file_name=mtc.pdf"


def _raw(doctype, **fields):
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	if not doc.name:
		doc.name = frappe.generate_hash(length=12)
	doc.db_insert()
	return doc.name


class TestHodMtcSource(FrappeTestCase):
	def setUp(self):
		self._real_commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None
		frappe.set_user("Administrator")
		for system in ("HVAC", "Electrical", "FAS", "WLD & RRS", "GSS"):
			if not frappe.db.exists("HOD System", system):
				raise unittest.SkipTest(f"HOD System {system} missing on this site")

		tag = frappe.generate_hash(length=6)
		self.project = _raw("Projects", project_name=f"TEST_HOD_MTC_{tag}", tendering_status="Won")
		other_project = _raw("Projects", project_name=f"TEST_HOD_MTC_OTHER_{tag}", tendering_status="Won")
		self.vendor = _raw("Vendors", vendor_name=f"TEST HOD MTC Vendor {tag}")

		# A: HVAC + Electrical items, older certificate.
		self.mtc_a = self._mtc(self.project, "PO/123/00999/26-27", "2026-09-01", [
			("ITEM-H1", "16HP VRF ODU", "Daikin", "VRF System", "HVAC System"),
			("ITEM-E1", "FRLS Cable 2.5 sqmm", "Polycab", "Wires & Cables", "Electrical Work"),
		])
		# B: HVAC item, newer certificate -- must list before A.
		self.mtc_b = self._mtc(self.project, "PO/124/00999/26-27", "2026-10-01", [
			("ITEM-H2", "Refnet BHFP22P", "Daikin", "Copper Piping", "HVAC System"),
		])
		# C: the shared Critical Room ELV package -- a WLD item.
		self.mtc_c = self._mtc(self.project, "PO/125/00999/26-27", "2026-09-15", [
			("ITEM-W1", "WLD Hooter Cum Strobe", "Honeywell", "WLD", "Critical Room ELV"),
		])
		# D: another project -- never listed.
		self._mtc(other_project, "PO/126/00998/26-27", "2026-09-20", [
			("ITEM-H3", "VRF IDU", "Daikin", "VRF System", "HVAC System"),
		])

	def tearDown(self):
		frappe.db.commit = self._real_commit
		frappe.db.rollback()

	def _mtc(self, project, po, cert_date, items):
		name = _raw(
			MTC,
			procurement_order=po,
			project=project,
			vendor=self.vendor,
			attachment=URL,
			certificate_date=cert_date,
		)
		for idx, (item_id, item_name, make, category, package) in enumerate(items, start=1):
			_raw(
				MTC_ITEM,
				parent=name,
				parenttype=MTC,
				parentfield="items",
				idx=idx,
				item_id=item_id,
				item_name=item_name,
				make=make,
				category=category,
				procurement_package=package,
			)
		return name

	def test_a_system_sees_its_package_only_and_only_its_items(self):
		hvac = mtc_for_system(self.project, system_meta("HVAC"))
		self.assertEqual([m.name for m in hvac], [self.mtc_b, self.mtc_a], "newest certificate first")
		a = next(m for m in hvac if m.name == self.mtc_a)
		self.assertEqual([i.item_name for i in a["items"]], ["16HP VRF ODU"], "the Electrical item is not HVAC's")
		self.assertEqual(a.po_label, "PO-123")
		self.assertEqual(a.certificate_date_label, "01-Sep-2026")
		self.assertTrue(a.vendor_name.startswith("TEST HOD MTC Vendor"))

		electrical = mtc_for_system(self.project, system_meta("Electrical"))
		self.assertEqual([m.name for m in electrical], [self.mtc_a], "a two-package MTC shows under both")
		self.assertEqual([i.item_name for i in electrical[0]["items"]], ["FRLS Cable 2.5 sqmm"])

		self.assertEqual(mtc_for_system(self.project, system_meta("FAS")), [])

	def test_a_shared_package_is_narrowed_by_keywords(self):
		self.assertEqual([m.name for m in mtc_for_system(self.project, system_meta("WLD & RRS"))], [self.mtc_c])
		self.assertEqual(mtc_for_system(self.project, system_meta("GSS")), [])

	def test_sources_for_reads_mtcs_for_document_14(self):
		out = sources_for(self.project, "HVAC", "factory_test_reports")
		self.assertEqual(out["source"], "Material Test Certificate")
		self.assertEqual(len(out["items"]), 2)

	def test_the_binder_adds_each_ticked_certificate_file(self):
		system = system_meta("HVAC")

		def steps_for(form_data):
			row = frappe._dict(name="x", document="factory_test_reports", form_data=json.dumps(form_data))
			return binder._content_steps(self.project, "HVAC", row, system)

		steps, reason = steps_for({"selected": [self.mtc_a]})
		self.assertIsNone(reason)
		self.assertEqual(len(steps), 1)
		self.assertEqual(steps[0]["kind"], "file")
		self.assertEqual(steps[0]["args"], (URL,))
		self.assertIn("PO-123", steps[0]["label"])

		steps, reason = steps_for({"selected": []})
		self.assertEqual(steps, [])
		self.assertEqual(reason, binder.EMPTY_REASON["none_selected"])

		row = frappe._dict(name="x", document="factory_test_reports", form_data=json.dumps({"selected": []}))
		steps, reason = binder._content_steps(self.project, "FAS", row, system_meta("FAS"))
		self.assertEqual((steps, reason), ([], binder.EMPTY_REASON["mtc"]))

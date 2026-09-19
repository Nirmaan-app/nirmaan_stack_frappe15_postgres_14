# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Cheque payments: approved like any payment, then moved on to Reconciliation Pending.

WHAT THIS SUITE HOLDS DOWN
--------------------------
The owner's rule (2026-09-19) is that a cheque payment PASSES THROUGH `Approved` -- so the Work Order
TDS is withheld exactly as for an online payment -- and only then moves on to `Reconciliation
Pending`. Every approval route is exercised through its real code: auto-approve at request, the
browser's single L1 approve + the follow-up endpoint, the CEO endpoint, and the bulk endpoint, whose
TDS runs AFTER its commit (a cheque moved before that phase would keep its gross amount untaxed).

⚠️ RUNS AGAINST THE LIVE SITE DATABASE (the endpoints commit). Every row is planted through
`TaxedWorkOrderFixture` and purged by it: `TEST-TWO-*`, plus every payment minted under its projects.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.payments import bulk_actions
from nirmaan_stack.api.payments.project_payments import (
	ceo_approve_payment,
	create_payment_request_for_service,
	move_cheque_payment_to_reconciliation,
	update_payment_request,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import payment_tds

PAYMENT = "Project Payments"
SR = "Service Requests"
PO = "Procurement Orders"
U = "Administrator"
RECON = "Reconciliation Pending"

CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestChequePayments(FrappeTestCase):
	def setUp(self):
		frappe.set_user(U)
		self.fx = TaxedWorkOrderFixture.attach(self)
		self.project = self.fx.project()
		self.vendor = self.fx.vendor(2.0)
		self.sr = self.fx.service_request(self.project, self.vendor)
		# A fresh project has no accountants, but the auto-approve admin note reaches every real
		# admin on the live site -- keep it off.
		quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
		quiet.start()
		self.addCleanup(quiet.stop)

	def tearDown(self):
		frappe.set_user(U)

	# -- helpers --------------------------------------------------------------------------------
	def _plant(self, amount, status, *, cheque=True, cheque_no=None, sr=None, po=None):
		"""A payment already sitting at `status`, planted like the fixture plants its own."""
		name = self.fx._name("PAY")
		parent_dt, parent = (PO, po) if po else (SR, sr or self.sr)
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, amount, status, document_type, document_name,
				   mode_of_payment, cheque_no, cheque_date)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
			(
				name, U, U, self.project, self.vendor, flt(amount), status, parent_dt, parent,
				"Cheque" if cheque else "Online",
				(cheque_no or self._cheque_no()) if cheque else None,
				nowdate() if cheque else None,
			),
		)
		if po:
			frappe.db.sql(
				"""INSERT INTO "tabPO Payment Terms" (name, creation, modified, modified_by, owner, docstatus,
					   idx, vendor, project, payment_type, label, percentage, amount, term_status,
					   project_payment, parent, parentfield, parenttype)
				   VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, %s, 'Delivery against Payment', 'Test term',
						   50, %s, %s, %s, %s, 'payment_terms', %s)""",
				(frappe.generate_hash(length=10), U, U, self.vendor, self.project, flt(amount), status, name, po, PO),
			)
		self.fx.payments.append(name)
		frappe.db.commit()
		return name

	def _po(self):
		"""A bare PO. `Delivered`, so `procurement_orders.on_update` takes none of its status branches."""
		name = self.fx._name("PO")
		frappe.db.sql(
			"""INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, total_amount, amount_paid, status)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 0, 'Delivered')""",
			(name, U, U, self.project, self.vendor),
		)
		frappe.db.commit()

		def purge():
			frappe.db.delete("PO Payment Terms", {"parent": name})
			frappe.db.delete("Version", {"ref_doctype": PO, "docname": name})
			frappe.db.delete(PO, {"name": name})
			frappe.db.commit()

		self.addCleanup(purge)  # runs before the fixture's own purge (cleanups are LIFO)
		return name

	@staticmethod
	def _cheque_no():
		return f"TESTCHQ-{frappe.generate_hash(length=8)}"

	def _state(self, name):
		row = frappe.db.get_value(PAYMENT, name, ["status", "amount"], as_dict=True)
		deductions = frappe.get_all(payment_tds.TDS_DOCTYPE, filters={"project_payment": name}, pluck="tds_amount")
		return row.status, flt(row.amount), [flt(d) for d in deductions]

	def _as_ceo(self, fn, *args, **kwargs):
		frappe.set_user(CEO_AUTHORIZED_USER)
		try:
			result = fn(*args, **kwargs)
			frappe.db.commit()
			return result
		finally:
			frappe.set_user(U)

	# -- every approval route: taxed once at Approved, then Reconciliation Pending -------------
	def test_auto_approved_cheque_is_taxed_then_moved(self):
		with patch(f"{CONTROLLER}.get_allowed_accountants") as accountants:
			out = json.loads(create_payment_request_for_service(json.dumps({
				"doctype": SR, "docname": self.sr, "amount": 10000,
				"mode_of_payment": "Cheque", "cheque_no": self._cheque_no(), "cheque_date": nowdate(),
			})))
		self.assertEqual(self._state(out["name"]), (RECON, 9800.0, [200.0]))
		# "Payment Ready to Fulfil" points at a tab a cheque never stays in.
		accountants.assert_not_called()

	def test_auto_approved_online_payment_is_unchanged(self):
		out = json.loads(create_payment_request_for_service(json.dumps({
			"doctype": SR, "docname": self.sr, "amount": 10000,
		})))
		self.assertEqual(self._state(out["name"]), ("Approved", 9800.0, [200.0]))
		self.assertEqual(frappe.db.get_value(PAYMENT, out["name"], "mode_of_payment"), "Online")

	def test_l1_single_approve_then_the_endpoint_moves_it(self):
		name = self._plant(20000, "Requested")
		# What the browser's `updateDoc` does for an L1 approval in the 15k-50k band.
		doc = frappe.get_doc(PAYMENT, name)
		doc.update({"status": "Approved", "amount": 20000, "approval_date": nowdate()})
		doc.save()
		frappe.db.commit()
		self.assertEqual(self._state(name), ("Approved", 19600.0, [400.0]))

		self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": True})
		self.assertEqual(self._state(name), (RECON, 19600.0, [400.0]))
		# Repeated or stray calls are harmless.
		self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": False})
		self.assertEqual(self._state(name), (RECON, 19600.0, [400.0]))

	def test_the_endpoint_leaves_an_online_payment_alone(self):
		name = self._plant(20000, "Approved", cheque=False)
		self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": False})
		self.assertEqual(self._state(name)[0], "Approved")

	def test_ceo_approved_cheque_is_taxed_then_moved(self):
		name = self._plant(60000, "CEO Pending")
		res = self._as_ceo(ceo_approve_payment, name)
		self.assertIn("Reconciliation Pending", res["message"])
		self.assertEqual(self._state(name), (RECON, 58800.0, [1200.0]))

	def test_bulk_approve_moves_the_cheque_only_after_its_tds(self):
		cheque = self._plant(20000, "Requested")
		online = self._plant(20000, "Requested", cheque=False)
		with patch.object(bulk_actions, "_emit_approve_summary"):
			res = bulk_actions.bulk_lead_approve_payments([cheque, online], "approve")["data"]
		self.assertEqual(sorted(res["succeeded"]), sorted([cheque, online]))
		self.assertEqual(res["tds_failed"], [])
		self.assertEqual(self._state(cheque), (RECON, 19600.0, [400.0]))
		self.assertEqual(self._state(online), ("Approved", 19600.0, [400.0]))

	def test_bulk_moves_a_po_cheque_inside_its_group_with_one_po_save(self):
		"""A PO withholds no tax, so its cheque moves in the approval group and the group's ONE PO
		save writes both terms -- a separate move re-saved the whole PO per cheque."""
		po = self._po()
		cheque = self._plant(20000, "Requested", po=po)
		online = self._plant(20000, "Requested", cheque=False, po=po)
		import nirmaan_stack.integrations.controllers.procurement_orders as po_hooks

		with patch.object(bulk_actions, "_emit_approve_summary"), patch.object(
			po_hooks, "on_update", wraps=po_hooks.on_update
		) as po_saved:
			res = bulk_actions.bulk_lead_approve_payments([cheque, online], "approve")["data"]
		self.assertEqual(sorted(res["succeeded"]), sorted([cheque, online]))
		self.assertEqual(po_saved.call_count, 1)
		self.assertEqual(self._state(cheque), (RECON, 20000.0, []))
		self.assertEqual(self._state(online), ("Approved", 20000.0, []))
		terms = dict(frappe.get_all("PO Payment Terms", filters={"parent": po}, fields=["project_payment", "term_status"], as_list=True))
		self.assertEqual(terms, {cheque: RECON, online: "Approved"})

	def test_a_failed_in_group_move_is_retried_after_the_commit(self):
		"""The in-group move fails; the approval stands and the post-commit pass moves it."""
		po = self._po()
		cheque = self._plant(20000, "Requested", po=po)
		real = bulk_actions.cheque_payments.move_to_reconciliation
		calls = []

		def flaky(name, **kwargs):
			calls.append(kwargs)
			if kwargs.get("sync_po_term") is False:
				raise RuntimeError("boom")
			return real(name, **kwargs)

		with patch.object(bulk_actions, "_emit_approve_summary"), patch(
			"nirmaan_stack.services.cheque_payments.move_to_reconciliation", side_effect=flaky
		):
			res = bulk_actions.bulk_lead_approve_payments([cheque], "approve")["data"]
		self.assertEqual(res["succeeded"], [cheque])
		self.assertEqual(len(calls), 2)
		self.assertEqual(self._state(cheque), (RECON, 20000.0, []))
		self.assertEqual(frappe.db.get_value("PO Payment Terms", {"project_payment": cheque}, "term_status"), RECON)

	def test_a_cheque_whose_move_fails_stays_approved_and_taxed(self):
		name = self._plant(60000, "CEO Pending")
		with patch(
			"nirmaan_stack.services.cheque_payments.move_to_reconciliation",
			side_effect=RuntimeError("boom"),
		):
			self._as_ceo(ceo_approve_payment, name)
		# The approval survives; "Mark as Paid" finishes the job from "Payment need to paid".
		self.assertEqual(self._state(name), ("Approved", 58800.0, [1200.0]))

	# -- what may not change on a cheque ----------------------------------------------------------
	def test_the_amount_is_locked_while_awaiting_approval(self):
		name = self._plant(20000, "Requested")
		doc = frappe.get_doc(PAYMENT, name)
		doc.amount = 15000
		with self.assertRaisesRegex(frappe.ValidationError, "amount can't be changed"):
			doc.save()

	def test_the_ceo_cannot_part_approve_a_cheque(self):
		name = self._plant(60000, "CEO Pending")
		with self.assertRaisesRegex(frappe.ValidationError, "can't be part-approved"):
			self._as_ceo(ceo_approve_payment, name, approved_amount=30000)
		self.assertEqual(self._state(name), ("CEO Pending", 60000.0, []))

	def test_the_mode_is_locked_after_creation(self):
		name = self._plant(20000, "Requested")
		doc = frappe.get_doc(PAYMENT, name)
		doc.mode_of_payment = "Online"
		with self.assertRaisesRegex(frappe.ValidationError, "Value cannot be changed"):
			doc.save()

	# -- the request's own checks -----------------------------------------------------------------
	def _new(self, **fields):
		doc = frappe.new_doc(PAYMENT)
		doc.update({
			"document_type": SR, "document_name": self.sr, "project": self.project,
			"vendor": self.vendor, "amount": 20000, "status": "Requested", **fields,
		})
		return doc

	def test_a_cheque_needs_its_number_and_date(self):
		with self.assertRaisesRegex(frappe.ValidationError, "Cheque No and Cheque Date"):
			self._new(mode_of_payment="Cheque", cheque_date=nowdate())._validate_cheque()
		with self.assertRaisesRegex(frappe.ValidationError, "Cheque No and Cheque Date"):
			self._new(mode_of_payment="Cheque", cheque_no=self._cheque_no())._validate_cheque()

	def test_a_cheque_must_be_for_a_positive_amount(self):
		doc = self._new(mode_of_payment="Cheque", cheque_no=self._cheque_no(), cheque_date=nowdate(), amount=-500)
		with self.assertRaisesRegex(frappe.ValidationError, "greater than zero"):
			doc._validate_cheque()

	def test_an_online_payment_carries_no_cheque(self):
		doc = self._new(mode_of_payment="Online", cheque_no="123", cheque_date=nowdate())
		doc._validate_cheque()
		self.assertIsNone(doc.cheque_no)
		self.assertIsNone(doc.cheque_date)

	def test_one_cheque_number_may_cover_several_payments(self):
		"""Owner, 2026-09-19 -- reversing the same day's "one number, one live payment" rule."""
		number = self._cheque_no()
		self._plant(20000, "Requested", cheque_no=number)
		second = self._new(mode_of_payment="Cheque", cheque_no=f"  {number} ", cheque_date=nowdate())
		second._validate_cheque()  # accepted, not refused
		self.assertEqual(second.cheque_no, number)  # still trimmed

	# -- reconciling one cheque that covers several payments -----------------------------------
	def _fulfil(self, name, utr):
		update_payment_request(json.dumps({"action": "fulfil", "name": name, "utr": utr, "pay_date": nowdate()}))
		frappe.db.commit()

	def test_payments_on_one_cheque_all_reconcile_against_its_number(self):
		number = self._cheque_no()
		first = self._plant(20000, RECON, cheque_no=number)
		second = self._plant(30000, RECON, cheque_no=number)
		self._fulfil(first, number)
		self._fulfil(second, number)  # the same reference: refused before, allowed for the same cheque
		for name in (first, second):
			self.assertEqual(frappe.db.get_value(PAYMENT, name, ["status", "utr"]), ("Paid", number))

	def test_a_reference_held_by_another_payment_still_blocks_a_cheque(self):
		"""Only payments on the SAME cheque excuse each other."""
		number = self._cheque_no()
		other = self._plant(20000, RECON, cheque=False)
		self._fulfil(other, number)  # an online payment took this reference first
		cheque = self._plant(20000, RECON, cheque_no=self._cheque_no())
		with self.assertRaisesRegex(frappe.ValidationError, "already recorded"):
			self._fulfil(cheque, number)
		self.assertEqual(frappe.db.get_value(PAYMENT, cheque, "status"), RECON)

	def test_an_online_payment_keeps_the_strict_rule(self):
		number = self._cheque_no()
		first = self._plant(20000, RECON, cheque=False)
		second = self._plant(20000, RECON, cheque=False)
		self._fulfil(first, number)
		with self.assertRaisesRegex(frappe.ValidationError, "already recorded"):
			self._fulfil(second, number)

	# -- the request cap --------------------------------------------------------------------------
	def test_the_cap_counts_reconciliation_pending(self):
		sr = self.fx.service_request(self.project, self.vendor, total=30000)
		self._plant(20000, RECON, cheque=False, sr=sr)
		with self.assertRaisesRegex(frappe.ValidationError, "Maximum amount you can request"):
			create_payment_request_for_service(json.dumps({"doctype": SR, "docname": sr, "amount": 15000}))
		out = json.loads(create_payment_request_for_service(json.dumps({"doctype": SR, "docname": sr, "amount": 9000})))
		self.assertTrue(frappe.db.exists(PAYMENT, out["name"]))

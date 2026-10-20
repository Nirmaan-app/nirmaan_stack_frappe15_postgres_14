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
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
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
from nirmaan_stack.services.cheques.rules import ChequeHeader, ChequeLineInput
from nirmaan_stack.services.cheques.writer import create_cheque, create_payment_cheque

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
	def _plant(self, amount, status, *, cheque=True, cheque_no=None, sr=None, po=None, gst=False):
		"""A payment already sitting at `status`, planted like the fixture plants its own."""
		name = self.fx._name("PAY")
		parent_dt, parent = (PO, po) if po else (SR, sr or self.sr)
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
				   docstatus, idx, project, vendor, amount, status, document_type, document_name,
				   mode_of_payment, cheque_no, cheque_date, is_gst_payment)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
			(
				name, U, U, self.project, self.vendor, flt(amount), status, parent_dt, parent,
				"Cheque" if cheque else "Online",
				(cheque_no or self._cheque_no()) if cheque else None,
				nowdate() if cheque else None,
				1 if gst else 0,
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
				   docstatus, idx, project, vendor, total_amount, amount, tax_amount, amount_paid, status)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 10000000, 10000000, 0, 0, 'Delivered')""",
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
	def test_auto_approved_cheque_is_moved_straight_on(self):
		# A PO cheque: a Work Order payment is paid Online since spec #1477 (#1487), and a PO withholds no tax.
		ChequeFixture.attach(self)  # the request makes the payment's one-line Cheque (#1414)
		with patch(f"{CONTROLLER}.get_allowed_accountants") as accountants:
			out = json.loads(create_payment_request_for_service(json.dumps({
				"doctype": PO, "docname": self._po(), "amount": 10000,
				"mode_of_payment": "Cheque", "cheque_no": self._cheque_no(), "cheque_date": nowdate(),
				"bank": "ICICI Bank", "cheque_amount": 10000,
				"cheque_attachment": "https://storage.example.invalid/private/files/cheque-test.jpg",
			})))
		self.assertEqual(self._state(out["name"]), (RECON, 10000.0, []))
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

	# -- a GST cheque (ADR-0030): never taxed, so it is written and moved at its full amount -------
	def test_a_gst_cheque_is_moved_at_its_full_amount_on_single_approve(self):
		name = self._plant(20000, "Requested", gst=True)
		doc = frappe.get_doc(PAYMENT, name)
		doc.update({"status": "Approved", "amount": 20000, "approval_date": nowdate()})
		doc.save()
		frappe.db.commit()
		self.assertEqual(self._state(name), ("Approved", 20000.0, []))

		self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": True})
		self.assertEqual(self._state(name), (RECON, 20000.0, []))

	def test_a_ceo_approved_gst_cheque_is_moved_untaxed(self):
		name = self._plant(60000, "CEO Pending", gst=True)
		self._as_ceo(ceo_approve_payment, name)
		self.assertEqual(self._state(name), (RECON, 60000.0, []))

	def test_bulk_approve_moves_a_gst_cheque_untaxed_beside_a_taxed_base_one(self):
		gst = self._plant(20000, "Requested", gst=True)
		base = self._plant(20000, "Requested")
		with patch.object(bulk_actions, "_emit_approve_summary"):
			res = bulk_actions.bulk_lead_approve_payments([gst, base], "approve")["data"]
		self.assertEqual(sorted(res["succeeded"]), sorted([gst, base]))
		self.assertEqual(self._state(gst), (RECON, 20000.0, []))
		self.assertEqual(self._state(base), (RECON, 19600.0, [400.0]))

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

	# -- the payment's Cheque: Pending until approved, then Issued (#1479, spec #1477) ----------
	def _on_new_cheque(self, payment):
		"""Put `payment` on its own one-line Cheque, as Request Payment in Cheque mode does."""
		if not hasattr(self, "_cheques"):
			self._cheques = ChequeFixture.attach(self)
		header = ChequeHeader(
			bank="ICICI Bank", bank_name=None, cheque_no=self._cheque_no(), cheque_date=nowdate(),
			amount=flt(frappe.db.get_value(PAYMENT, payment, "amount")), vendor=self.vendor, payee_name=None,
			description=None, attachment="https://storage.example.invalid/private/files/cheque-test.jpg",
		)
		cheque = self._cheques.track(create_payment_cheque(header, payment, user=U).name)
		frappe.db.commit()
		return cheque

	def _cheque_state(self, cheque):
		"""`(status, issue date, history moves)` of a Cheque, as the Tracker shows them."""
		doc = frappe.get_doc("Cheques", cheque)
		issue_date = str(doc.issue_date) if doc.issue_date else None
		return doc.status, issue_date, [(h.from_status, h.to_status) for h in doc.status_history]

	def _approved_by_l1(self, name, on, *, to="Approved"):
		"""What the browser's `updateDoc` does for an L1 approval, dated `on`: Approved, or forwarded
		to the CEO above 50,000."""
		doc = frappe.get_doc(PAYMENT, name)
		doc.update({"status": to, "amount": doc.amount, "approval_date": on})
		doc.save()
		frappe.db.commit()

	def test_a_requested_payment_puts_its_cheque_at_pending(self):
		cheque = self._on_new_cheque(self._plant(20000, "Requested", po=self._po()))
		self.assertEqual(self._cheque_state(cheque), ("Approval Pending", None, [(None, "Approval Pending")]))

	def test_l1_approve_issues_the_cheque_on_the_approval_date(self):
		name = self._plant(20000, "Requested", po=self._po())
		cheque = self._on_new_cheque(name)
		two_days_ago = add_days(nowdate(), -2)
		self._approved_by_l1(name, two_days_ago)
		# Approved but not yet moved on: the cheque waits with it.
		self.assertEqual(self._cheque_state(cheque)[0], "Approval Pending")

		self.assertEqual(move_cheque_payment_to_reconciliation(name), {"moved": True})
		self.assertEqual(self._state(name)[0], RECON)
		self.assertEqual(self._cheque_state(cheque), ("Issued", two_days_ago, [(None, "Approval Pending"), ("Approval Pending", "Issued")]))
		# A repeated call issues nothing twice.
		move_cheque_payment_to_reconciliation(name)
		self.assertEqual(len(self._cheque_state(cheque)[2]), 2)

	def test_a_ceo_path_cheque_is_issued_on_the_ceos_approval_date(self):
		name = self._plant(60000, "Requested", po=self._po())
		cheque = self._on_new_cheque(name)
		self._approved_by_l1(name, add_days(nowdate(), -3), to="CEO Pending")
		self.assertEqual(self._state(name)[0], "CEO Pending")
		self.assertEqual(self._cheque_state(cheque)[0], "Approval Pending")

		self._as_ceo(ceo_approve_payment, name)
		self.assertEqual(self._state(name)[0], RECON)
		self.assertEqual(self._cheque_state(cheque), ("Issued", nowdate(), [(None, "Approval Pending"), ("Approval Pending", "Issued")]))

	def test_bulk_approve_issues_po_and_wo_cheques(self):
		po_payment = self._plant(20000, "Requested", po=self._po())
		wo_payment = self._plant(20000, "Requested")
		po_cheque, wo_cheque = self._on_new_cheque(po_payment), self._on_new_cheque(wo_payment)
		with patch.object(bulk_actions, "_emit_approve_summary"):
			res = bulk_actions.bulk_lead_approve_payments([po_payment, wo_payment], "approve")["data"]
		self.assertEqual(sorted(res["succeeded"]), sorted([po_payment, wo_payment]))
		for payment, cheque in ((po_payment, po_cheque), (wo_payment, wo_cheque)):
			self.assertEqual(self._state(payment)[0], RECON)
			self.assertEqual(self._cheque_state(cheque), ("Issued", nowdate(), [(None, "Approval Pending"), ("Approval Pending", "Issued")]))

	def test_a_cheque_that_cannot_be_issued_holds_its_payment_where_it_was(self):
		"""The approval, the move and the issue are one decision (#1480): none lands without the others."""
		name = self._plant(60000, "CEO Pending", po=self._po())
		cheque = self._on_new_cheque(name)
		with patch("nirmaan_stack.services.cheques.status.issue", side_effect=RuntimeError("boom")):
			with self.assertRaises(RuntimeError):
				self._as_ceo(ceo_approve_payment, name)
		frappe.db.rollback()
		self.assertEqual(self._state(name)[0], "CEO Pending")
		self.assertEqual(self._cheque_state(cheque), ("Approval Pending", None, [(None, "Approval Pending")]))

	def test_a_payment_already_moved_on_makes_its_new_cheque_issued_at_once(self):
		name = self._plant(20000, RECON, po=self._po())
		frappe.db.set_value(PAYMENT, name, "approval_date", add_days(nowdate(), -5), update_modified=False)
		frappe.db.commit()
		cheque = self._on_new_cheque(name)
		self.assertEqual(
			self._cheque_state(cheque), ("Issued", add_days(nowdate(), -5), [(None, "Approval Pending"), ("Approval Pending", "Issued")])
		)

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

	def test_the_mode_changes_only_through_a_cheque(self):
		"""Spec #1407: Online -> Cheque only by putting the payment on a Cheque; Cheque -> Online only
		once its Cheque is Cancelled, or when it is on no Cheque (`test_cheque_lines` covers both
		allowed moves through a Cheque)."""
		ChequeFixture.attach(self)
		number = self._cheque_no()
		cheque = self._plant(20000, "Requested", cheque_no=number)
		self._on_one_cheque(number, cheque)
		doc = frappe.get_doc(PAYMENT, cheque)
		doc.mode_of_payment = "Online"
		with self.assertRaisesRegex(frappe.ValidationError, "back to Online only once its Cheque is Cancelled"):
			doc.save()
		frappe.db.rollback()

		# The backfill refused its number, so no Cheque holds it: nothing keeps it a Cheque payment.
		orphan = self._plant(20000, "Requested")
		doc = frappe.get_doc(PAYMENT, orphan)
		doc.mode_of_payment = "Online"
		doc.save()
		frappe.db.commit()
		self.assertEqual(tuple(frappe.db.get_value(PAYMENT, orphan, ["mode_of_payment", "cheque_no"])), ("Online", None))

		online = self._plant(20000, "Requested", cheque=False)
		doc = frappe.get_doc(PAYMENT, online)
		doc.update({"mode_of_payment": "Cheque", "cheque_no": self._cheque_no(), "cheque_date": nowdate()})
		with self.assertRaisesRegex(frappe.ValidationError, "becomes a Cheque payment by putting it on a Cheque"):
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

	def _on_one_cheque(self, number, *payments, bank="ICICI Bank", bank_name=None):
		"""Put `payments` on one new Cheque (#1419: the guard keys on the Cheque link)."""
		header = ChequeHeader(
			bank=bank, bank_name=bank_name, cheque_no=number, cheque_date=nowdate(),
			amount=sum(flt(frappe.db.get_value(PAYMENT, p, "amount")) for p in payments), vendor=self.vendor,
			payee_name=None, description=None, attachment="https://storage.example.invalid/private/files/cheque-test.jpg",
		)
		lines = [
			ChequeLineInput(line_type="PO/WO Payment", project=self.project, record_doctype=SR, record_name=self.sr,
							payment_doctype=PAYMENT, payment_name=p, amount=0)
			for p in payments
		]
		doc = create_cheque(header, user=U, made_from="Report", lines=lines)
		# Old-type: a live Payment cheque's payments are paid only by clearing it (spec #1477), so the
		# payments screen's fulfil -- and the shared-reference rule it checks -- is an Old-type cheque's.
		frappe.db.set_value("Cheques", doc.name, "old_type", 1, update_modified=False)
		frappe.db.commit()

	def test_payments_on_one_cheque_all_reconcile_against_its_number(self):
		ChequeFixture.attach(self)
		number = self._cheque_no()
		first = self._plant(20000, RECON, cheque_no=number)
		second = self._plant(30000, RECON, cheque_no=number)
		self._on_one_cheque(number, first, second)
		self._fulfil(first, number)
		self._fulfil(second, number)  # the same reference: refused before, allowed for the same cheque
		for name in (first, second):
			self.assertEqual(frappe.db.get_value(PAYMENT, name, ["status", "utr"]), ("Paid", number))

	def test_the_same_number_on_two_cheques_still_blocks(self):
		"""The siblings are the payments on the same Cheque, not every payment sharing its number (#1419):
		cheque 004521 of ICICI Bank and cheque 004521 of another bank are two cheques."""
		ChequeFixture.attach(self)
		number = self._cheque_no()
		icici = self._plant(20000, RECON, cheque_no=number)
		other_bank = self._plant(30000, RECON, cheque_no=number)
		self._on_one_cheque(number, icici)
		self._on_one_cheque(number, other_bank, bank="Others", bank_name="HDFC Bank")
		self._fulfil(icici, number)
		with self.assertRaisesRegex(frappe.ValidationError, "already recorded"):
			self._fulfil(other_bank, number)
		self.assertEqual(frappe.db.get_value(PAYMENT, other_bank, "status"), RECON)

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

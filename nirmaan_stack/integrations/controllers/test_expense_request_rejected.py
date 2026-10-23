# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An Expense Request follows its expense into Rejected (code review, 2026-10-23).

The hook's rule only: a stand-in expense and patched database calls, so nothing is written to the live site.

Run:
  bench --site localhost run-tests --module nirmaan_stack.integrations.controllers.test_expense_request_rejected
"""

import unittest
from unittest.mock import patch

import frappe

from nirmaan_stack.integrations.controllers import expense_request_status as ers


class _Expense:
	"""Just what `on_expense_rejected` reads off a ledger row."""

	def __init__(self, status, changed=True, request_id="EXR-TEST-1", reason=None, previous="Approved"):
		self.status = status
		self._changed = changed
		self._request_id = request_id
		self._previous = previous
		self.flags = frappe._dict(rejection_reason=reason)

	def get_doc_before_save(self):
		return frappe._dict(status=self._previous)

	def has_value_changed(self, field):
		return field == "status" and self._changed

	def get(self, field):
		return self._request_id if field == "request_id" else None


class TestRequestFollowsRejection(unittest.TestCase):
	def run_hook(self, expense, request_status="Approved"):
		with patch.object(ers.frappe.db, "get_value", return_value=request_status) as get_value, \
				patch.object(ers.frappe.db, "set_value") as set_value:
			ers.on_expense_rejected(expense)
		return get_value, set_value

	def test_an_approved_request_is_rejected_with_the_queue_reason(self):
		_, set_value = self.run_hook(_Expense("Rejected", reason=" Duplicate bill "))
		set_value.assert_called_once_with(
			"Expense Request", "EXR-TEST-1", {"status": "Rejected", "review_comment": "Duplicate bill"}
		)

	def test_no_reason_reaching_the_save_gets_the_fallback(self):
		_, set_value = self.run_hook(_Expense("Rejected"))
		self.assertEqual(set_value.call_args[0][2]["review_comment"], ers.FALLBACK_REJECTION_REASON)

	def test_nothing_happens_otherwise(self):
		cases = {
			"not rejected": _Expense("Approved"),
			"no transition": _Expense("Rejected", changed=False),
			"no request": _Expense("Rejected", request_id=None),
		}
		for name, expense in cases.items():
			with self.subTest(name):
				_, set_value = self.run_hook(expense)
				set_value.assert_not_called()
		for status in ("Pending Approval", "Rejected", "Paid"):
			with self.subTest(request=status):
				_, set_value = self.run_hook(_Expense("Rejected"), request_status=status)
				set_value.assert_not_called()

	def test_an_expense_put_back_out_of_rejected_puts_the_request_back_to_approved(self):
		_, set_value = self.run_hook(_Expense("Approved", previous="Rejected"), request_status="Rejected")
		set_value.assert_called_once_with("Expense Request", "EXR-TEST-1", "status", "Approved")
		for request_status in ("Approved", "Pending Approval", "Paid"):
			with self.subTest(request=request_status):
				_, set_value = self.run_hook(_Expense("Approved", previous="Rejected"), request_status=request_status)
				set_value.assert_not_called()

	def test_the_reason_constants_are_the_engines(self):
		from nirmaan_stack.api.approvals import expense_actions
		self.assertIs(ers.FALLBACK_REJECTION_REASON, expense_actions.FALLBACK_REJECTION_REASON)


if __name__ == "__main__":
	unittest.main()

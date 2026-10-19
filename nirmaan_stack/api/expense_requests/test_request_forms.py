# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The request forms that ship in `fixtures/expense_type.json` (spec #1420 ticket #1430, ADR-0033).

PURE: reads the fixture file, no site and no DB. The fixture is what every migrate re-imports, so
it is what requesters actually get.

A request names who gets paid with a Payee, so no form asks for bank details as free text, and a
form field that only named who gets paid is gone in favour of the Payee picker. Each type that lost
such a field asks for a Payee instead (`payee_rule`).

Run:
  devenv.sh unit nirmaan_stack.api.expense_requests.test_request_forms
"""

import json
import os
import re
import unittest

from nirmaan_stack.services.payees.expense_rules import NOT_ASKED, OPTIONAL, PAYEE_RULES, REQUIRED

FIXTURE = os.path.join(
	os.path.dirname(__file__), os.pardir, os.pardir, "fixtures", "expense_type.json")

# The per-type choice (#1430). Every type not listed here is Not asked.
EXPECTED_RULES = {
	# The landlord's account: a deposit is transferred to, and recovered from, whoever holds it.
	"Accommodation Deposit": REQUIRED,
	# Sometimes paid by card or cash, or a batch with no single payee.
	"Salaries & Employee Wages": OPTIONAL,
	"Rent/PG for Staff": OPTIONAL,
	"Office Maintenance": OPTIONAL,
	"Pooja Expenses": OPTIONAL,
	"Other Financial Expenses": OPTIONAL,
	"Staff Welfare Expenses": OPTIONAL,
}

# Fields that only said who gets paid, now asked through the Payee picker.
PAYEE_NAME_KEYS = {"landlord_name", "landlord_or_pg_name", "employee_name"}
PAYEE_NAME_LABELS = re.compile(r"paid to|landlord|holder", re.I)

# Bank details of the account the money goes to.
BANK_DETAIL = re.compile(r"ifsc|holder|a/c|bank account|account number|bank details", re.I)
# A format may still name the company's OWN account: Bank Interest asks which of our accounts
# the interest is on. That is not who gets paid.
OWN_ACCOUNT_FIELDS = {("Bank Interest", "account_number")}


def _types():
	with open(FIXTURE) as f:
		return json.load(f)


def _fields(row):
	"""(section, field) for every field of the type's format; none for a type without one."""
	fmt = json.loads(row.get("source_format") or "{}")
	for section in fmt.get("sections") or []:
		for field in section.get("fields") or []:
			yield section, field


class TestRequestFormsAskNoBankDetails(unittest.TestCase):
	def test_no_form_asks_for_bank_details_as_free_text(self):
		for row in _types():
			for section, field in _fields(row):
				if (row["name"], field["key"]) in OWN_ACCOUNT_FIELDS:
					continue
				text = " ".join((field["key"], field.get("label") or "", section.get("title") or ""))
				with self.subTest(type=row["name"], field=field["key"]):
					self.assertNotRegex(text.replace("_", " "), BANK_DETAIL)

	def test_no_form_asks_who_gets_paid_as_free_text(self):
		for row in _types():
			for _section, field in _fields(row):
				with self.subTest(type=row["name"], field=field["key"]):
					self.assertNotIn(field["key"], PAYEE_NAME_KEYS)
					self.assertNotRegex(field.get("label") or "", PAYEE_NAME_LABELS)


class TestEachTypeAsksForAPayeeAsChosen(unittest.TestCase):
	def test_every_type_carries_the_chosen_rule(self):
		rows = _types()
		names = {r["name"] for r in rows}
		self.assertFalse(set(EXPECTED_RULES) - names, "a type listed here is not in the fixture")
		for row in rows:
			with self.subTest(type=row["name"]):
				self.assertIn(row.get("payee_rule"), PAYEE_RULES)
				self.assertEqual(row["payee_rule"], EXPECTED_RULES.get(row["name"], NOT_ASKED))


class TestDescriptionTemplatesNameOnlyAskedFields(unittest.TestCase):
	def test_every_placeholder_is_a_field_of_its_form(self):
		"""A `{key}` naming a field the form no longer asks can never be filled, so every new
		request of that type would lose its sentence and fall back to the labelled list."""
		for row in _types():
			fmt = json.loads(row.get("source_format") or "{}")
			template = fmt.get("description_template") or ""
			asked = {field["key"] for _section, field in _fields(row)}
			for key in re.findall(r"\{([A-Za-z0-9_]+)\}", template):
				with self.subTest(type=row["name"], placeholder=key):
					self.assertIn(key, asked)

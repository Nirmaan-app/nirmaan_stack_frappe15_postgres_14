# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Unit tests for the PURE flatten module — no site, no DB.

Run:
  bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.expense_requests.test_flatten
"""

import json
import unittest

from nirmaan_stack.api.expense_requests.flatten import (
	build_label_map,
	first_mapped_attachment,
	flatten_source_data,
)

FORMAT = json.dumps({
	"templateId": "staff-accommodation-rent",
	"templateVersion": 1,
	"sections": [
		{"id": "stay", "type": "fields", "fields": [
			{"key": "occupant_name", "label": "Occupant Name", "type": "text"},
			{"key": "period_from", "label": "Rent Period From", "type": "date"},
			{"key": "nights", "label": "Nights", "type": "number"},
		]},
		{"id": "proof", "type": "image_attachments", "slots": [
			{"key": "bill", "label": "Bill / Receipt", "maps_to": "invoice_attachment"},
			{"key": "extra", "label": "Anything else"},
		]},
	],
})

ANSWERS = json.dumps({
	"templateId": "staff-accommodation-rent",
	"templateVersion": 1,
	"filledAt": "2026-08-18T10:00:00Z",
	"responses": {"stay": {
		"occupant_name": "Wasim Alam",
		"period_from": "2026-08-01",
		"nights": 30,
	}},
	"attachments": {"bill": ["/private/files/aug-rent.pdf"]},
})


class TestFlatten(unittest.TestCase):
	def test_labels_come_from_the_format(self):
		out = flatten_source_data(ANSWERS, FORMAT)
		self.assertIn("Occupant Name: Wasim Alam", out)
		self.assertIn("Rent Period From: 2026-08-01", out)
		self.assertIn(" · ", out)

	def test_missing_format_falls_back_to_readable_keys(self):
		"""A missing label must never cost the accountant the VALUE."""
		out = flatten_source_data(ANSWERS, None)
		self.assertIn("Occupant Name: Wasim Alam", out)  # occupant_name -> title case

	def test_a_format_less_request_flattens_to_empty(self):
		"""The parity guarantee: no answers means exactly the pre-formats description."""
		self.assertEqual(flatten_source_data(None, None), "")
		self.assertEqual(flatten_source_data("", FORMAT), "")
		self.assertEqual(flatten_source_data("{}", FORMAT), "")

	def test_unparseable_answers_degrade_to_empty_not_an_error(self):
		self.assertEqual(flatten_source_data("{not json", FORMAT), "")
		self.assertEqual(flatten_source_data("[1,2]", FORMAT), "")

	def test_zero_and_false_are_kept_but_blanks_are_dropped(self):
		"""A recorded 0 is an ANSWER. Dropping it would misreport the request."""
		data = {"responses": {"s": {"nights": 0, "flag": False, "empty": "", "none": None}}}
		out = flatten_source_data(json.dumps(data), FORMAT)
		self.assertIn("Nights: 0", out)
		self.assertIn("No", out)          # False renders as No
		self.assertNotIn("Empty", out)
		self.assertNotIn("None", out)

	def test_a_bare_answers_dict_is_accepted(self):
		"""A hand-written source_data without the envelope must not be silently ignored."""
		out = flatten_source_data(json.dumps({"stay": {"occupant_name": "Asha"}}), FORMAT)
		self.assertIn("Occupant Name: Asha", out)

	def test_envelope_metadata_never_reaches_the_accountant(self):
		out = flatten_source_data(ANSWERS, FORMAT)
		for noise in ("templateId", "staff-accommodation-rent", "filledAt", "snapshotHash"):
			self.assertNotIn(noise, out)

	def test_repeating_rows_are_numbered(self):
		data = {"responses": {"people": [{"name": "A"}, {"name": "B"}]}}
		out = flatten_source_data(json.dumps(data), None)
		self.assertIn("Row 1: A", out)
		self.assertIn("Row 2: B", out)

	def test_label_map_harvests_fields_slots_and_checklist_items(self):
		labels = build_label_map(FORMAT)
		self.assertEqual(labels["occupant_name"], "Occupant Name")
		self.assertEqual(labels["bill"], "Bill / Receipt")
		self.assertEqual(build_label_map("{not json"), {})
		self.assertEqual(build_label_map(None), {})


class TestMappedAttachment(unittest.TestCase):
	def test_the_declared_slot_wins(self):
		self.assertEqual(
			first_mapped_attachment(ANSWERS, FORMAT), "/private/files/aug-rent.pdf")

	def test_a_format_declaring_none_carries_no_file(self):
		fmt = json.dumps({"sections": [{"id": "p", "type": "image_attachments",
		                                "slots": [{"key": "bill", "label": "Bill"}]}]})
		self.assertIsNone(first_mapped_attachment(ANSWERS, fmt))

	def test_absent_answers_or_format_carry_no_file(self):
		self.assertIsNone(first_mapped_attachment(None, FORMAT))
		self.assertIsNone(first_mapped_attachment(ANSWERS, None))
		self.assertIsNone(first_mapped_attachment("{not json", FORMAT))

	def test_an_empty_slot_carries_no_file(self):
		data = json.dumps({"responses": {}, "attachments": {"bill": []}})
		self.assertIsNone(first_mapped_attachment(data, FORMAT))

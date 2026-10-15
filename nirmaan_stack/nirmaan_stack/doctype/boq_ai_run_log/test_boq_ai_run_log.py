# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

_DOCTYPE = "BoQ AI Run Log"
_TABLE = "tabBoQ AI Run Log"


class TestBoQAIRunLog(FrappeTestCase):

	def test_system_manager_reads_and_nobody_writes(self):
		perms = frappe.get_meta(_DOCTYPE).permissions
		self.assertEqual([p.role for p in perms], ["System Manager"])
		(perm,) = perms
		self.assertEqual((perm.read, perm.report, perm.export), (1, 1, 1))
		for right in ("write", "create", "delete", "submit", "cancel", "amend"):
			self.assertFalse(perm.get(right), right)
		self.assertEqual(frappe.get_meta(_DOCTYPE).in_create, 1)

	def test_every_field_is_read_only_in_the_desk(self):
		layout = ("Section Break", "Column Break")
		editable = [f.fieldname for f in frappe.get_meta(_DOCTYPE).fields
					if f.fieldtype not in layout and not f.read_only]
		self.assertEqual(editable, [])

	def test_the_fields_the_run_log_writes_all_exist(self):
		for fieldname in (
			"boq", "sheet_name", "trigger", "status", "cached", "prompt_version", "job_id",
			"sheet_last_parsed_at", "queued_at", "started_at", "finished_at", "last_heartbeat",
			"library_seconds", "lookup_seconds", "ai_seconds", "chunks_total", "chunks_done",
			"input_tokens", "output_tokens", "suggestion_count", "library_status",
			"library_memory_peak_mib", "failure_category", "error_log", "failure_message",
		):
			self.assertTrue(frappe.db.has_column(_DOCTYPE, fieldname), fieldname)

	def test_the_choices(self):
		meta = frappe.get_meta(_DOCTYPE)
		self.assertEqual(meta.get_field("trigger").options.split("\n"),
						 ["auto-after-parse", "re-parse", "manual"])
		self.assertEqual(meta.get_field("status").options.split("\n"),
						 ["Queued", "Running", "Done", "Failed", "Superseded"])
		self.assertEqual([o for o in meta.get_field("library_status").options.split("\n") if o],
						 ["ok", "rebuilt", "no-examples fallback"])

	def test_the_two_indexes_exist_under_their_own_names(self):
		indexes = dict(frappe.db.sql(
			"SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = %s",
			(_TABLE,),
		))
		self.assertIn("(boq)", indexes["boq_ai_run_log_boq"])
		self.assertIn("(status)", indexes["boq_ai_run_log_status"])

	def test_altering_this_table_can_never_drop_another_tables_index(self):
		"""On PostgreSQL Frappe drops an index BY FIELD NAME, with no table name, when a column is
		indexed in the database but has no search_index flag in the doctype -- and index names are
		unique per schema, so that statement removes another table's index (it removed BOQ Nodes'
		"boq" index during this doctype's first build). Guard: every column of this table that sits
		in an index carries the flag."""
		flagged = {f.fieldname for f in frappe.get_meta(_DOCTYPE).fields if f.search_index}
		self.assertEqual(flagged, {"boq", "status"})
		for fieldname, in frappe.db.sql(
			"""SELECT a.attname FROM pg_index i
			   JOIN pg_class t ON t.oid = i.indrelid
			   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
			   WHERE t.relname = %s AND NOT i.indisprimary""",
			(_TABLE,),
		):
			self.assertIn(fieldname, flagged, f"{fieldname} is indexed without a search_index flag")

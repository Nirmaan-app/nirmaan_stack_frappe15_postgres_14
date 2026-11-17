"""Tests for the table API's pages kept in Redis (`api/data_table/search.py` with `services/table_cache`).

The write tests list ToDos of this test's own (made-up descriptions with a random token), commit them and delete
them afterwards. The comparison tests read Procurement Orders as Administrator and write nothing.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.data_table import search
from nirmaan_stack.services import table_cache as tc

PO_FIELDS = json.dumps(["name", "status", "project", "vendor", "creation", "owner"])


class TestSearchCache(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()  # a list request has written nothing when it asks
        self.token = frappe.generate_hash(length=10)
        tc.watch_writes()  # as before_request does for every web request

    def tearDown(self):
        tc.stop_watching()
        frappe.db.rollback()
        cache = frappe.cache()
        for doctype in ("ToDo", "Procurement Orders"):
            keys = list(cache.scan_iter(match=cache.make_key(f"{tc.PAGE_PREFIX}:{doctype}:*")))
            if keys:
                cache.delete(*keys)

    # ---- helpers -------------------------------------------------------------------------------------------

    def own_todos(self, count=2):
        names = []
        for i in range(count):
            doc = frappe.get_doc({"doctype": "ToDo", "description": f"cache {self.token} {i}"})
            names.append(doc.insert(ignore_permissions=True).name)
        frappe.db.commit()
        self.addCleanup(self.delete_todos, names)
        return names

    def delete_todos(self, names):
        frappe.db.rollback()
        try:
            frappe.db.delete("ToDo", {"name": ["in", names]})
            frappe.db.commit()
        except Exception as error:
            frappe.db.rollback()
            raise AssertionError(f"could not remove test ToDos {names}: {error}") from error

    def todo_page(self, **kwargs):
        frappe.db.rollback()  # each call stands for a new request that has written nothing
        return search.get_list_with_count_enhanced_impl(
            doctype="ToDo",
            fields=json.dumps(["name", "description"]),
            filters=json.dumps([["ToDo", "description", "like", f"%{self.token}%"]]),
            order_by="name asc",
            limit_page_length=kwargs.pop("limit_page_length", 20),
            **kwargs,
        )

    def po_page(self, **kwargs):
        frappe.db.rollback()
        return search.get_list_with_count_enhanced_impl(doctype="Procurement Orders", fields=PO_FIELDS, **kwargs)

    # ---- served from Redis ---------------------------------------------------------------------------------

    def test_the_same_request_again_is_answered_without_asking_postgres(self):
        self.own_todos()
        first = self.todo_page()
        with patch.object(search, "reportview_execute", side_effect=AssertionError("Postgres was asked")):
            second = self.todo_page()
        self.assertEqual(second, first)
        self.assertEqual(second["total_count"], 2)

    def test_to_cache_no_longer_changes_anything(self):
        self.own_todos()
        first = self.todo_page(to_cache=False)
        with patch.object(search, "reportview_execute", side_effect=AssertionError("Postgres was asked")):
            self.assertEqual(self.todo_page(to_cache=True), first)
            self.assertEqual(self.todo_page(to_cache=False), first)

    # ---- always fresh --------------------------------------------------------------------------------------

    def test_every_kind_of_write_is_on_the_next_page(self):
        first, second = self.own_todos()
        self.todo_page()
        def save(text):
            frappe.get_doc("ToDo", first).update({"description": text}).save(ignore_permissions=True)

        def set_value(text):
            frappe.db.set_value("ToDo", first, "description", text)

        def raw_sql(text):
            frappe.db.sql("update `tabToDo` set description = %s where name = %s", (text, first))

        for how, write in {"save": save, "set_value": set_value, "raw SQL": raw_sql}.items():
            text = f"cache {self.token} {how}"
            write(text)
            frappe.db.commit()
            rows = {row["name"]: row["description"] for row in self.todo_page()["data"]}
            self.assertEqual(rows[first], text, how)
        frappe.db.delete("ToDo", {"name": second})
        frappe.db.commit()
        page = self.todo_page()
        self.assertEqual(page["total_count"], 1, "delete")
        self.assertNotIn(second, [row["name"] for row in page["data"]])

    # ---- the two gaps the browser test found (17 Nov), repeated -------------------------------------------

    def descriptions(self):
        return {row["name"]: row["description"] for row in self.todo_page()["data"]}

    def test_d1_a_console_save_right_after_a_page_was_kept_is_on_the_next_page(self):
        first, _ = self.own_todos()
        self.todo_page()  # kept in Redis
        tc.stop_watching()  # the bench console: no request, no job
        frappe.get_doc("ToDo", first).update({"description": f"cache {self.token} console"}).save(
            ignore_permissions=True)
        frappe.db.commit()
        tc.watch_writes()  # the next page is asked by a request, which is watched
        self.assertEqual(self.descriptions()[first], f"cache {self.token} console")

    def test_d2_a_save_that_undoes_a_later_step_is_on_the_next_page(self):
        first, _ = self.own_todos()
        self.todo_page()  # kept in Redis
        frappe.db.set_value("ToDo", first, "description", f"cache {self.token} kept")
        frappe.db.savepoint("search_cache_test_step")
        frappe.db.sql("update `tabToDo` set modified = modified where name = %s", first)
        frappe.db.rollback(save_point="search_cache_test_step")  # Frappe's write counter falls to 0 here
        frappe.db.commit()
        self.assertEqual(self.descriptions()[first], f"cache {self.token} kept")

    # ---- same reply as without the cache -------------------------------------------------------------------

    def test_the_reply_is_the_same_with_the_cache_on_and_off(self):
        po = frappe.db.get_value("Procurement Orders", {"status": ["is", "set"]}, ["name", "status"], as_dict=True,
                                 order_by="name asc")
        self.assertIsNotNone(po, "needs at least one Procurement Order with a status")
        status, name_part = po.status, po.name[:6]
        requests = {
            "default page": {},
            "a filter": {"filters": json.dumps([["Procurement Orders", "status", "=", status]])},
            "sorted, page 2": {"order_by": "creation asc", "limit_start": 10, "limit_page_length": 10},
            "a search": {"search_term": name_part, "current_search_fields": json.dumps(["name"])},
            "totals": {"aggregates_config": json.dumps([{"field": "name", "function": "count"}])},
        }
        for label, request in requests.items():
            with patch.dict(frappe.conf, {"nc_table_cache": 0}):
                fresh = self.po_page(**request)
            self.po_page(**request)  # kept
            kept = self.po_page(**request)  # served from Redis
            self.assertEqual(kept, fresh, label)

    # ---- never kept ----------------------------------------------------------------------------------------

    def test_exports_and_pages_over_the_limit_are_never_kept(self):
        self.own_todos()
        with patch.object(tc, "_keep") as keep:
            self.todo_page(for_export=True)
            self.todo_page(limit_page_length=tc.MAX_ROWS + 1)
        keep.assert_not_called()

    def test_with_the_cache_off_postgres_answers_every_time(self):
        self.own_todos()
        with patch.dict(frappe.conf, {"nc_table_cache": 0}), \
                patch.object(search, "reportview_execute", wraps=search.reportview_execute) as postgres:
            self.todo_page()
            asked_once = postgres.call_count
            self.todo_page()
        self.assertGreater(asked_once, 0)
        self.assertEqual(postgres.call_count, 2 * asked_once)

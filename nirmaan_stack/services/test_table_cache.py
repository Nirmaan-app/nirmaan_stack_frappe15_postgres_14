"""Tests for `services/table_cache`: data-table pages kept in Redis.

Each test uses made-up record-type names for its versions and its own question, so its Redis keys never meet a
real table's, and it removes them afterwards. The race test commits one ToDo of its own and deletes it afterwards.
The scoped users are written with `db_insert` and never committed (the pattern of
`api/pdf_helper/test_bulk_download_scope._restricted_user`).
"""

import threading
import time
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from redis.exceptions import RedisError

from nirmaan_stack.services import table_cache as tc

#: A real record type: a page key needs its permission condition. Administrator has no condition on it.
DOCTYPE = "ToDo"


class TestTableCache(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()  # nothing written yet in this request, as in a list request
        self.token = frappe.generate_hash(length=10)
        self.version_names = []
        self.page_keys = []
        self.users = []
        self.builds = 0

    def tearDown(self):
        tc.stop_watching()
        frappe.set_user("Administrator")
        frappe.db.rollback()  # the scoped users were never committed
        for user in self.users:
            frappe.cache.hdel("user_permissions", user)
            frappe.cache.hdel("roles", user)
        cache = frappe.cache()
        keys = [cache.make_key(f"{tc.VERSION_PREFIX}:{name}") for name in self.version_names]
        keys += self.page_keys + [f"{key}:lock" for key in self.page_keys]
        if keys:
            cache.delete(*keys)

    # ---- helpers -------------------------------------------------------------------------------------------

    def record_type(self, label="A"):
        """A made-up record-type name with its own version key."""
        name = f"Table Cache Test {label} {self.token}"
        self.version_names.append(name)
        return name

    def question(self, **extra):
        """A question no real table asks; its page key is removed after the test."""
        question = {"test": self.token, **extra}
        self.page_keys.append(tc.page_key(DOCTYPE, question))
        return question

    def build(self, reply=None):
        """A stand-in for the table query: counts its runs and numbers its rows by run."""

        def run():
            self.builds += 1
            return reply if reply is not None else {"data": [{"name": f"row-{self.builds}"}], "total_count": 1}

        return run

    def scoped_user(self, role, projects):
        """A throwaway user with `role`, held to `projects` by User Permission rows; never committed."""
        user = f"table-cache-{frappe.generate_hash(length=8)}@example.com"
        self.users.append(user)
        now = frappe.utils.now()

        def insert(doc, name):
            doc.name = name
            doc.creation = doc.modified = now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()

        insert(frappe.get_doc({"doctype": "User", "email": user, "first_name": "Table cache test", "enabled": 1,
                               "user_type": "System User", "send_welcome_email": 0}), user)
        insert(frappe.get_doc({"doctype": "Has Role", "role": role, "parent": user, "parenttype": "User",
                               "parentfield": "roles", "idx": 1}), frappe.generate_hash(length=10))
        for project in projects:
            insert(frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects",
                                   "for_value": project}), f"table-cache-{frappe.generate_hash(length=10)}")
        frappe.cache.hdel("user_permissions", user)
        frappe.cache.hdel("roles", user)
        return user

    def delete_todo(self, name):
        frappe.db.rollback()
        try:
            frappe.db.delete("ToDo", {"name": name})
            frappe.db.commit()
        except Exception as error:
            frappe.db.rollback()
            raise AssertionError(f"could not remove test ToDo {name}: {error}") from error

    # ---- kept and served -----------------------------------------------------------------------------------

    def test_the_same_question_is_built_once_then_served_from_redis(self):
        reads = {self.record_type()}
        question = self.question()
        first = tc.cached_page(DOCTYPE, question, reads, self.build())
        second = tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(self.builds, 1)
        self.assertEqual(second, first)

    def test_a_change_to_any_record_type_the_page_reads_makes_it_built_again(self):
        own, shown = self.record_type("own"), self.record_type("shown")
        question = self.question()
        tc.cached_page(DOCTYPE, question, {own, shown}, self.build())
        tc.bump_version(shown)
        reply = tc.cached_page(DOCTYPE, question, {own, shown}, self.build())
        self.assertEqual(self.builds, 2)
        self.assertEqual(reply["data"][0]["name"], "row-2")
        tc.cached_page(DOCTYPE, question, {own, shown}, self.build())
        self.assertEqual(self.builds, 2)  # kept again, at the new versions

    def test_users_in_different_permission_groups_never_share_a_page(self):
        reads = {self.record_type()}
        question = {"test": self.token}
        for group in ("group-1", "group-2"):
            with patch.object(tc, "permission_group", return_value=group):
                self.page_keys.append(tc.page_key(DOCTYPE, question))
                tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(self.builds, 2)
        with patch.object(tc, "permission_group", return_value="group-1"):
            reply = tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(self.builds, 2)
        self.assertEqual(reply["data"][0]["name"], "row-1")  # group 1's own page, never group 2's

    def test_a_new_day_gets_its_own_page(self):
        reads = {self.record_type()}
        question = {"test": self.token}
        for day in ("2026-11-17", "2026-11-18"):
            with patch.object(tc, "today", return_value=day):
                self.page_keys.append(tc.page_key(DOCTYPE, question))
                tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(self.builds, 2)

    # ---- who shares ----------------------------------------------------------------------------------------

    def test_permission_group_follows_the_users_project_access(self):
        first, second = frappe.get_all("Projects", pluck="name", order_by="name", limit=2)
        role = "Nirmaan Project Manager"
        one = self.scoped_user(role, [first])
        same = self.scoped_user(role, [first])
        other = self.scoped_user(role, [second])
        groups = {}
        for user in (one, same, other, "Administrator"):
            frappe.set_user(user)
            groups[user] = tc.permission_group("Procurement Orders")
        frappe.set_user("Administrator")
        self.assertEqual(groups[one], groups[same])
        self.assertNotEqual(groups[one], groups[other])
        self.assertNotEqual(groups[one], groups["Administrator"])

    def test_read_set_names_every_record_type_a_page_shows(self):
        self.assertEqual(tc.read_set("Procurement Orders", ["name", "status"]), {"Procurement Orders"})
        self.assertEqual(
            tc.read_set("Procurement Orders",
                        ["name", "vendor", "vendor.vendor_name as vendor_name", "project", "owner"]),
            {"Procurement Orders", "Vendors", "Projects", "User", "Nirmaan Users"},
        )
        self.assertIn("Expense Bill", tc.read_set("Project Expenses", ["name"], ["bill_check"]))

    # ---- not kept ------------------------------------------------------------------------------------------

    def test_nothing_is_kept_when_not_cacheable_or_switched_off(self):
        reads = {self.record_type()}
        question = self.question()
        tc.cached_page(DOCTYPE, question, reads, self.build(), cacheable=False)
        tc.cached_page(DOCTYPE, question, reads, self.build(), cacheable=False)
        with patch.dict(frappe.conf, {"nc_table_cache": 0}):
            tc.cached_page(DOCTYPE, question, reads, self.build())
            tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(self.builds, 4)
        self.assertIsNone(frappe.cache().get(self.page_keys[0]))

    def test_a_request_that_has_written_is_built_without_a_rollback_and_not_kept(self):
        reads = {self.record_type()}
        question = self.question()
        with patch.object(frappe.db, "transaction_writes", 1), patch.object(frappe.db, "rollback") as rollback:
            tc.cached_page(DOCTYPE, question, reads, self.build())
            tc.cached_page(DOCTYPE, question, reads, self.build())
        rollback.assert_not_called()
        self.assertEqual(self.builds, 2)
        self.assertIsNone(frappe.cache().get(self.page_keys[0]))

    def test_every_kept_page_expires_and_an_oversized_page_is_not_kept(self):
        reads = {self.record_type()}
        question = self.question()
        tc.cached_page(DOCTYPE, question, reads, self.build())
        ttl = frappe.cache().ttl(self.page_keys[0])
        self.assertTrue(0 < ttl <= tc.KEEP_SECONDS, ttl)
        big = self.question(big=1)
        tc.cached_page(DOCTYPE, big, reads, self.build({"data": "x" * (tc.MAX_BYTES + 1)}))
        self.assertIsNone(frappe.cache().get(self.page_keys[1]))

    def test_without_redis_the_page_is_still_built_and_returned(self):
        reads = {self.record_type()}
        question = self.question()
        redis_class = type(frappe.cache())
        with patch.object(redis_class, "mget", side_effect=RedisError("down")):
            reply = tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(reply["data"][0]["name"], "row-1")
        with patch.object(redis_class, "get", side_effect=RedisError("down")), \
                patch.object(redis_class, "set", side_effect=RedisError("down")):
            reply = tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(reply["data"][0]["name"], "row-2")

    # ---- one build at a time -------------------------------------------------------------------------------

    def test_a_screen_waits_for_another_screens_build_and_reads_it(self):
        reads = {self.record_type()}
        question = self.question()
        key = self.page_keys[0]
        cache = frappe.cache()
        cache.set(f"{key}:lock", 1, ex=tc.LOCK_SECONDS)  # another request is building this page
        stamp = tc.read_stamp(reads)
        assert stamp is not None

        def other_request_keeps_its_page(_seconds):
            tc._keep(cache, key, stamp, {"data": [{"name": "built-by-the-other-request"}]})

        with patch.object(tc.time, "sleep", side_effect=other_request_keeps_its_page):
            reply = tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(self.builds, 0)
        self.assertEqual(reply["data"][0]["name"], "built-by-the-other-request")

    def test_a_screen_builds_the_page_itself_when_the_other_build_never_arrives(self):
        reads = {self.record_type()}
        question = self.question()
        key = self.page_keys[0]
        cache = frappe.cache()
        cache.set(f"{key}:lock", 1, ex=tc.LOCK_SECONDS)
        started = time.monotonic()
        tc.cached_page(DOCTYPE, question, reads, self.build())
        waited = time.monotonic() - started
        self.assertEqual(self.builds, 1)
        self.assertGreaterEqual(waited, tc.WAIT_SECONDS * 0.9)
        self.assertLess(waited, tc.WAIT_SECONDS + 1)
        self.assertEqual(cache.get(f"{key}:lock"), b"1")  # the other request's lock is left alone

    # ---- versions and the fresh read -----------------------------------------------------------------------

    def test_start_fresh_reads_the_versions_then_starts_a_fresh_read(self):
        reads = {self.record_type()}
        with patch.object(frappe.db, "rollback") as rollback:
            stamp = tc.start_fresh(reads)
        self.assertEqual(stamp, tc.read_stamp(reads))
        rollback.assert_called_once_with()

    def test_start_fresh_does_nothing_when_off_or_after_a_write(self):
        reads = {self.record_type()}
        with patch.object(frappe.db, "rollback") as rollback:
            with patch.dict(frappe.conf, {"nc_table_cache": 0}):
                self.assertIsNone(tc.start_fresh(reads))
            with patch.object(frappe.db, "transaction_writes", 1):
                self.assertIsNone(tc.start_fresh(reads))
        rollback.assert_not_called()

    def test_a_caller_that_started_fresh_is_not_rolled_back_again(self):
        reads = {self.record_type()}
        question = self.question()
        stamp = tc.read_stamp(reads)
        with patch.object(frappe.db, "rollback") as rollback:
            tc.cached_page(DOCTYPE, question, reads, self.build(), stamp=stamp)
        rollback.assert_not_called()
        self.assertEqual(self.builds, 1)
        tc.cached_page(DOCTYPE, question, reads, self.build(), stamp=stamp)
        self.assertEqual(self.builds, 1)  # kept under the stamp it was given

    def test_a_miss_starts_a_fresh_read_and_a_hit_does_not(self):
        reads = {self.record_type()}
        question = self.question()
        with patch.object(frappe.db, "rollback") as rollback:
            tc.cached_page(DOCTYPE, question, reads, self.build())
            self.assertEqual(rollback.call_count, 1)
            tc.cached_page(DOCTYPE, question, reads, self.build())
            self.assertEqual(rollback.call_count, 1)

    def test_a_save_committed_after_the_requests_first_query_is_on_the_page(self):
        """A web request opens a new connection, and its first transaction runs at REPEATABLE READ (psycopg2 opens
        it; Frappe's later transactions run at the server default, READ COMMITTED). So the request runs in its own
        thread on a fresh connection, and the save lands between its first query and its cache lookup."""
        version = self.record_type()
        todo = frappe.get_doc({"doctype": "ToDo", "description": f"before {self.token}"}).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self.delete_todo, todo.name)
        question = self.question()
        site, sites_path = frappe.local.site, frappe.local.sites_path
        first_query_done, save_done = threading.Event(), threading.Event()
        seen = {}

        def description():
            return frappe.db.sql("select description from `tabToDo` where name = %s", todo.name)[0][0]

        def list_request():
            frappe.init(site=site, sites_path=sites_path)
            frappe.connect()
            try:
                seen["isolation"] = frappe.db.sql("show transaction_isolation")[0][0]
                seen["first"] = description()  # this request's view of the database is now fixed
                first_query_done.set()
                save_done.wait(timeout=30)
                seen["before_lookup"] = description()
                seen["page"] = tc.cached_page(DOCTYPE, question, {version}, lambda: {"description": description()})
            except Exception as error:
                seen["error"] = repr(error)
            finally:
                frappe.destroy()

        request = threading.Thread(target=list_request)
        request.start()
        self.assertTrue(first_query_done.wait(timeout=30))
        frappe.db.set_value("ToDo", todo.name, "description", f"after {self.token}")
        frappe.db.commit()
        tc.bump_version(version)
        save_done.set()
        request.join(timeout=30)

        self.assertNotIn("error", seen)
        self.assertEqual(seen["isolation"], "repeatable read")
        self.assertEqual(seen["before_lookup"], f"before {self.token}")  # the request's fixed, old view
        self.assertEqual(seen["page"]["description"], f"after {self.token}")  # the fresh read sees the save

    # ---- the write watcher ---------------------------------------------------------------------------------

    def own_todo(self):
        """A committed ToDo of this test's own, deleted afterwards (not watched: tearDown stops watching first)."""
        todo = frappe.get_doc({"doctype": "ToDo", "description": f"watch {self.token}"}).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self.delete_todo, todo.name)
        return todo.name

    def todo_version(self):
        stamp = tc.read_stamp({"ToDo"})
        assert stamp is not None
        return int(stamp.split("=")[1])

    def test_hooks_watch_every_request_and_background_job(self):
        for hook in ("before_request", "before_job"):
            self.assertIn("nirmaan_stack.services.table_cache.watch_writes", frappe.get_hooks(hook))

    def test_a_commit_moves_on_every_record_type_it_wrote_however_it_was_written(self):
        name = self.own_todo()
        tc.watch_writes()
        writes = {
            "save": lambda: frappe.get_doc("ToDo", name).save(ignore_permissions=True),
            "set_value": lambda: frappe.db.set_value("ToDo", name, "description", f"set {self.token}"),
            "raw SQL": lambda: frappe.db.sql("update `tabToDo` set description = %s where name = %s",
                                             (f"sql {self.token}", name)),
        }
        for how, write in writes.items():
            before = self.todo_version()
            write()
            frappe.db.commit()
            self.assertEqual(self.todo_version(), before + 1, how)

    def test_a_child_table_moves_its_parents_too(self):
        self.assertIn("Procurement Orders", tc._child_table_parents().get("PO Payment Terms", ()))
        with patch.object(frappe.db, "transaction_writes", 1), \
                patch.object(tc, "WRITTEN_TABLES_SQL", "select 'tabPO Payment Terms'"):
            found = tc.written_doctypes()
        self.assertEqual(found, {"PO Payment Terms", "Procurement Orders"})

    def test_a_rollback_moves_nothing_and_the_next_commit_still_does(self):
        name = self.own_todo()
        tc.watch_writes()
        before = self.todo_version()
        frappe.db.set_value("ToDo", name, "description", f"undone {self.token}")
        frappe.db.rollback()
        self.assertEqual(self.todo_version(), before)
        frappe.db.set_value("ToDo", name, "description", f"kept {self.token}")
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 1)

    def test_many_commits_keep_one_set_of_callbacks(self):
        name = self.own_todo()
        tc.watch_writes()
        tc.watch_writes()  # a second call arms nothing more
        before = self.todo_version()
        for i in range(3):
            frappe.db.set_value("ToDo", name, "description", f"{i} {self.token}")
            frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 3)
        self.assertEqual(len(frappe.db.before_commit._functions), 1)
        self.assertLessEqual(len(frappe.db.before_rollback._functions), 2)

    def test_a_failing_check_never_breaks_the_save(self):
        name = self.own_todo()
        tc.watch_writes()
        before = self.todo_version()
        with patch.object(tc, "WRITTEN_TABLES_SQL", "select relname from no_such_table"):
            frappe.db.set_value("ToDo", name, "description", f"saved {self.token}")
            frappe.db.commit()
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value("ToDo", name, "description"), f"saved {self.token}")
        self.assertEqual(self.todo_version(), before)  # nothing moved: those pages expire within KEEP_SECONDS
        frappe.db.set_value("ToDo", name, "description", f"again {self.token}")
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 1)  # still watching

    def test_after_stop_watching_a_commit_moves_nothing(self):
        name = self.own_todo()
        tc.watch_writes()
        tc.stop_watching()
        before = self.todo_version()
        frappe.db.set_value("ToDo", name, "description", f"unwatched {self.token}")
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before)

    def test_a_commit_with_nothing_written_moves_nothing_and_reads_no_table_counts(self):
        tc.watch_writes()
        before = self.todo_version()
        with patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql:
            frappe.db.commit()
        asked = [str(c.args[0]) for c in sql.call_args_list if c.args]
        self.assertIn(tc.WROTE_SQL, asked)  # the one cheap question (about 0.07 ms)
        self.assertNotIn(tc.WRITTEN_TABLES_SQL, asked)
        self.assertEqual(self.todo_version(), before)

    # ---- browser gap D2: a write, then a rollback to a savepoint ------------------------------------------------

    def write_then_undo_a_step(self, name, text):
        """A kept write, then a later step undone by a rollback to a savepoint: Frappe's counter falls to 0."""
        frappe.db.set_value("ToDo", name, "description", text)
        frappe.db.savepoint("table_cache_test_step")
        frappe.db.sql("update `tabToDo` set modified = modified where name = %s", name)
        frappe.db.rollback(save_point="table_cache_test_step")
        self.assertEqual(frappe.db.transaction_writes, 0)

    def test_a_write_before_an_undone_step_still_moves_the_version(self):
        name = self.own_todo()
        tc.watch_writes()
        before = self.todo_version()
        self.write_then_undo_a_step(name, f"kept {self.token}")
        self.assertTrue(tc.has_written())
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value("ToDo", name, "description"), f"kept {self.token}")
        self.assertEqual(self.todo_version(), before + 1)

    def test_a_failing_write_question_never_breaks_the_save(self):
        name = self.own_todo()
        tc.watch_writes()
        before = self.todo_version()
        with patch.object(tc, "WROTE_SQL", "select no_such_function()"):
            self.write_then_undo_a_step(name, f"saved {self.token}")
            frappe.db.commit()
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value("ToDo", name, "description"), f"saved {self.token}")
        self.assertEqual(self.todo_version(), before)  # nothing moved: those pages expire within KEEP_SECONDS

    def test_the_cache_never_rolls_back_a_request_that_wrote_before_an_undone_step(self):
        name = self.own_todo()
        self.write_then_undo_a_step(name, f"unsaved {self.token}")
        reads = {self.record_type()}
        question = self.question()
        self.assertIsNone(tc.start_fresh(reads))
        tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(frappe.db.get_value("ToDo", name, "description"), f"unsaved {self.token}")  # still there
        self.assertIsNone(frappe.cache().get(self.page_keys[0]))  # built, not kept

    # ---- browser gap D1: saves outside a request or job (console, patches) ----------------------------------

    def test_a_save_or_delete_outside_a_request_moves_its_record_type_once_committed(self):
        name = self.own_todo()
        before = self.todo_version()
        frappe.get_doc("ToDo", name).update({"description": f"console {self.token}"}).save(ignore_permissions=True)
        self.assertEqual(self.todo_version(), before)  # not before the commit
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 1)
        frappe.delete_doc("ToDo", name, ignore_permissions=True, delete_permanently=True)  # no Deleted Document row
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 2)

    def test_an_unwatched_save_that_is_rolled_back_moves_nothing(self):
        name = self.own_todo()
        before = self.todo_version()
        frappe.get_doc("ToDo", name).update({"description": f"undone {self.token}"}).save(ignore_permissions=True)
        frappe.db.rollback()
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before)
        frappe.get_doc("ToDo", name).update({"description": f"kept {self.token}"}).save(ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 1)  # the next save is still seen

    def test_a_watched_save_moves_the_version_once_not_twice(self):
        name = self.own_todo()
        tc.watch_writes()
        before = self.todo_version()
        frappe.get_doc("ToDo", name).update({"description": f"watched {self.token}"}).save(ignore_permissions=True)
        self.assertIsNone(getattr(frappe.local, tc._SAVED, None))  # left to the watcher
        frappe.db.commit()
        self.assertEqual(self.todo_version(), before + 1)

    def test_every_migrate_moves_every_record_type_on(self):
        before = self.todo_version()
        unread = self.record_type("never versioned")  # stands in for a record type no request has moved yet
        with patch.object(frappe, "get_all", return_value=["ToDo", unread]):
            tc.bump_all_versions()
        self.assertEqual(self.todo_version(), before + 1)
        self.assertEqual(tc.read_stamp({unread}), f"{unread}=1")

    def test_hooks_move_versions_outside_requests_and_after_migrate(self):
        self.assertIn("nirmaan_stack.services.table_cache.bump_all_versions", frappe.get_hooks("after_migrate"))
        star = frappe.get_hooks("doc_events")["*"]
        for event in ("on_change", "after_delete"):
            self.assertIn("nirmaan_stack.services.table_cache.bump_on_save", star[event])

    # ---- counters ------------------------------------------------------------------------------------------

    def test_hits_and_misses_are_counted_per_day(self):
        cache = frappe.cache()
        day = frappe.utils.today()
        hit_key = cache.make_key(f"{tc.STATS_PREFIX}:{day}:hit")
        miss_key = cache.make_key(f"{tc.STATS_PREFIX}:{day}:miss")
        hits, misses = int(cache.get(hit_key) or 0), int(cache.get(miss_key) or 0)
        reads = {self.record_type()}
        question = self.question()
        tc.cached_page(DOCTYPE, question, reads, self.build())
        tc.cached_page(DOCTYPE, question, reads, self.build())
        self.assertEqual(int(cache.get(miss_key)), misses + 1)
        self.assertEqual(int(cache.get(hit_key)), hits + 1)
        self.assertTrue(0 < cache.ttl(hit_key) <= tc.STATS_KEEP_SECONDS)

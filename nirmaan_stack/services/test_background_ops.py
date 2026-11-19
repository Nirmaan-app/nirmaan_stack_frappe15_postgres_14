# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Background operations (ADR 0047, #1662): start, read status, collect result, with a real operation run in-process.

The queue is the only thing faked: `get_queue` hands back a recorder, and a test runs the queued wrapper itself, as
a worker would. Owners are made-up users; nothing here needs a User row, because the module checks only the
session user's name.
"""

import datetime
import json
import logging
import os
import time
import uuid
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import create_job_id, execute_job, get_redis_conn
from redis.commands.core import BasicKeyCommands
from rq.exceptions import NoSuchJobError
from rq.job import Job, JobStatus

from nirmaan_stack.api import background_ops as api
from nirmaan_stack.held_queue_fixture import HeldQueue
from nirmaan_stack.services import background_ops

OWNER = "bgops-owner@example.com"
STRANGER = "bgops-stranger@example.com"
#: The work a test operation does, by dotted path as a flow names it.
_WORK = "nirmaan_stack.services.test_background_ops.work"


def work(label="first"):
    """A test operation's work: whatever `_behaviour` says, then its result."""
    return _behaviour["run"](label) if "run" in _behaviour else {"label": label}


_behaviour = {}


def _start(**kwargs):
    op_id = str(uuid.uuid4())
    background_ops.start("check", _WORK, op_id=op_id, timeout=60, **kwargs)
    return op_id


def _work_off(queue):
    """Run every queued job in-process the way a worker does: through Frappe's own `execute_job`, which commits
    after the job, while the RQ job stays started with a fresh heartbeat. A worker starts as no particular user."""
    jobs, queue.jobs = queue.jobs, []
    for job in jobs:
        held = Job.create(func="frappe.utils.now", connection=get_redis_conn(), id=job["job_id"])
        held.set_status(JobStatus.STARTED)
        held.last_heartbeat = datetime.datetime.utcnow()
        held.save()
        try:
            frappe.set_user("Guest")
            execute_job(**{**job["kwargs"], "is_async": False})
        finally:
            held.delete()
            frappe.set_user(OWNER)


def _delete_committed(doctype, filters):
    frappe.db.rollback()
    frappe.db.delete(doctype, filters)
    frappe.db.commit()


class _Killed(BaseException):
    """What a worker killed mid-run looks like to the code it ran: it stops, and nothing after it runs."""


def _clock_at(epoch):
    return patch("nirmaan_stack.services.background_ops.time.time", return_value=epoch)


def _clock_ahead(seconds):
    later = time.time() + seconds
    return patch("nirmaan_stack.services.background_ops.time.time", return_value=later)


def _drop_rq_job(op_id):
    """The operation's RQ job vanishes (a flushed queue, a worker that died), so a poll reads it as lost."""
    try:
        Job.fetch(create_job_id(op_id), connection=get_redis_conn()).delete()
    except NoSuchJobError:
        pass


def _racing_after_read(op_id, action, nth=1):
    """Run `action` right after the `nth` read of the operation's record: another process acting between this
    one's read of the record and its write. A real race, at the only point where one can happen."""
    key = frappe.cache().make_key(f"background_op:{op_id}")
    real_get = BasicKeyCommands.get
    reads = []

    def get(connection, name):
        value = real_get(connection, name)
        if name == key and len(reads) < nth:
            reads.append(name)
            if len(reads) == nth:
                action()
        return value

    return patch.object(BasicKeyCommands, "get", get)


class _FakeQueue:
    """Stands in for the RQ queue: records each job instead of handing it to Redis."""

    def __init__(self):
        self.jobs = []

    def enqueue_call(self, func, **kwargs):
        self.jobs.append(kwargs)

    def __enter__(self):
        self._patch = patch("frappe.utils.background_jobs.get_queue", return_value=self)
        self._patch.start()
        return self

    def __exit__(self, *exc):
        self._patch.stop()


class TestBackgroundOps(FrappeTestCase):
    def setUp(self):
        frappe.set_user(OWNER)

    def tearDown(self):
        # Drops any start a test left uncommitted, so its queueing never fires in a later test.
        frappe.db.rollback()
        _behaviour.clear()
        frappe.set_user("Administrator")

    def test_the_owner_reads_a_started_operation_as_queued_and_a_stranger_is_refused(self):
        op_id = str(uuid.uuid4())
        background_ops.start("check", "frappe.utils.now", op_id=op_id, timeout=60)

        self.assertEqual(api.get_status(op_id=op_id)["state"], "queued")
        frappe.set_user(STRANGER)
        with self.assertRaises(frappe.PermissionError):
            api.get_status(op_id=op_id)

    def test_the_operation_is_queued_only_once_the_callers_transaction_commits(self):
        with _FakeQueue() as queue:
            op_id = _start()
            self.assertEqual(queue.jobs, [], "queued before the caller's commit")
            frappe.db.commit()
        self.assertEqual(len(queue.jobs), 1)
        self.assertEqual(api.get_status(op_id=op_id)["state"], "queued")

    def test_a_start_whose_caller_rolls_back_queues_nothing_and_reads_as_failed(self):
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.rollback()
            frappe.db.commit()
        self.assertEqual(queue.jobs, [])
        self.assertEqual(api.get_status(op_id=op_id)["state"], "failed")

    def test_the_same_user_repeating_an_id_gets_the_existing_record_and_nothing_is_queued_again(self):
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            again = background_ops.start("check", _WORK, op_id=op_id, timeout=60, label="second")
            frappe.db.commit()
        self.assertEqual(len(queue.jobs), 1)
        self.assertEqual(again["state"], "queued")
        self.assertEqual(again["enqueued_at"], api.get_status(op_id=op_id)["enqueued_at"])

    def test_an_id_another_user_already_used_is_refused(self):
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            frappe.set_user(STRANGER)
            with self.assertRaises(frappe.PermissionError):
                background_ops.start("check", _WORK, op_id=op_id, timeout=60)
            frappe.db.commit()
        self.assertEqual(len(queue.jobs), 1)

    def _one_check_still_queued(self, queue):
        """Start one operation of kind `check` that allows one per user, commit it, and leave it queued."""
        slot = background_ops._slot_key("check", OWNER)
        frappe.cache().delete(slot)
        self.addCleanup(frappe.cache().delete, slot)
        first = _start(one_per_user="Your first check is still being prepared.")
        frappe.db.commit()
        return first

    def test_a_refused_second_start_queues_nothing_even_when_its_caller_catches_the_refusal_and_commits(self):
        with HeldQueue(self) as queue:
            first = self._one_check_still_queued(queue)
            with self.assertRaises(frappe.ValidationError):
                background_ops.start("check", _WORK, op_id=str(uuid.uuid4()), timeout=60, one_per_user="Second.")
            frappe.db.commit()
        self.assertEqual([job["job_id"] for job in queue.jobs], [create_job_id(first)])

    def test_a_refused_start_reads_as_failed_with_the_running_operations_sentence(self):
        refused = str(uuid.uuid4())
        with HeldQueue(self) as queue:
            self._one_check_still_queued(queue)
            with self.assertRaises(frappe.ValidationError):
                background_ops.start("check", _WORK, op_id=refused, timeout=60, one_per_user="Second.")
            frappe.db.rollback()  # the refused request rolls back

        status = api.get_status(op_id=refused)
        self.assertEqual(status["state"], "failed")
        self.assertEqual(status["error"], "Your first check is still being prepared.")

    def test_the_work_runs_as_its_owner_and_reads_running_then_finished_with_its_result(self):
        seen = {}

        def during(label):
            seen["user"] = frappe.session.user
            seen["state"] = api.get_status(op_id=op_id)["state"]
            return {"label": label}

        _behaviour["run"] = during
        with _FakeQueue() as queue:
            op_id = _start(label="mine")
            frappe.db.commit()
            _work_off(queue)
        self.assertEqual(seen, {"user": OWNER, "state": "running"})
        status = api.get_status(op_id=op_id)
        self.assertEqual((status["state"], status["result"]), ("finished", {"label": "mine"}))
        self.assertLessEqual(status["enqueued_at"], status["started_at"])
        self.assertLessEqual(status["started_at"], status["ended_at"])

    def test_work_that_refuses_reads_as_failed_with_its_own_words(self):
        def refuse(label):
            frappe.throw("Nothing to export.")

        _behaviour["run"] = refuse
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)
        status = api.get_status(op_id=op_id)
        self.assertEqual((status["state"], status["error"]), ("failed", "Nothing to export."))

    def test_work_that_breaks_reads_as_failed_without_its_traceback(self):
        def crash(label):
            raise RuntimeError("secret internals")

        _behaviour["run"] = crash
        since = frappe.utils.now()
        self.addCleanup(_delete_committed, "Error Log", {"method": "Background operation check failed",
                                                         "creation": [">=", since]})
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)
        status = api.get_status(op_id=op_id)
        self.assertEqual(status["state"], "failed")
        self.assertNotIn("secret internals", status["error"])

    def test_finished_is_written_only_after_the_works_own_commit(self):
        marker = f"bgops-check-{frappe.generate_hash(length=8)}"
        self.addCleanup(_delete_committed, "ToDo", {"description": marker})
        _behaviour["run"] = lambda label: frappe.get_doc({"doctype": "ToDo", "description": marker}).insert(
            ignore_permissions=True
        ) and None
        state_when_saved = []
        real_commit = frappe.db.commit

        def commit():
            saving = frappe.db.exists("ToDo", {"description": marker}) and not state_when_saved
            if saving:
                state_when_saved.append(api.get_status(op_id=op_id)["state"])
            real_commit()

        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            with patch.object(frappe.db, "commit", side_effect=commit):
                _work_off(queue)
        self.assertEqual(state_when_saved, ["running"], "finished was readable before the work's writes were saved")
        self.assertEqual(api.get_status(op_id=op_id)["state"], "finished")

    def test_a_running_operation_whose_worker_heartbeat_is_stale_reads_as_lost(self):
        op_id = self._killed_while_running()
        self._rq_job(op_id, heartbeat_age_s=20)
        self.assertEqual(api.get_status(op_id=op_id)["state"], "running")
        self._rq_job(op_id, heartbeat_age_s=120)
        status = api.get_status(op_id=op_id)
        self.assertEqual(status["state"], "lost")
        self.assertIn("stopped", status["error"])

    def test_a_running_operation_whose_queue_job_is_gone_reads_as_lost(self):
        op_id = self._killed_while_running()
        self.assertEqual(api.get_status(op_id=op_id)["state"], "lost")

    def test_a_queued_operation_whose_queue_job_vanished_reads_as_lost_once_it_is_stale(self):
        with _FakeQueue():
            op_id = _start()
            frappe.db.commit()  # "queued" in the record, but the fake queue never held the job
        self.assertEqual(api.get_status(op_id=op_id)["state"], "queued")
        with _clock_ahead(120):
            self.assertEqual(api.get_status(op_id=op_id)["state"], "lost")

    def test_each_ended_operation_writes_one_log_line_even_at_production_log_level(self):
        lines = self._log_lines()
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)
        api.get_status(op_id=op_id)  # reading it again writes nothing more

        (line,) = [line for line in lines if line["op_id"] == op_id]
        self.assertEqual((line["kind"], line["outcome"]), ("check", "finished"))
        for figure in ("queue_wait_s", "run_s", "peak_memory_mb"):
            self.assertIsInstance(line[figure], (int, float), figure)

    def test_a_lost_operations_log_line_does_not_count_the_time_until_the_loss_was_noticed_as_run_time(self):
        lines = self._log_lines()
        op_id = self._killed_while_running()
        with _clock_ahead(600):
            self.assertEqual(api.get_status(op_id=op_id)["state"], "lost")

        (line,) = [line for line in lines if line["op_id"] == op_id]
        self.assertEqual(line["outcome"], "lost")
        self.assertIsNone(line["run_s"])

    def test_only_the_owner_collects_the_finished_file(self):
        op_id = self._finished_with_file(b"%PDF-1.4 the owner's own export", "Own_Report.pdf")

        frappe.set_user(STRANGER)
        frappe.local.response = frappe._dict()
        with self.assertRaises(frappe.PermissionError):
            api.collect_result(op_id=op_id)
        self.assertIsNone(frappe.local.response.get("filecontent"))

        frappe.set_user(OWNER)
        frappe.local.response = frappe._dict()
        api.collect_result(op_id=op_id)
        response = frappe.local.response
        self.assertEqual((response.type, response.filename), ("download", "Own_Report.pdf"))
        self.assertEqual(response.filecontent, b"%PDF-1.4 the owner's own export")
        self.assertEqual(api.get_status(op_id=op_id)["result"]["file"]["filename"], "Own_Report.pdf")

    def test_the_finished_file_is_a_plain_file_in_a_private_folder_no_web_server_serves(self):
        files_before = frappe.db.count("File")
        op_id = self._finished_with_file(b"%PDF-1.4 private", "Private.pdf")

        path = background_ops.result_file_path(op_id)
        with open(path, "rb") as f:
            self.assertEqual(f.read(), b"%PDF-1.4 private")
        private = os.path.realpath(frappe.get_site_path("private"))
        self.assertTrue(os.path.realpath(path).startswith(private + os.sep))
        # Frappe serves `private/files` (to permitted users) and the web server `public`; neither holds it.
        self.assertFalse(os.path.realpath(path).startswith(os.path.join(private, "files")))
        self.assertEqual(frappe.db.count("File"), files_before, "saved through a File, which uploads it")

    def test_a_file_is_not_collected_before_its_operation_finishes(self):
        with _FakeQueue():
            op_id = _start()
            frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            api.collect_result(op_id=op_id)

    def test_progress_tells_the_owner_to_read_now_at_most_every_two_seconds_and_only_the_id(self):
        def progress(label):
            for at, percent in ((0.0, 10), (0.5, 20), (1.9, 30), (2.1, 40), (2.3, 40), (4.0, 40), (4.2, 50)):
                with _clock_at(started + at):
                    background_ops.set_progress(percent, f"{percent}% done")
                    reads.append((at, api.get_status(op_id=op_id)["progress"]["percent"]))

        reads = []
        _behaviour["run"] = progress
        # Ahead of the worker's own read-now at running, but well inside its heartbeat: a clock past the heartbeat
        # would make each status read here call the operation lost, and progress stops at lost.
        started = time.time() + 10
        with _FakeQueue() as queue, patch("frappe.publish_realtime") as publish:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)

        messages = [c for c in publish.call_args_list if c.args[0] == background_ops.READ_NOW_EVENT]
        self.assertTrue(all(c.args[1] == {"op_id": op_id} and c.kwargs["user"] == OWNER for c in messages))
        # running; progress at 0.0, 2.1 and 4.2 (0.5 and 1.9 are too soon, 2.3 and 4.0 changed nothing); finished
        self.assertEqual(len(messages), 5)
        # Every change is in the record at once, sent or not.
        self.assertEqual([percent for _, percent in reads], [10, 20, 30, 40, 40, 40, 50])

    def test_progress_carries_the_works_own_detail_to_the_owner(self):
        def progress(label):
            background_ops.set_progress(40, "Adding 3 of 7", detail={"done": 2, "total": 7, "current": "PO-001"})
            reads.append(api.get_status(op_id=op_id)["progress"])

        reads = []
        _behaviour["run"] = progress
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)

        self.assertEqual(
            reads,
            [{"percent": 40, "message": "Adding 3 of 7", "detail": {"done": 2, "total": 7, "current": "PO-001"}}],
        )

    def test_two_deliveries_of_one_operation_racing_to_start_run_its_work_once(self):
        runs = []
        _behaviour["run"] = lambda label: runs.append(label) or {"label": label}
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            second_delivery = lambda: background_ops.run(op_id, _WORK, {"label": "second"})  # noqa: E731
            with _racing_after_read(op_id, second_delivery):
                _work_off(queue)
        self.assertEqual(len(runs), 1, f"the work ran {len(runs)} times")
        self.assertEqual(api.get_status(op_id=op_id)["state"], "finished")

    def test_progress_racing_a_poll_that_finds_the_worker_gone_does_not_revive_the_operation(self):
        def work_on(label):
            def poll_finds_it_gone():
                _drop_rq_job(op_id)
                seen.append(api.get_status(op_id=op_id)["state"])

            with _racing_after_read(op_id, poll_finds_it_gone):
                background_ops.set_progress(50, "Half way")
            seen.append(api.get_status(op_id=op_id)["state"])
            raise _Killed  # the worker then dies for real: nothing writes the record again

        seen = []
        _behaviour["run"] = work_on
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            with self.assertRaises(_Killed):
                _work_off(queue)
        frappe.set_user(OWNER)
        self.assertEqual(seen, ["lost", "lost"], "a progress write after the lost verdict revived the operation")
        self.assertIsNone(api.get_status(op_id=op_id)["progress"])

    def test_a_worker_that_finishes_after_a_poll_guessed_lost_ends_finished_and_its_file_is_collected(self):
        lines = self._log_lines()

        def finishes_late(label):
            _drop_rq_job(op_id)
            seen.append(api.get_status(op_id=op_id)["state"])
            background_ops.write_result_file(b"%PDF-1.4 late but real", "Late.pdf")
            return {"label": label}

        seen = []
        _behaviour["run"] = finishes_late
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)
        path = background_ops.result_file_path(op_id)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))

        self.assertEqual(seen, ["lost"])
        status = api.get_status(op_id=op_id)
        self.assertEqual((status["state"], status["error"]), ("finished", None))
        self.assertEqual(background_ops.collect(op_id), (b"%PDF-1.4 late but real", "Late.pdf"))
        # The lost line stays (it is what the screen was shown then); the real outcome gets its own line, marked.
        mine = [(line["outcome"], line.get("replaces_lost")) for line in lines if line["op_id"] == op_id]
        self.assertEqual(mine, [("lost", None), ("finished", True)])
        self.assertIsInstance([line for line in lines if line["op_id"] == op_id][1]["run_s"], (int, float))

    def test_a_worker_that_fails_after_a_poll_guessed_lost_ends_failed_in_its_own_words(self):
        def fails_late(label):
            _drop_rq_job(op_id)
            seen.append(api.get_status(op_id=op_id)["state"])
            frappe.throw("Nothing to export.")

        seen = []
        _behaviour["run"] = fails_late
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)
        self.assertEqual(seen, ["lost"])
        status = api.get_status(op_id=op_id)
        self.assertEqual((status["state"], status["error"]), ("failed", "Nothing to export."))

    def test_a_lost_verdict_racing_the_worker_never_replaces_its_finish(self):
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            # The poll reads the record (1st read), finds the job missing, and before it writes lost (2nd read)
            # the worker runs the operation to its end.
            with _clock_ahead(120), _racing_after_read(op_id, lambda: _work_off(queue), nth=2):
                api.get_status(op_id=op_id)
        status = api.get_status(op_id=op_id)
        self.assertEqual((status["state"], status["result"]), ("finished", {"label": "first"}))

    def _finished_with_file(self, content, filename):
        _behaviour["run"] = lambda label: background_ops.write_result_file(content, filename) or {"label": label}
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            _work_off(queue)
        path = background_ops.result_file_path(op_id)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        return op_id

    def _log_lines(self):
        """The background-operation log as production writes it: its logger left at Frappe's production level."""
        logger = frappe.logger("background_ops", allow_site=False)
        level, lines = logger.level, []
        handler = logging.Handler()
        handler.emit = lambda record: lines.append(json.loads(record.getMessage()))
        logger.addHandler(handler)
        logger.setLevel(logging.ERROR)
        self.addCleanup(logger.removeHandler, handler)
        self.addCleanup(logger.setLevel, level)
        return lines

    def _killed_while_running(self):
        """An operation whose worker died mid-run: its record says running, and nothing will write it again."""

        def killed(label):
            raise _Killed

        _behaviour["run"] = killed
        with _FakeQueue() as queue:
            op_id = _start()
            frappe.db.commit()
            with self.assertRaises(_Killed):
                _work_off(queue)
        frappe.set_user(OWNER)
        return op_id

    def _rq_job(self, op_id, heartbeat_age_s):
        """The operation's RQ job as a busy worker keeps it: started, with a heartbeat this many seconds old."""
        job = Job.create(func="frappe.utils.now", connection=get_redis_conn(), id=create_job_id(op_id))
        job.set_status(JobStatus.STARTED)
        job.last_heartbeat = datetime.datetime.utcnow() - datetime.timedelta(seconds=heartbeat_age_s)
        job.save()
        self.addCleanup(job.delete)

    def test_an_operation_with_no_record_reads_as_lost(self):
        # Expired after 24 hours, evicted, or never written: nothing will ever write it again.
        self.assertEqual(api.get_status(op_id=str(uuid.uuid4()))["state"], "lost")

    def test_an_id_that_is_not_a_lowercase_uuid_is_refused(self):
        for bad in ("", "not-an-id", str(uuid.uuid4()).upper(), "../../etc/passwd"):
            with self.assertRaises(frappe.ValidationError):
                api.get_status(op_id=bad)

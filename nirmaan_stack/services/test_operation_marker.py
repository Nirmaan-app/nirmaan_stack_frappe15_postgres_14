"""The "already running?" check of a background operation counts from the start of running (#1660, spec #1654).

The fixtures here serve the four flows' own tests (classify, rate suggest, rate match, hub parse):

  held_in_queue()     a start's operation waits in rq as a real job record with status `queued` that no worker takes
                      (the record is in no queue's list), which is what rq reports while an operation waits
  never_queued()      a start whose operation never reaches rq (its worker never starts)
  queue_call_fails()  a start whose queue call raises
  new_request()       each simulated request starts with an empty per-request cache, as a real request does
  leave_stale_marker(key)  a marker an hour old whose job rq does not know (the next read heals it)
  wait_past_one_second_ttl()  outlast a flow's marker TTL patched to 1 s
  later(seconds)      the clock reads `seconds` later
  fake_job(status)    what rq's get_job returns for a job in that status; started_job() one just started

The tests here pin `operation_marker.job_state` at its edges with real rq job records.
"""

import datetime
import time
from contextlib import contextmanager
from types import SimpleNamespace
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import create_job_id, get_redis_conn
from rq.job import Job, JobStatus


def rq_job(job_id, status, started_ago_sec=None):
    """A real rq job record for raw `job_id`, in no queue (so no worker ever takes it). The caller deletes it."""
    job = Job.create("frappe.ping", connection=get_redis_conn(), id=create_job_id(job_id), status=status)
    if started_ago_sec is not None:
        job.started_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=started_ago_sec)
    job.save()
    return job


def fake_job(status, started_ago_sec=None):
    """What rq's get_job returns for a job in `status` (no rq record needed)."""
    started_at = None
    if started_ago_sec is not None:
        started_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=started_ago_sec)
    return SimpleNamespace(get_status=lambda: status, started_at=started_at)


def started_job():
    """What rq's get_job returns for a job a worker has just started."""
    return fake_job(JobStatus.STARTED, started_ago_sec=0)


@contextmanager
def held_in_queue():
    """frappe.enqueue writes the operation as a `queued` rq job that no worker runs. Yields the jobs made."""
    made = []

    def fake(method, queue=None, timeout=None, job_id=None, **kwargs):
        made.append(rq_job(job_id, JobStatus.QUEUED))
        return made[-1]

    try:
        with mock.patch.object(frappe, "enqueue", side_effect=fake):
            yield made
    finally:
        for job in made:
            job.delete()


@contextmanager
def never_queued():
    """frappe.enqueue returns without the operation reaching rq. Yields the queue calls made."""
    with mock.patch.object(frappe, "enqueue") as enq:
        yield enq


@contextmanager
def queue_call_fails():
    with mock.patch.object(frappe, "enqueue", side_effect=ConnectionError("queue unreachable")):
        yield


def new_request():
    frappe.local.cache = {}


def leave_stale_marker(key):
    """A marker at cache `key` whose job rq does not know, set an hour ago: the next read heals it."""
    frappe.cache().set_value(key, {"job_id": frappe.generate_hash(length=32), "user": "Administrator",
                                   "enqueued_at": str(frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-1))})


def wait_past_one_second_ttl():
    """Outlast a marker TTL patched to 1 s (Redis counts it; no fake clock reaches it)."""
    time.sleep(2.1)


@contextmanager
def later(seconds):
    then = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=seconds)
    with mock.patch("frappe.utils.now", return_value=str(then)):
        yield


class TestJobState(FrappeTestCase):
    """job_state(job_id, marked_at, stale_seconds) -> running | cleared | cleared_stale."""

    def setUp(self):
        self.jobs = []

    def tearDown(self):
        for job in self.jobs:
            job.delete()

    def _job(self, status, started_ago_sec=None):
        job_id = frappe.generate_hash(length=32)
        self.jobs.append(rq_job(job_id, status, started_ago_sec))
        return job_id

    def _state(self, job_id, marked_ago_sec, stale_seconds=60):
        from nirmaan_stack.services.operation_marker import job_state

        marked_at = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=-marked_ago_sec)
        return job_state(job_id, marked_at, stale_seconds)

    def test_a_job_waiting_in_the_queue_is_running_however_long_it_waits(self):
        self.assertEqual(self._state(self._job(JobStatus.QUEUED), marked_ago_sec=7200), "running")

    def test_a_started_job_is_stale_once_it_has_run_past_the_window(self):
        self.assertEqual(self._state(self._job(JobStatus.STARTED, started_ago_sec=61), marked_ago_sec=7200),
                         "cleared_stale")

    def test_a_job_that_started_late_counts_from_its_start(self):
        self.assertEqual(self._state(self._job(JobStatus.STARTED, started_ago_sec=5), marked_ago_sec=7200),
                         "running")

    def test_an_ended_job_clears(self):
        for status in (JobStatus.FINISHED, JobStatus.FAILED, JobStatus.STOPPED, JobStatus.CANCELED):
            self.assertEqual(self._state(self._job(status), marked_ago_sec=1), "cleared", status)

    def test_a_job_not_in_rq_is_running_only_while_its_queue_call_may_still_come(self):
        from nirmaan_stack.services.operation_marker import ENQUEUE_GRACE_SEC

        missing = frappe.generate_hash(length=32)
        self.assertEqual(self._state(missing, marked_ago_sec=1), "running")
        self.assertEqual(self._state(missing, marked_ago_sec=ENQUEUE_GRACE_SEC + 1), "cleared")
        self.assertEqual(self._state(None, marked_ago_sec=ENQUEUE_GRACE_SEC + 1), "cleared")


class TestRelease(FrappeTestCase):
    """A release frees the marker only while it still names the releasing operation, and never a marker another start
    wrote after the release read it."""

    def setUp(self):
        self.key = f"test_operation_marker:{frappe.generate_hash(length=10)}"
        self.addCleanup(frappe.cache().delete_value, self.key)

    def _marker(self):
        frappe.local.cache.pop(frappe.cache().make_key(self.key), None)
        return frappe.cache().get_value(self.key)

    def test_release_frees_the_marker_its_operation_holds(self):
        from nirmaan_stack.services.operation_marker import claim, release

        claim(self.key, {"job_id": "a"})
        release(self.key, "a")
        self.assertIsNone(self._marker())

    def test_release_keeps_a_marker_another_start_wrote_between_its_read_and_its_delete(self):
        import pickle

        from nirmaan_stack.services import operation_marker

        operation_marker.claim(self.key, {"job_id": "a"})

        def read_then_another_start_claims(raw):
            value = pickle.loads(raw)
            if value == {"job_id": "a"}:
                frappe.cache().set_value(self.key, {"job_id": "b"})
            return value

        with mock.patch.object(operation_marker, "pickle", SimpleNamespace(loads=read_then_another_start_claims)):
            operation_marker.release(self.key, "a")
        self.assertEqual(self._marker(), {"job_id": "b"}, "a late release freed another start's marker")

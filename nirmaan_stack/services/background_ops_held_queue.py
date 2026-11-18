# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""A fake RQ queue for tests of background operations (ADR 0047) that need an operation to STAY queued.

`HeldQueue` records each job, as a faked queue does, and also keeps an RQ job of that id in Redis with status
queued, as a real queue does until a worker takes it. A poll (`background_ops.status`) then reads the operation as
queued for as long as the test runs, not lost once HEARTBEAT_STALE_SECONDS have passed since it was queued: a test
of the one-per-user slot holds however slow the run is. No worker sees the job: it is never put on a queue's list.

    with HeldQueue(self) as queue:
        start_something(op_id=...)
        frappe.db.commit()
    queue.jobs  # what reached the queue, for the test to run itself (or not)

The held jobs are deleted when the test ends (`addCleanup`).
"""

from unittest.mock import patch

from frappe.utils.background_jobs import get_redis_conn
from rq.job import Job, JobStatus


class HeldQueue:
    count = 0  # frappe.enqueue reads the queue's length

    def __init__(self, test):
        self.jobs = []
        self._test = test
        self._patch = patch("frappe.utils.background_jobs.get_queue", return_value=self)

    def enqueue_call(self, func, **kwargs):
        self.jobs.append(kwargs)
        job = Job.create(func="frappe.utils.now", connection=get_redis_conn(), id=kwargs["job_id"])
        job.set_status(JobStatus.QUEUED)
        job.save()
        self._test.addCleanup(job.delete)

    def __enter__(self):
        self._patch.start()
        return self

    def __exit__(self, *exc):
        self._patch.stop()

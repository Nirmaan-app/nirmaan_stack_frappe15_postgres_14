# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE POOL BUILD JOB (#1741): what `pool.rebuild_pool` runs, on `long`, for the 06:00 entry
(rate_match.daily_pool_rebuild) and the auto-build check (pool_autobuild), and by hand with force=True:

    rebuild(force=False) -> {"built": True, "path", "rows", "kept", "as_of", "secs", "pricing", "driving", ...cut-off}
                          | {"built": False, "path", "why"}

THE MIGRATE GATE: without `force` it builds nothing and takes no lock until a migrate has finished on this database
(pool_autobuild.site_ready). The manual entry:
`bench --site <site> execute nirmaan_stack.services.boq_rate_match.pool.rebuild_pool --kwargs "{'force': True}"`.

THE POOL BUILD CLOCK starts first thing in the job, before the lock wait, because RQ counts its `long` limit
(rate_match.POOL_REBUILD_TIMEOUT_SEC, 3600 s) from the job's start. On production the driving-field measure took 86 %
of a 3014 s build (2026-11-25), so it is the step bounded: it gets the time left minus TAIL_RESERVE_SEC (the stages
after it and the save, ~140 s on production, with room), and under MIN_DRIVING_SEC it is skipped. A timeout or a skip
leaves driving `available: False` (pricing_step.measure_driving_fields already reports it so; W1 then runs without V1),
the pool is still saved, and one WARNING plus one Error Log row "Match pool built without driving fields" says so.

THE STAGE LOG: the `boq_rate_match` logger at INFO (pool_autobuild.logger), one line per stage as it ENDS, so a killed
job keeps the lines of the stages it finished, then one summary line. Past HALF_LIMIT of the job limit: one WARNING
plus one Error Log row. Error Log rows are committed at once in a job, so a job killed later keeps them (the build
writes nothing else). `pool.secs` keeps its keys: the build's own stage times, the lock wait apart.
"""
import os
import time

import frappe
from filelock import FileLock

TAIL_RESERVE_SEC = 900
MIN_DRIVING_SEC = 60
HALF_LIMIT = 0.5
NO_DRIVING = "Match pool built without driving fields"
PAST_HALF = "Match pool build past half its time limit"


class BuildClock:
    """The job's time against its limit (None: no limit, e.g. the bench's build), and the build's stage times."""

    def __init__(self, limit=None, now=time.monotonic):
        self.limit, self.now = limit, now
        self.started = self._build = self._mark = now()
        self.secs, self._warned = {}, False

    @classmethod
    def for_this_run(cls):
        """The limit is the running RQ job's own timeout (rate_match.POOL_REBUILD_TIMEOUT_SEC when queued as today);
        a build by hand (`bench execute`) runs under no queue limit, so its clock has none."""
        import rq
        job = rq.get_current_job()
        timeout = getattr(job, "timeout", None)
        return cls(limit=timeout if isinstance(timeout, (int, float)) and timeout > 0 else None)

    def elapsed(self):
        return self.now() - self.started

    def begin_build(self):
        self._build = self._mark = self.now()

    def stage(self, name):
        t = self.now()
        self.secs[name] = round(t - self._mark, 1)
        self._mark = t
        _log().info("match pool build: stage %s ended in %.1f s (job at %.0f s%s)", name, self.secs[name], self.elapsed(),
                    f" of {self.limit} s" if self.limit else "")
        if self.limit and not self._warned and self.elapsed() > HALF_LIMIT * self.limit:
            self._warned = True
            self.alarm(PAST_HALF, f"the build is at {self.elapsed():.0f} s of the job's {self.limit} s limit after stage "
                                  f"{name}; stage times so far: {self.secs}")

    def finish(self, **counts):
        self.secs["total"] = round(self.now() - self._build, 1)
        _log().info("match pool build: done in %.1f s (job at %.0f s%s): %s; secs %s", self.secs["total"], self.elapsed(),
                    f" of {self.limit} s" if self.limit else "", counts, self.secs)
        return dict(self.secs)

    def driving_timeout(self):
        """Seconds the driving step may take: the time left minus the tail reserve (the default without a limit)."""
        from nirmaan_stack.services.boq_rate_match import pricing_step
        if not self.limit:
            return pricing_step.MEASURE_TIMEOUT_S
        return int(self.limit - self.elapsed() - TAIL_RESERVE_SEC)

    def alarm(self, title, message):
        _log().warning("match pool build: %s: %s", title, message)
        frappe.log_error(title=title, message=message)
        if self.limit:
            frappe.db.commit()      # in the job: nothing else is written, and a later kill must not lose the row


def _log():
    from nirmaan_stack.services.boq_rate_match import pool_autobuild
    return pool_autobuild.logger()


def measure_driving(clock, page_rows, step_rows, asset):
    """The driving-field step under the clock: bounded, skipped when too little time is left, alarmed when lost."""
    from nirmaan_stack.services.boq_rate_match import pricing_step

    timeout = clock.driving_timeout()
    if timeout < MIN_DRIVING_SEC:
        out = {"available": False, "stamp": None, "lists": {}, "categories": {},
               "reason": f"driving-field step skipped: {timeout + TAIL_RESERVE_SEC} s left of the job's {clock.limit} s "
                         f"limit, under the {TAIL_RESERVE_SEC} s tail reserve + {MIN_DRIVING_SEC} s"}
    else:
        out = pricing_step.measure_driving_fields(page_rows, step_rows, asset=asset, timeout=timeout)
        if out["available"] or "timed out" not in (out["reason"] or ""):
            return out
    clock.alarm(NO_DRIVING, f"{out['reason']}. The pool is saved with driving fields unavailable (W1 runs without V1).")
    return out


def rebuild(force=False, clock=None):
    from nirmaan_stack.services.boq_rate_match import pool as P
    from nirmaan_stack.services.boq_rate_match import pool_autobuild

    clock = clock or BuildClock.for_this_run()
    path = P.pool_path()
    if not force:
        not_ready = pool_autobuild.site_ready()
        if not_ready is not None:
            _log().info("match pool build: refused: %s", not_ready)
            return {"path": path, "built": False, "why": not_ready}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with FileLock(path + ".lock", timeout=P.REBUILD_WAIT_SEC):
        pool = P.build_pool(clock=clock)
        P.save_pool(pool, path)
    return {"path": path, "built": True, "rows": len(pool.rows), "kept": len(pool.kept), "as_of": pool.as_of,
            "secs": pool.secs, "pricing": pool.pricing, "driving": {k: pool.driving[k] for k in ("available", "reason")},
            **getattr(pool, "age", {})}

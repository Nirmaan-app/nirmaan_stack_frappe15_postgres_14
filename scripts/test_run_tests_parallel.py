"""Tests for run_tests_parallel.py and its plan -- no database, no bench: the plan's coverage and the lock scheduler.

Stdlib only:  python3 scripts/test_run_tests_parallel.py
"""

import json
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import run_tests_parallel as rtp  # noqa: E402

APP = Path(__file__).resolve().parent.parent
PLAN = json.loads(rtp.PLAN.read_text(encoding="utf-8"))
RM = "nirmaan_stack.api.boq.test_rate_master"


def boq_test_modules():
    """The full BoQ Python set: every test module under api/boq and services/boq_*, plus services.test_index_manifest
    (the set ELR-3b / ELR-4a ran as their scoped suite)."""
    pkg = APP / "nirmaan_stack"
    files = list((pkg / "api" / "boq").rglob("test_*.py"))
    for d in (pkg / "services").glob("boq_*"):
        files += list(d.rglob("test_*.py"))
    files.append(pkg / "services" / "test_index_manifest.py")
    return sorted(".".join(f.relative_to(APP).with_suffix("").parts) for f in files)


def job(name, series=(), writes=(), reads=(), serial=False, seconds=1):
    return rtp.Job(name, {"series": list(series), "writes": list(writes), "reads": list(reads), "serial": serial,
                          "seconds": seconds})


def run_and_watch(jobs, procs):
    """Schedule `jobs` with a run that sleeps a little; return the pairs that were ever running at the same time and
    the most that ran at once."""
    active, seen, peak, lock = set(), set(), [0], threading.Lock()

    def run(j):
        with lock:
            for other in active:
                seen.add(tuple(sorted((j.name, other))))
            active.add(j.name)
            peak[0] = max(peak[0], len(active))
        time.sleep(0.05)
        with lock:
            active.discard(j.name)
        return j.name

    done = rtp.schedule(jobs, procs, run)
    return seen, peak[0], done


class ThePlan(unittest.TestCase):
    def test_every_boq_module_is_classified_exactly_once(self):
        """A new test module must be measured and classified before the runner will run it -- never left out."""
        self.assertEqual(sorted(PLAN["modules"]), boq_test_modules())

    def test_every_entry_carries_its_measured_locks(self):
        for m, e in PLAN["modules"].items():
            with self.subTest(module=m):
                self.assertGreater(e["seconds"], 0)
                for k in ("series", "writes", "reads"):
                    self.assertIsInstance(e[k], list)

    def test_every_module_that_bumps_a_rate_master_series_holds_the_same_lock_as_test_rate_master(self):
        """test_rate_master holds the BRMI / BRCC / BRMS / BRSE series rows FOR UPDATE for 25 minutes; a module that
        bumps one of them must wait for it, never run beside it."""
        rm = rtp.Job(RM, PLAN["modules"][RM])
        for m, e in PLAN["modules"].items():
            if m != RM and set(e["series"]) & set(PLAN["modules"][RM]["series"]):
                locks = rtp.Locks()
                locks.take(rm)
                with self.subTest(module=m):
                    self.assertFalse(locks.free_for(rtp.Job(m, e)))


class Measuring(unittest.TestCase):
    """--measure's rules: what one module's before / after snapshots make of its plan entry."""

    def entry(self, deltas, series=(), keyed=()):
        before = {"tables": {}, "series": {"BOQ-26-": 5, "BRMI-26-": 9}}
        after = {"tables": {t: list(d) for t, d in deltas.items()}, "series": dict(before["series"])}
        for s in series:
            after["series"][s] = after["series"].get(s, 0) + 1
        return rtp.derive_entry("m", before, after, 12.34, list(keyed))

    def test_a_bumped_series_a_written_table_and_a_read_app_table(self):
        e = self.entry({"tabBOQs": (1, 0, 1, 3), "tabProjects": (0, 0, 0, 2)}, series=["BOQ-26-"])
        self.assertEqual(e, {"seconds": 12.3, "series": ["BOQ-26-"], "writes": ["tabBOQs"], "reads": ["tabProjects"]})

    def test_NEGATIVE_the_scheduler_toggle_append_logs_and_framework_reads_hold_no_lock(self):
        e = self.entry({"tabSingles": (6, 0, 6, 9), "tabSessions": (0, 1, 0, 1), "tabVersion": (4, 0, 4, 2),
                        "tabError Log": (2, 0, 0, 0), "tabDocField": (0, 0, 0, 50), "tabSeries": (0, 3, 0, 3)})
        self.assertEqual((e["series"], e["writes"], e["reads"]), ([], [], []))

    def test_a_singles_write_beyond_the_toggle_is_a_lock(self):
        self.assertEqual(self.entry({"tabSingles": (8, 0, 8, 9)})["writes"], ["tabSingles"])

    def test_a_reviewed_keyed_read_is_dropped_for_its_readers_only(self):
        k = [{"table": "tabBOQs", "readers": ["m"], "why": "x"}]
        self.assertEqual(self.entry({"tabBOQs": (0, 0, 0, 1)}, keyed=k)["reads"], [])
        k = [{"table": "tabBOQs", "readers": ["other"], "why": "x"}]
        self.assertEqual(self.entry({"tabBOQs": (0, 0, 0, 1)}, keyed=k)["reads"], ["tabBOQs"])


class TheScheduler(unittest.TestCase):
    def test_a_shared_series_never_overlaps_and_disjoint_jobs_do(self):
        jobs = [job("a", series=["BRMI-"]), job("b", series=["BRMI-"]), job("c", series=["BOQ-"]), job("d")]
        seen, _, done = run_and_watch(jobs, 4)
        self.assertNotIn(("a", "b"), seen)
        self.assertIn(("a", "c"), seen)
        self.assertEqual(sorted(done), ["a", "b", "c", "d"])

    def test_a_writer_excludes_readers_but_readers_share(self):
        jobs = [job("w", writes=["tabBOQs"]), job("r1", reads=["tabBOQs"]), job("r2", reads=["tabBOQs"])]
        seen, _, _ = run_and_watch(jobs, 4)
        self.assertNotIn(("r1", "w"), seen)
        self.assertNotIn(("r2", "w"), seen)
        self.assertIn(("r1", "r2"), seen)

    def test_a_serial_job_runs_alone(self):
        jobs = [job("s", serial=True, seconds=9), job("x"), job("y")]
        seen, _, _ = run_and_watch(jobs, 4)
        self.assertFalse([p for p in seen if "s" in p])

    def test_never_more_than_procs_at_once(self):
        _, peak, done = run_and_watch([job("j%d" % i) for i in range(9)], 3)
        self.assertEqual(peak, 3)
        self.assertEqual(len(done), 9)

    def test_the_longest_goes_first_and_the_run_alone_modules_last(self):
        jobs = rtp.load_plan(rtp.all_boq_modules())
        alone = [j for j in jobs if j.serial]
        self.assertEqual(jobs[0].name, RM)
        self.assertEqual(jobs[-len(alone):], alone)

    def test_a_run_alone_job_waits_for_the_others_and_nothing_starts_beside_it(self):
        jobs = rtp.load_plan(rtp.all_boq_modules())[:3] + [j for j in rtp.load_plan(rtp.all_boq_modules()) if j.serial][:1]
        order = []
        rtp.schedule(jobs, 6, lambda j: order.append(j.name) or j.name)
        self.assertEqual(order[-1], jobs[-1].name)

    def test_the_ai_settings_writers_run_alone(self):
        """They flip `BOQ Upload Review AI Settings.enabled`, a flag other wizard modules' code reads mid-run."""
        for m in ("api.boq.wizard.test_ai_settings", "api.boq.wizard.test_classify", "api.boq.wizard.test_row_category"):
            self.assertTrue(PLAN["modules"]["nirmaan_stack." + m].get("serial"), m)

    def test_NEGATIVE_an_unclassified_module_is_refused_by_name(self):
        with self.assertRaises(SystemExit) as cm:
            rtp.load_plan(["nirmaan_stack.api.boq.test_not_classified"])
        self.assertIn("test_not_classified", str(cm.exception))

    def test_the_busy_check_sees_a_suite_a_backup_vitest_and_tsc_but_not_the_bench(self):
        for cmd in ("/home/frappe/.local/bin/bench --site localhost run-tests --module x", "pg_dump -Fc db",
                    "node node_modules/vitest/vitest.mjs run src", "node scripts/typecheck.mjs"):
            self.assertTrue(rtp.BUSY.search(cmd), cmd)
        self.assertFalse(rtp.BUSY.search("bench start"))

    def test_NEGATIVE_the_runner_never_starts_the_frontend(self):
        """Owner "option c": beside the Python lanes a vitest DOM worker misses the 60 s start limit and its file is
        dropped (TOOL-1 after2 / after3), so vitest and tsc are never run by the runner -- only refused beside it."""
        src = Path(rtp.__file__).read_text(encoding="utf-8")
        code = src.split('"""', 2)[2]                    # past the module docstring, which explains why
        self.assertNotIn("vitest.mjs run", code)
        self.assertNotIn('"scripts/typecheck.mjs"', code)
        self.assertNotIn("--python-only", code)


if __name__ == "__main__":
    unittest.main()

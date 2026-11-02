#!/usr/bin/env python3
"""Run the BoQ Python test set in parallel -- the same tests, the same commands, fewer minutes (TOOL-1, owner R-PAR).

WHAT RUNS IN PARALLEL, AND WHY ONLY THAT
----------------------------------------
Every Python module still runs exactly as before: one ``bench --site localhost run-tests --module <M>`` process per
module, its own interpreter, the same assertions. What changes is only WHEN: two modules run at the same time only if
they share no database state. Each module's state is in ``scripts/parallel_test_plan.json``, measured, not guessed
(TOOL-1 P2): before and after each module of a serial run, pg_stat_user_tables and every naming-series counter were
read, giving the series it bumps, the tables it writes and the tables it reads. A module holds an EXCLUSIVE lock on
each series it bumps and each table it writes, and a SHARED lock on each table it reads, for as long as it runs; it
starts only when all of them are free. Series: Frappe takes ``SELECT ... FOR UPDATE`` on the series row, and under
PostgreSQL REPEATABLE READ the second of two overlapping transactions on it fails with SerializationFailure. Tables:
a fixture, a purge or a sweep over every row must never see another module's rows half-written. Conflicts are pairwise,
not transitive: test_rate_suggest shares a series with test_rate_master and another with the wizard modules, yet the
wizard modules still run beside test_rate_master. A module the plan marks ``serial`` runs alone.

THE FRONTEND IS NOT RUN BY THIS RUNNER (owner ruling "option c", TOOL-1). vitest and tsc run as before, on their own,
before or after the Python lanes and never beside them. Measured: with the Python lanes running, a jsdom worker of
vitest's DOM project misses vitest's hard-coded 60 s worker-start limit ("Failed to start forks worker") and that test
file is dropped -- an unhandled error, not a failed test -- with the DOM project single-fork as configured, and the
rmAccess1 sweep times out at 60 s. A dropped file is a test that never ran, so the frontend stays out of the lanes, and
the runner refuses to start while a vitest or tsc run is going.

WHAT THE RUNNER DOES TO THE DATABASE
------------------------------------
Exactly what the tests do, minus 87 redundant scheduler toggles: ``bench run-tests`` turns
``System Settings.enable_scheduler`` off and back on around every module (frappe/test_runner.py). Run concurrently,
those toggles would race (one module re-enabling the scheduler while another still runs), so the runner turns it off
ONCE before the first module and back on ONCE after the last -- every child then finds it off and leaves it alone,
exactly as each serial module finds it off while it runs. If it was already off, the runner leaves it off.

It refuses to start while another suite, a ``pg_dump`` / env_sync backup, or a vitest or tsc run is going (shared-state
overlap, owner rule: never a suite during a load or a cert).

Usage, in the container (from the bench directory):
    env/bin/python -I apps/nirmaan_stack/scripts/run_tests_parallel.py --out /tmp/run1             # the full BoQ Python set
    env/bin/python -I apps/nirmaan_stack/scripts/run_tests_parallel.py --out /tmp/t --modules m.txt   # a targeted set
    ... --measure --modules new.txt   # a NEW test module: run it alone, measure its locks, write its plan entry
The summary (``<out>/summary.log``) keeps the serial runner's line format: ``<module> <rc> Ran N tests in Xs OK``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
BENCH = APP.parent.parent
PLAN = Path(__file__).resolve().parent / "parallel_test_plan.json"
BUSY = re.compile(r"run-tests|pg_dump|envsync.*backup|vitest\.mjs|node_modules/\.bin/vitest|typecheck\.mjs")


def busy_processes() -> list[str]:
    """Other suites, backups, vitest or tsc runs in this container (never this process or its children)."""
    out = []
    me = os.getpid()
    if not os.path.isdir("/proc"):
        raise SystemExit("run this in the container (the busy check reads /proc)")
    for pid in os.listdir("/proc"):
        if not pid.isdigit() or int(pid) == me:
            continue
        try:
            cmd = Path("/proc/%s/cmdline" % pid).read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        except OSError:
            continue
        if BUSY.search(cmd) and "run_tests_parallel" not in cmd:
            out.append("%s %s" % (pid, cmd.strip()[:160]))
    return out


class Job:
    def __init__(self, name: str, entry: dict):
        self.name, self.seconds = name, float(entry.get("seconds", 30))
        self.serial = bool(entry.get("serial"))
        self.excl = {"series:" + s for s in entry.get("series", [])} | {"table:" + t for t in entry.get("writes", [])}
        self.shared = {"table:" + t for t in entry.get("reads", [])} - self.excl


def load_plan(modules: list[str]) -> list[Job]:
    """The modules asked for, with their locks, longest first. A module the plan has never classified is refused by
    name -- a new test module is measured and classified before it runs in parallel."""
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    want = list(dict.fromkeys(modules))
    unknown = [m for m in want if m not in plan["modules"]]
    if unknown:
        raise SystemExit("not in %s (classify them first, or run them serially): %s" % (PLAN.name, ", ".join(unknown)))
    # longest first, so the long module starts at once and the short ones fill the other slots around it; the run-alone
    # modules last, when the lanes have drained (first, they would hold test_rate_master back for their whole run)
    return sorted((Job(m, plan["modules"][m]) for m in want), key=lambda j: (j.serial, -j.seconds))


# --- measuring a module (--measure): how the plan's entries were made -----------------------------------------------

# frappe's own tables: reading them never conflicts (tests do not write meta); writing them beyond the per-run noise does
FRAMEWORK_PREFIX = ("tabDoc", "tabCustom", "tabProperty Setter", "tabSingles", "tabSeries", "tabSessions",
                    "tabScheduled Job", "tabUser", "tabHas Role", "tabRole", "tabVersion", "tabComment",
                    "tabDeleted Document", "tabError Log", "tabActivity Log", "tabDefaultValue", "__",
                    "tabModule Def", "tabInstalled", "tabPage", "tabReport", "tabWorkspace", "tabNavbar",
                    "tabPortal", "tabWebsite", "tabSystem", "tabPatch Log", "tabRQ", "tabAccess Log",
                    "tabRoute History", "tabNotification", "tabEmail", "tabCommunication", "tabLanguage",
                    "tabTranslation", "tabFile", "tabPrint", "tabList View", "tabUser Permission",
                    "tabDashboard", "tabNumber Card", "tabKanban", "tabTag", "tabToDo", "tabEvent", "tabContact",
                    "tabAddress", "tabDynamic Link", "tabSMS", "tabLog Setting", "tabPrepared Report", "tabView Log",
                    "tabEnergy Point", "tabSuccess Action", "tabWebhook", "tabOAuth", "tabToken Cache", "tabConsole Log")
# what `bench run-tests` itself does around ANY module (the scheduler toggle, the login touch): (ins, upd, del) at most
NOISE = {"tabSingles": (6, 0, 6), "tabSessions": (0, 99, 0), "tabUser": (0, 99, 0), "tabScheduled Job Log": (99, 99, 0),
         "tabScheduled Job Type": (0, 99, 0)}
# hash-named, append-only logs: no naming series, unique names, nothing sweeps them -- two writers never collide
APPEND_LOGS = {"tabVersion", "tabComment", "tabDeleted Document", "tabError Log", "tabActivity Log",
               "tabScheduled Job Log", "tabAccess Log", "tabRoute History", "tabView Log"}


def _framework(table: str) -> bool:
    return table.startswith(FRAMEWORK_PREFIX)


def snapshot() -> dict:
    """pg_stat_user_tables (cumulative ins / upd / del / scans per table) and every naming-series counter. Selects
    only, on a read-only autocommit connection of its own."""
    import psycopg2
    sites = BENCH / "sites"
    conf = json.loads((sites / "localhost" / "site_config.json").read_text())
    common = json.loads((sites / "common_site_config.json").read_text())
    conn = psycopg2.connect(host=common.get("db_host", "postgresql"), port=common.get("db_port", 5432),
                            dbname=conf["db_name"], user=conf["db_name"], password=conf["db_password"])
    conn.set_session(readonly=True, autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute("select relname, n_tup_ins, n_tup_upd, n_tup_del, coalesce(seq_scan, 0) + coalesce(idx_scan, 0) "
                    "from pg_stat_user_tables")
        tables = {r[0]: list(r[1:]) for r in cur.fetchall()}
        cur.execute('select name, current from "tabSeries"')
        return {"tables": tables, "series": {r[0]: r[1] for r in cur.fetchall()}}
    finally:
        conn.close()


def derive_entry(module: str, before: dict, after: dict, seconds: float, keyed_reads: list) -> dict:
    """A plan entry from one module's before / after snapshots: the series it bumped, the tables it wrote beyond the
    noise (append logs left out), the app tables it read (less the reviewed keyed reads)."""
    writes, reads = {}, set()
    for t, a in after["tables"].items():
        b = before["tables"].get(t, [0, 0, 0, 0])
        d = [a[i] - b[i] for i in range(3)]
        if any(d) and t != "tabSeries" and not (t in NOISE and all(d[i] <= NOISE[t][i] for i in range(3))):
            writes[t] = d
        if a[3] - b[3]:
            reads.add(t)

    def keyed(t):
        return any(k["table"] == t and (k["readers"] == "*" or module in k["readers"]) and module not in k.get("except", [])
                   for k in keyed_reads)

    w = sorted(t for t in writes if t not in APPEND_LOGS)
    return {"seconds": round(seconds, 1),
            "series": sorted(k for k, v in after["series"].items() if v != before["series"].get(k, 0)),
            "writes": w,
            "reads": sorted(t for t in reads if not _framework(t) and t not in w and not keyed(t))}


def measure(modules: list[str], out: Path) -> int:
    """Run each module ALONE, one after another (the serial way), with a snapshot either side, and write its entry into
    the plan -- keeping a module's `serial` flag and the reviewed keyed reads. The way a new test module joins."""
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    (out / "raw").mkdir(parents=True, exist_ok=True)
    (out / "junit").mkdir(parents=True, exist_ok=True)
    failed = 0
    for m in modules:
        before = snapshot()
        t0 = time.time()
        line = run_module(m, out)
        secs = time.time() - t0
        time.sleep(1)                                   # pg_stat is flushed when the backend ends
        entry = derive_entry(m, before, snapshot(), secs, plan.get("keyed_reads", []))
        for k in ("serial", "why_serial"):
            if k in plan["modules"].get(m, {}):
                entry[k] = plan["modules"][m][k]
        plan["modules"][m] = entry
        print(line.splitlines()[0], "->", json.dumps(entry))
        failed += " OK wall=" not in line.splitlines()[0]
    plan["modules"] = dict(sorted(plan["modules"].items()))
    PLAN.write_text(json.dumps(plan, indent=1) + "\n", encoding="utf-8", newline="\n")
    return 1 if failed else 0


def all_boq_modules() -> list[str]:
    return list(json.loads(PLAN.read_text(encoding="utf-8"))["modules"])


class Locks:
    """Exclusive / shared locks over series and tables; a job takes all of its locks at once or none (no deadlock)."""

    def __init__(self):
        self.excl: set[str] = set()
        self.shared: dict[str, int] = {}
        self.running_serial = False
        self.running = 0

    def free_for(self, j: Job) -> bool:
        if self.running_serial or (j.serial and self.running):
            return False
        return not (j.excl & (self.excl | set(self.shared))) and not (j.shared & self.excl)

    def take(self, j: Job):
        self.excl |= j.excl
        for r in j.shared:
            self.shared[r] = self.shared.get(r, 0) + 1
        self.running += 1
        self.running_serial = self.running_serial or j.serial

    def give(self, j: Job):
        self.excl -= j.excl
        for r in j.shared:
            self.shared[r] -= 1
            if not self.shared[r]:
                del self.shared[r]
        self.running -= 1
        if j.serial:
            self.running_serial = False


# --- the scheduler, once ------------------------------------------------------------------------------------------

def _frappe_site():
    os.chdir(BENCH / "sites")
    import frappe
    frappe.init(site="localhost")
    frappe.connect()
    return frappe


def scheduler_off() -> bool:
    """Turn the scheduler off as `bench run-tests` would; True when this runner did it (and must turn it back on)."""
    frappe = _frappe_site()
    try:
        import frappe.utils.scheduler as sched
        if sched.is_scheduler_disabled(verbose=False):
            return False
        sched.disable_scheduler()
        frappe.db.commit()
        return True
    finally:
        frappe.destroy()
        os.chdir(BENCH)


def scheduler_on() -> None:
    frappe = _frappe_site()
    try:
        import frappe.utils.scheduler as sched
        sched.enable_scheduler()
        frappe.db.commit()
    finally:
        frappe.destroy()
        os.chdir(BENCH)


# --- the lanes -----------------------------------------------------------------------------------------------------

def run_module(m: str, out: Path) -> str:
    raw = out / "raw" / (m + ".log")
    t0 = time.time()
    with raw.open("w", encoding="utf-8") as fh:
        rc = subprocess.run(["bench", "--site", "localhost", "run-tests", "--module", m,
                             "--junit-xml-output", str(out / "junit" / (m + ".xml"))],
                            cwd=BENCH, stdout=fh, stderr=subprocess.STDOUT).returncode
    wall = time.time() - t0
    text = raw.read_text(encoding="utf-8", errors="replace")
    ran = ([ln for ln in text.splitlines() if re.match(r"^Ran \d+ tests? in", ln)] or [""])[-1]
    res = ([ln for ln in text.splitlines() if re.match(r"^(OK|FAILED)", ln)] or [""])[-1]
    line = "%s %s %s %s wall=%.3f" % (m, rc, ran, res, wall)
    if rc != 0 or not res.startswith("OK"):
        detail = [ln for ln in text.splitlines() if "firebase" not in ln.lower()]
        keep, n = [], 0
        for ln in detail:
            if re.match(r"^(ERROR|FAIL):", ln):
                n = 40
            if n:
                keep.append(ln)
                n -= 1
        line += "\n----- FAILURE DETAIL %s\n%s" % (m, "\n".join(keep))
    return line


def schedule(jobs: list[Job], procs: int, run, log=lambda m: None) -> list:
    """Start, in order, every job whose locks are free while fewer than `procs` run; when one finishes, look again.
    `run(job)` is called on a worker thread and its results are returned in finishing order."""
    pending, results = list(jobs), []
    locks, cv = Locks(), threading.Condition()

    def go(j: Job):
        try:
            results.append(run(j))
        finally:
            with cv:
                locks.give(j)
                cv.notify_all()

    threads = []
    with cv:
        while pending or locks.running:
            started = False
            for j in list(pending):
                if locks.running < procs and locks.free_for(j):
                    locks.take(j)
                    pending.remove(j)
                    log("start %s (running %d)" % (j.name, locks.running))
                    t = threading.Thread(target=go, args=(j,))
                    threads.append(t)
                    t.start()
                    started = True
            if not started:
                cv.wait()
    for t in threads:
        t.join()
    return results


def run_python(jobs: list[Job], out: Path, procs: int, log) -> list[str]:
    (out / "raw").mkdir(parents=True, exist_ok=True)
    (out / "junit").mkdir(parents=True, exist_ok=True)

    def run(j: Job) -> str:
        line = run_module(j.name, out)
        log("done  %s" % line.splitlines()[0])
        return line

    return schedule(jobs, procs, run, log)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run the BoQ Python test set in parallel (scripts/parallel_test_plan.json); "
                                             "vitest and tsc are not run here -- run them on their own, before or after.")
    ap.add_argument("--out", required=True, help="output folder (raw logs, junit XML, summary.log)")
    ap.add_argument("--modules", help="a file of dotted test modules (default: every module in the plan)")
    ap.add_argument("--procs", type=int, help="parallel Python processes (default: the plan's)")
    ap.add_argument("--measure", action="store_true",
                    help="run the --modules ALONE, one after another, and write their measured entries into the plan")
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    busy = busy_processes()
    if busy:
        print("REFUSED: another suite, backup, vitest or tsc run is going:\n  " + "\n  ".join(busy))
        return 2
    if a.measure:
        if not a.modules:
            raise SystemExit("--measure needs --modules <file>")
        return measure([ln.strip() for ln in Path(a.modules).read_text().splitlines() if ln.strip()], out)
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    procs = a.procs or plan["procs"]
    mods = ([ln.strip() for ln in Path(a.modules).read_text().splitlines() if ln.strip()]
            if a.modules else all_boq_modules())
    jobs = load_plan(mods)
    summary = out / "summary.log"
    t_start = time.time()
    lock = threading.Lock()

    def log(msg):
        with lock, summary.open("a", encoding="utf-8") as fh:
            fh.write("[%7.1fs] %s\n" % (time.time() - t_start, msg))

    head = subprocess.run(["git", "-C", str(APP), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    log("START HEAD %s; %d modules, up to %d processes at once (Python only: vitest / tsc run on their own)"
        % (head, len(jobs), procs))
    lines = []
    if jobs:
        mine = scheduler_off()
        log("scheduler %s" % ("turned off once" if mine else "was already off: left as it is"))
        try:
            lines = run_python(jobs, out, procs, log)
        finally:
            if mine:
                scheduler_on()
                log("scheduler turned back on")
    order = {m: i for i, m in enumerate(mods)}
    lines.sort(key=lambda ln: order.get(ln.split(" ", 1)[0], 1 << 30))
    with summary.open("a", encoding="utf-8") as fh:
        fh.write("===== modules (in the order asked)\n" + "\n".join(lines) + "\n")
        fh.write("TOTAL_WALL %.3f s\nPARALLEL_DONE\n" % (time.time() - t_start))
    failed = [ln for ln in lines if " OK wall=" not in ln.splitlines()[0]]
    print(summary.read_text(encoding="utf-8"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

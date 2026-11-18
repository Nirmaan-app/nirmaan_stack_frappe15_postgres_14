#!/usr/bin/env python3
"""The N-worker check (spec #1654, #1656): overlapping background operations all succeed with N `long` workers.

    python3 .claude/skills/verify/bin/walk_background_operations.py --task <task> [--workers N] [--runs R]
        [--flows clone,classify,suggest]

Starts N `long` workers on the env the way the walks start one (`devenv.sh run <task> worker --queue long`), runs
`background_operations_flows.py` in the env (N template clones at once, ceil(N/2) two-engine Classify clicks at
once, and N rate suggests on N sheets at once, each flow its own number of runs unless `--runs` sets one for all),
and stops the workers again, also on failure or Ctrl-C. While the flows run it samples,
once a second, each worker's memory (its process plus the work horse it forks per operation) and the Postgres
connections open on the env's DB. It prints the peak of each, and exits 1 when any operation failed, 2 when the
check could not run (workers already running, too little memory, a worker that did not start).
"""

import argparse
import json
import math
import re
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

DEVENV = "scripts/devenv/devenv.sh"
FLOWS = ".claude/skills/verify/bin/background_operations_flows.py"
CONTAINER = "frappe_docker_devcontainer-frappe-1"
MAX_CONTAINER_GIB = 3.5


def container(cmd: str) -> str:
    return subprocess.run(["docker", "exec", CONTAINER, "bash", "-c", cmd], capture_output=True, text=True).stdout


def container_gib() -> float:
    out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", CONTAINER],
                         capture_output=True, text=True).stdout
    amount, unit = re.match(r"([\d.]+)\s*(\w+)", out).groups()
    return float(amount) / {"KiB": 1024 ** 2, "MiB": 1024, "GiB": 1}[unit]


def processes() -> dict[int, tuple[int, int, str]]:
    """pid -> (ppid, rss KiB, args) of every process in the container."""
    out = {}
    for line in container("ps -eo pid=,ppid=,rss=,args=").splitlines():
        pid, ppid, rss, args = line.split(None, 3)
        out[int(pid)] = (int(ppid), int(rss), args)
    return out


def worker_pids(procs, site: str) -> list[int]:
    """The env's long workers: the worker processes, not the work horses they fork (same command line)."""
    mine = {pid for pid, (_, _, args) in procs.items()
            if f"--site {site} worker --queue long" in args and "bench_helper" in args}
    return sorted(pid for pid in mine if procs[pid][0] not in mine)


def tree_rss(procs, root: int) -> int:
    total, todo = 0, [root]
    while todo:
        pid = todo.pop()
        total += procs[pid][1]
        todo += [c for c, (ppid, _, _) in procs.items() if ppid == pid]
    return total


class Sampler(threading.Thread):
    """Once a second: each worker's memory (process + work horse) and the env DB's open Postgres connections."""

    def __init__(self, site: str, db: str, workers: list[int]):
        super().__init__(daemon=True)
        self.site, self.db, self.workers = site, db, workers
        self.peak_kib = {pid: 0 for pid in workers}
        self.peak_conns = 0
        self.done = threading.Event()

    def run(self):
        sql = f"select count(*) from pg_stat_activity where datname = '{self.db}'"
        while not self.done.is_set():
            out = container(f"PGPASSWORD=123 psql -h postgresql -U postgres -Atc \"{sql}\"; echo ---; "
                            "ps -eo pid=,ppid=,rss=,args=")
            conns, _, ps = out.partition("---\n")
            if conns.strip().isdigit():
                self.peak_conns = max(self.peak_conns, int(conns))
            procs = {}
            for line in ps.splitlines():
                pid, ppid, rss, args = line.split(None, 3)
                procs[int(pid)] = (int(ppid), int(rss), args)
            for pid in self.workers:
                if pid in procs:
                    self.peak_kib[pid] = max(self.peak_kib[pid], tree_rss(procs, pid))
            self.done.wait(1)


def stop_flows(site: str) -> None:
    """The flows script runs on in the container when the host side is stopped: stop it too (it then puts the AI
    setting back)."""
    name = Path(FLOWS).name
    pids = [pid for pid, (_, _, args) in processes().items() if f"{site} " in args and f"tmp/{name}" in args]
    if pids:
        container(f"kill -TERM {' '.join(map(str, pids))}")
        time.sleep(3)


def start_workers(task: str, site: str, n: int, logs: Path) -> tuple[list[subprocess.Popen], list[int]]:
    started = []
    for i in range(n):
        log = open(logs / f"worker-long-{i + 1}.log", "w")
        started.append(subprocess.Popen([DEVENV, "run", task, "worker", "--queue", "long"], stdout=log,
                                        stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL))
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        pids = worker_pids(processes(), site)
        if len(pids) == n:
            return started, pids
        if any(p.poll() is not None for p in started):
            break
        time.sleep(2)
    return started, worker_pids(processes(), site)


def stop_workers(started: list[subprocess.Popen], site: str) -> None:
    pids = worker_pids(processes(), site)
    if pids:
        container(f"kill -TERM {' '.join(map(str, pids))}")
    for p in started:
        try:
            p.wait(timeout=60)
        except subprocess.TimeoutExpired:
            pass
    left = worker_pids(processes(), site)
    if left:
        container(f"kill -KILL {' '.join(map(str, left))}")
        time.sleep(2)
        left = worker_pids(processes(), site)
    for p in started:
        if p.poll() is None:
            p.kill()
    print(f"workers stopped ({'none left' if not left else f'STILL RUNNING: {left}'})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--runs", type=int, default=None, help="runs of every flow (default: each flow's own count)")
    ap.add_argument("--flows", default="clone,classify,suggest")
    a = ap.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))  # so the clean-up below runs
    site, db = f"t-{a.task}.localhost", f"t_{a.task.replace('-', '_')}"
    logs = Path.home() / "claude-artifacts/verify" / a.task / f"n-worker-check-{time.strftime('%Y%m%d-%H%M%S')}"
    logs.mkdir(parents=True, exist_ok=True)

    if worker_pids(processes(), site):
        print(f"cannot run: workers already run on {site}; stop them first")
        return 2
    gib = container_gib()
    if gib > MAX_CONTAINER_GIB:
        print(f"cannot run: the frappe container uses {gib:.2f} GiB (over {MAX_CONTAINER_GIB}); wait and retry")
        return 2
    print(f"N-worker check on {site}: {a.workers} long workers, flows {a.flows} "
          f"(container at {gib:.2f} GiB; worker logs in {logs.resolve()})")

    started, pids = start_workers(a.task, site, a.workers, logs)
    sampler = flows = None
    try:
        if len(pids) != a.workers:
            print(f"cannot run: {len(pids)} of {a.workers} workers started (logs in {logs.resolve()})")
            return 2
        sampler = Sampler(site, db, pids)
        sampler.start()
        flows = subprocess.Popen([DEVENV, "script", a.task, FLOWS, "--workers", str(a.workers), "--flows", a.flows]
                                 + (["--runs", str(a.runs)] if a.runs else []),
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        result = None
        for line in flows.stdout:
            if line.startswith("JSON: "):
                result = json.loads(line[6:])
            elif not line.startswith(("firebase admin", "  code", "  db ", "  bench", "  script:")):
                print(line, end="", flush=True)
        flows.wait()
    finally:
        if flows and flows.poll() is None:
            flows.kill()
            stop_flows(site)
        if sampler:
            sampler.done.set()
            sampler.join()
        stop_workers(started, site)

    print(f"\npeak memory per worker (process + work horse): "
          + ", ".join(f"pid {pid} {kib / 1024:.0f} MiB" for pid, kib in sampler.peak_kib.items()))
    print(f"most Postgres connections the env DB held: {sampler.peak_conns}")
    if result is None:
        print(f"FAIL: the flows did not finish (exit {flows.returncode})")
        return 1
    lock = result["boq_lock"]
    print(f"longest wait on the BoQ series lock: {lock['longest_wait_s']:.3f} s ({lock['waits']} waits)")
    failed = 0
    for flow, r in result["flows"].items():
        at_once = f"{math.ceil(a.workers / 2)} clicks x 2 engines" if flow == "classify" else a.workers
        print(f"{flow}: {r['ok']} ok, {r['failed']} failed ({r['runs']} runs, {at_once} at once)")
        failed += r["failed"]
    print("PASS: every operation succeeded" if not failed else f"FAIL: {failed} operations failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""The N-worker check (spec #1654, testing decision 4): N `long` workers, the measured flows at N-way overlap.

    python3 .claude/skills/verify/bin/bgops_nworker_check.py --task <task> [--workers N] [--owner <user>]
                                                             [--heavy-rows R]

Run it from the host, in the checkout whose env it checks. It starts N `long` workers from the env's own bench
(the env's `bench_id` names its queues, so the main bench's workers never take these operations), runs each flow
below inside the env through `devenv.sh script`, stops every worker it started, and exits 1 when any flow had a
failed or mixed-up operation. While the flows run it samples, once a second, each worker's memory (the worker and
the work horse it forks, together) and the env DB's connections, and prints the peaks.

Flows:
- TDS export (#1662): N exports by one user at once, heavy and light mixed (`bgops_nworker_tds.py`). Each must
  reach its own tab.

Template clones, two-engine Classify clicks and rate suggests join here as their tickets land.
Before starting workers, check `docker stats --no-stream`: on an 8 GB box, wait while the frappe container uses more
than 3.5 GiB.
"""

import argparse
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
DEVENV = os.path.join(APP, "scripts", "devenv", "devenv.sh")
FRAPPE = "frappe_docker_devcontainer-frappe-1"
POSTGRES = "frappe_docker_devcontainer-postgresql-1"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--workers", type=int, default=2)
ap.add_argument("--owner", default="Administrator", help="the user who starts every export")
ap.add_argument("--heavy-rows", type=int, default=200)
a = ap.parse_args()

bench = f"/workspace/development/benches/{a.task}"
db = "t_" + a.task.replace("-", "_")


def in_container(cmd):
    return subprocess.run(["docker", "exec", FRAPPE, "bash", "-c", cmd], capture_output=True, text=True)


def start_workers(count):
    """Each worker runs the env's own code (PYTHONPATH: the editable install points at the master checkout) and
    leads its own session; the shell that starts it prints its own pid (the session id) and then
    becomes the worker, so `kill -- -<pgid>` reaches the worker and every work horse it forks."""
    pgids = []
    for i in range(count):
        out = in_container(
            f"cd {bench}/sites && FRAPPE_BENCH_ROOT={bench} PYTHONPATH={bench}/apps/nirmaan_stack setsid sh -c 'echo $$; exec {bench}/env/bin/python -m "
            f"frappe.utils.bench_helper frappe worker --queue long >{bench}/logs/nworker-{i}.log 2>&1 </dev/null' &"
            " sleep 0.5"
        )
        pgids.append(out.stdout.strip())
    return pgids


def stop_workers(pgids):
    for pgid in pgids:
        in_container(f"kill -TERM -- -{pgid} 2>/dev/null || true")
    time.sleep(2)
    for pgid in pgids:
        in_container(f"kill -KILL -- -{pgid} 2>/dev/null || true")
    left = in_container(f"ps -eo pgid= | grep -wE '{'|'.join(pgids)}' || true").stdout.split()
    if left:
        print(f"WARNING: {len(left)} worker processes still run; stop them: kill -- -<pgid> in the container")


peaks = {"rss_mb": {}, "db_connections": 0}
sampling = threading.Event()


def sample(pgids):
    while not sampling.is_set():
        # A worker is its session's leader (pid == pgid); RQ's work horse is its child in a session of its own.
        ps = in_container("ps -eo ppid=,pgid=,rss=").stdout.split()
        rss = {}
        for ppid, pgid, kb in zip(ps[::3], ps[1::3], ps[2::3]):
            worker = pgid if pgid in pgids else ppid if ppid in pgids else None
            if worker:
                rss[worker] = rss.get(worker, 0) + int(kb)
        for pgid, kb in rss.items():
            peaks["rss_mb"][pgid] = max(peaks["rss_mb"].get(pgid, 0), round(kb / 1024))
        conns = subprocess.run(
            ["docker", "exec", POSTGRES, "psql", "-U", "postgres", "-tAc",
             f"select count(*) from pg_stat_activity where datname = '{db}'"],
            capture_output=True, text=True,
        ).stdout.strip()
        if conns.isdigit():
            peaks["db_connections"] = max(peaks["db_connections"], int(conns))
        time.sleep(1)


pgids = start_workers(a.workers)
print(f"started {a.workers} long workers for {a.task} (process groups {', '.join(pgids)})", flush=True)
sampler = threading.Thread(target=sample, args=(pgids,), daemon=True)
sampler.start()
results = {}
try:
    time.sleep(3)  # let each worker register before the first operation is queued
    flow = subprocess.run(
        [DEVENV, "script", a.task, os.path.join(HERE, "bgops_nworker_tds.py"), str(a.workers), a.owner,
         str(a.heavy_rows)],
        cwd=APP,
    )
    results["TDS export"] = flow.returncode
finally:
    sampling.set()
    sampler.join(timeout=10)
    stop_workers(pgids)
    print(f"stopped the {a.workers} workers", flush=True)

for pgid in pgids:
    print(f"peak memory, worker {pgid}: {peaks['rss_mb'].get(pgid, 0)} MB")
print(f"peak DB connections on {db}: {peaks['db_connections']}")
for name, code in results.items():
    print(f"{name}: {'pass' if code == 0 else 'FAIL'}")
sys.exit(0 if results and all(code == 0 for code in results.values()) else 1)

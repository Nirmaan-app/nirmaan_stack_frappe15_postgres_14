"""Start and stop `long` RQ workers for a devenv env, from the host (spec #1654).

    from bgops_workers import long_workers
    with long_workers("<task>", 1):
        ...  # the env's background operations run

`devenv.sh serve` starts no worker, so a walk of a screen that waits on a background operation starts its own. Each
worker runs the env's own code from the env's bench (its `bench_id` names its queues, so the main bench's workers
never take these operations) and leads its own process group, so stopping it reaches the work horse it forks too.
Before starting workers, check `docker stats --no-stream`: wait while the frappe container uses more than 3.5 GiB.
"""

import contextlib
import subprocess
import time

FRAPPE = "frappe_docker_devcontainer-frappe-1"


def in_container(cmd):
    return subprocess.run(["docker", "exec", FRAPPE, "bash", "-c", cmd], capture_output=True, text=True)


def start_workers(task, count, queue="long"):
    """Start `count` workers; returns their process group ids."""
    bench = f"/workspace/development/benches/{task}"
    pgids = []
    for i in range(count):
        out = in_container(
            f"cd {bench}/sites && FRAPPE_BENCH_ROOT={bench} PYTHONPATH={bench}/apps/nirmaan_stack setsid sh -c 'echo $$; "
            f"exec {bench}/env/bin/python -m frappe.utils.bench_helper frappe worker --queue {queue} "
            f">{bench}/logs/nworker-{i}.log 2>&1 </dev/null' & sleep 0.5"
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


@contextlib.contextmanager
def long_workers(task, count=1):
    pgids = start_workers(task, count)
    print(f"started {count} long worker(s) for {task} (process groups {', '.join(pgids)})", flush=True)
    try:
        time.sleep(3)  # let each worker register before the first operation is queued
        yield pgids
    finally:
        stop_workers(pgids)
        print(f"stopped the {count} worker(s)", flush=True)

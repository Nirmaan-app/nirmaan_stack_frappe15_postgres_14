"""Measure ESLint against oxlint on this tree (ticket #1699). Run inside the container, from frontend/:

    python3 -I scripts/oxlint/measure.py --out <dir> [--runs 3] [--only <name> ...]

For each tool setup: one warm-up run, then --runs timed runs. Wall time, and peak memory as the peak sum of the
resident memory (RSS) of the whole process tree, sampled from /proc every 20 ms (oxlint runs as two processes, oxlint
and tsgolint, so one process's maximum would undercount it). The container has no /usr/bin/time. Then one count run per setup with suppressions off, whose
findings are counted per rule into <dir>/counts.json. Raw timings go to <dir>/timings.json.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from collections import Counter

ESLINT = ["node", "--max-old-space-size=4096", "node_modules/eslint/bin/eslint.js"]
OXLINT = ["node", "scripts/oxlint/lint.mjs", "--type-aware"]
# ESLint refuses a suppressions file that does not exist, so the count runs point it at an empty one.
EMPTY_SUPPRESSIONS = "/tmp/oxlint-trial-empty-suppressions.json"
NO_SUPPRESSIONS = ["--suppressions-location", EMPTY_SUPPRESSIONS]

# name: (timed command, count command, output format of the count command)
SETUPS = {
    "eslint": (ESLINT + ["src"], ESLINT + NO_SUPPRESSIONS + ["-f", "json", "src"], "eslint"),
    "oxlint": (OXLINT + ["src"], OXLINT + ["-f", "json", "src"], "oxlint"),
    "oxlint-whole-unsafe": (
        OXLINT + ["-c", "scripts/oxlint/oxlintrc.whole.json", "src"],
        OXLINT + ["-c", "scripts/oxlint/oxlintrc.whole.json", "-f", "json", "src"],
        "oxlint",
    ),
    "eslint-whole-unsafe": (
        ESLINT + ["-c", "scripts/oxlint/eslint.whole.config.js", "src"],
        ESLINT + ["-c", "scripts/oxlint/eslint.whole.config.js"] + NO_SUPPRESSIONS + ["-f", "json", "src"],
        "eslint",
    ),
}


def tree_rss_kb(root):
    """The summed RSS (KB) of root and every descendant, read from /proc."""
    children = {}
    rss = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/stat") as f:
                ppid = int(f.read().rsplit(")", 1)[1].split()[1])
            with open(f"/proc/{pid}/status") as f:
                rss[int(pid)] = next((int(l.split()[1]) for l in f if l.startswith("VmRSS:")), 0)
        except (OSError, ValueError, IndexError):
            continue
        children.setdefault(ppid, []).append(int(pid))
    total, stack = 0, [root]
    while stack:
        pid = stack.pop()
        total += rss.get(pid, 0)
        stack.extend(children.get(pid, []))
    return total


def timed(cmd, stdout):
    start = time.monotonic()
    proc = subprocess.Popen(cmd, stdout=stdout, stderr=subprocess.PIPE, text=True)
    peak = 0
    while proc.poll() is None:
        peak = max(peak, tree_rss_kb(proc.pid))
        time.sleep(0.02)
    wall = time.monotonic() - start
    stderr = proc.stderr.read()
    return {
        "exit": proc.returncode,
        "wall_s": round(wall, 2),
        "peak_tree_rss_mb": round(peak / 1024),
        "stderr_tail": stderr[-600:],
    }


def count(cmd, fmt, out_path):
    with open(out_path, "w") as f:
        result = timed(cmd, f)
    with open(out_path) as f:
        report = json.load(f)
    rules = Counter()
    if fmt == "eslint":
        for file in report:
            for m in file["messages"]:
                rules[m.get("ruleId") or "(no rule)"] += 1
    else:
        for d in report["diagnostics"]:
            rules[d["code"]] += 1
    return result, dict(sorted(rules.items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--only", nargs="*", default=list(SETUPS))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    with open(EMPTY_SUPPRESSIONS, "w") as f:
        f.write("{}")
    # Results of earlier invocations into the same --out are kept, so one setup can be rerun alone.
    timings, counts = {}, {}
    for name, store in (("timings.json", timings), ("counts.json", counts)):
        path = os.path.join(args.out, name)
        if os.path.exists(path):
            with open(path) as f:
                store.update(json.load(f))
    for name in args.only:
        run_cmd, count_cmd, fmt = SETUPS[name]
        runs = []
        for i in range(args.runs + 1):
            r = timed(run_cmd, subprocess.DEVNULL)
            r["warmup"] = i == 0
            runs.append(r)
            print(name, "warm-up" if i == 0 else f"run {i}", {k: v for k, v in r.items() if k != "stderr_tail"},
                  flush=True)
        timings[name] = runs
        result, rules = count(count_cmd, fmt, os.path.join(args.out, f"{name}.json"))
        counts[name] = {"run": result, "rules": rules}
        print(name, "count run", result["exit"], result["wall_s"], json.dumps(rules), flush=True)
        with open(os.path.join(args.out, "timings.json"), "w") as f:
            json.dump(timings, f, indent=1)
        with open(os.path.join(args.out, "counts.json"), "w") as f:
            json.dump(counts, f, indent=1)


if __name__ == "__main__":
    sys.exit(main())

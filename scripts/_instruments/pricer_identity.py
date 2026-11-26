"""PRICER IDENTITY AND SPEED (#1741): proves a change to the server pricing step's bundle leaves its output byte-identical,
and times it, on the requests a pool build sends.

  dump     (site connected: `scripts/devenv/devenv.sh script scripts/_instruments/pricer_identity.py dump <dir>`)
           writes the requests pool.build_pool sends, built the same way (pricing_step.load_asset, then
           pricing_step.sheet_inputs over every active run): <dir>/driving_all.json (mode "driving", every row),
           <dir>/driving_sample.json (the same, `sample` 60 rows per category) and <dir>/pricing.json (the pricing step,
           priceRowsForMatching). Client BoQ text: keep <dir> outside the repo.
  compare  (no site; wherever `node` runs) `python3 -I pricer_identity.py compare <bundle dir A> <bundle dir B>
           <request.json> [--runs N] [--out <dir>]` runs each bundle's pricing_step.mjs on the request N times,
           alternating A and B, prints each run's wall time and the system load before it, and says whether every
           output is byte-identical (A's outputs to B's and each bundle's runs to each other). Exit 1 when not.

  run      `python3 -I pricer_identity.py run <bundle dir> <request.json> <out.json>`: one run, its time and the load
           before it; `cmp` two outputs afterwards (what the per-step checks of #1741 did against the base's output).

A bundle dir is what frontend/scripts/build_pricing_step.mjs --out <dir> writes.
"""
import hashlib
import json
import os
import subprocess
import sys
import time

SAMPLE_PER_CATEGORY = 60


def dump(out_dir):
    import frappe
    from nirmaan_stack.services.boq_rate_match import pricing_step

    os.makedirs(out_dir, exist_ok=True)
    payload, version = pricing_step.load_asset()
    page_rows, rows = {}, []
    for b, sn in frappe.db.sql('select boq, sheet_name from "tabBoQ Rate Suggestion Run" where active=1 order by boq, sheet_name'):
        p, rr = pricing_step.sheet_inputs(b, sn)
        page_rows.update(p)
        rows += rr
    base = {**payload, "pageRows": page_rows, "rows": rows}
    reqs = {"driving_all.json": {**base, "mode": "driving"},
            "driving_sample.json": {**base, "mode": "driving", "sample": SAMPLE_PER_CATEGORY},
            "pricing.json": {**base, "full": False}}
    for name, req in reqs.items():
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(req, f, default=str)
    print(json.dumps({"asset_version": version, "rows": len(rows), "sheets": len(page_rows), "out": out_dir}))


def _run(bundle_dir, req_bytes):
    t = time.monotonic()
    p = subprocess.run(["node", os.path.join(bundle_dir, "pricing_step.mjs")], input=req_bytes, capture_output=True, check=False)
    secs = time.monotonic() - t
    if p.returncode != 0:
        raise SystemExit(f"{bundle_dir}: exit {p.returncode}: {p.stdout[-300:]!r} {p.stderr[-300:]!r}")
    return secs, p.stdout


def compare(a, b, req_path, runs=1, out_dir=None):
    with open(req_path, "rb") as f:
        req = f.read()
    outs, times = {"A": [], "B": []}, {"A": [], "B": []}
    for i in range(runs):
        for tag, d in (("A", a), ("B", b)):
            load = os.getloadavg()
            secs, out = _run(d, req)
            times[tag].append(secs)
            outs[tag].append(out)
            print(f"run {i + 1} {tag}: {secs:.1f} s  (load before {load[0]:.2f} {load[1]:.2f} {load[2]:.2f})  "
                  f"sha256 {hashlib.sha256(out).hexdigest()[:16]}  {len(out)} bytes", flush=True)
            if out_dir:
                os.makedirs(out_dir, exist_ok=True)
                with open(os.path.join(out_dir, f"{os.path.basename(req_path)}.{tag}.{i + 1}.json"), "wb") as f:
                    f.write(out)
    same = len({o for v in outs.values() for o in v}) == 1
    for tag in ("A", "B"):
        t = times[tag]
        print(f"{tag}: min {min(t):.1f} s  max {max(t):.1f} s  mean {sum(t) / len(t):.1f} s  (spread {max(t) - min(t):.1f} s)")
    ratio = (sum(times["B"]) / len(times["B"])) / (sum(times["A"]) / len(times["A"]))
    print(f"B / A mean time: {ratio:.3f}")
    print("BYTE-IDENTICAL" if same else "DIFFERENT OUTPUT")
    return same


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "dump":
        dump(args[1])
    elif args and args[0] == "run":
        load = os.getloadavg()
        with open(args[2], "rb") as f:
            secs, out = _run(args[1], f.read())
        with open(args[3], "wb") as f:
            f.write(out)
        print(f"{args[1]} on {os.path.basename(args[2])}: {secs:.1f} s  (load before {load[0]:.2f} {load[1]:.2f} {load[2]:.2f})  "
              f"sha256 {hashlib.sha256(out).hexdigest()[:16]}  {len(out)} bytes")
    elif args and args[0] == "compare":
        runs = int(args[args.index("--runs") + 1]) if "--runs" in args else 1
        out = args[args.index("--out") + 1] if "--out" in args else None
        sys.exit(0 if compare(args[1], args[2], args[3], runs=runs, out_dir=out) else 1)
    else:
        raise SystemExit(__doc__)

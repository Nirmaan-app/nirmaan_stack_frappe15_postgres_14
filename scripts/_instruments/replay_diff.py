"""SLICE 12b(A) -- TEMPORARY, UNTRACKED. No DB write, no AI call.

Two jobs:

  coverage <run.json>            -- what the sweep actually exercises, per category, and which
                                    fold / shared sites it PROVES are reached. A no-op proof over a
                                    sweep that never reaches the changed step is vacuous, so this is
                                    run and READ before any AFTER figure is trusted.

  diff <before.json> <after.json>
                                 -- the proof. Exits non-zero and prints every difference. Ruling 3:
                                    a single moved figure is a STOP, never a rounding allowance.

The per-run digest is a SHA-256 over the canonical JSON of the whole record list, sorted by
(category, item_uid) -- the sweep already emits in that order, and every float was serialised to
17 significant digits as TEXT by the harness, so the digest cannot hide a low-bit difference.
"""

import collections
import hashlib
import json
import sys


def load(p):
    return json.load(open(p, encoding="utf-8"))


def key(rec):
    return (rec.get("category"), rec.get("item_uid"))


def digest(rows):
    canon = json.dumps(
        sorted(rows, key=lambda r: (str(r.get("category")), str(r.get("item_uid")))),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def coverage(path):
    rows = load(path)
    per = collections.defaultdict(collections.Counter)
    finals = collections.Counter()
    threw = 0
    for rec in rows:
        if "threw" in rec:
            threw += 1
            continue
        c = rec["category"]
        for r in rec.get("results", []):
            per[c][r["status"]] += 1
            if r["status"] == "ok":
                finals[c] += len(r["finals"])
    print("%-24s %5s %9s %13s" % ("category", "ok", "no_match", "final values"))
    for c in sorted(per):
        print("%-24s %5d %9d %13d" % (c, per[c]["ok"], per[c]["no_match"], finals[c]))
    print("")
    print("records: %d   threw: %d   total final values: %d" % (len(rows), threw, sum(finals.values())))
    print("digest: %s" % digest(rows))

    # WHICH CHANGED SITES ARE PROVEN REACHED. A step's trace line is only emitted when the step RAN,
    # so counting `ok` results per category is not enough -- point_wiring's fold multipliers sit at
    # step 12+, well past several refusal points. A category with 0 reached here cannot certify its
    # own migration and must say so.
    reached = collections.Counter()
    for rec in rows:
        if "threw" in rec:
            continue
        for r in rec.get("results", []):
            # a run that produced any final necessarily executed every step before the output
            if r["status"] == "ok" and r["finals"]:
                reached[(rec["category"], r["pipeline"])] += 1
    print("")
    print("pipelines that produced at least one figure (these are the ones the proof can certify):")
    for (c, p), n in sorted(reached.items()):
        print("  %-24s %-22s %5d" % (c, p, n))
    unreached = []
    for rec in rows:
        if "threw" in rec:
            continue
        for r in rec.get("results", []):
            k = (rec["category"], r["pipeline"])
            if k not in reached:
                unreached.append(k)
    if unreached:
        print("")
        print("⚠️ pipelines the sweep NEVER got a figure out of -- NOT certified by this proof:")
        for k in sorted(set(unreached)):
            print("  %-24s %-22s" % k)


def diff(bp, ap):
    b, a = load(bp), load(ap)
    bd, ad = digest(b), digest(a)
    print("before digest: %s  (%d records)" % (bd, len(b)))
    print("after  digest: %s  (%d records)" % (ad, len(a)))
    if bd == ad:
        print("")
        print("IDENTICAL -- every figure, every refusal and every selection matched.")
        return 0

    bi = {key(r): r for r in b}
    ai = {key(r): r for r in a}
    problems = []

    for k in sorted(set(bi) - set(ai)):
        problems.append(("record vanished", k, "", ""))
    for k in sorted(set(ai) - set(bi)):
        problems.append(("record appeared", k, "", ""))

    for k in sorted(set(bi) & set(ai)):
        rb, ra = bi[k], ai[k]
        if rb.get("selection") != ra.get("selection"):
            problems.append(("SELECTION DIFFERS -- the two runs were asked different questions", k, "", ""))
            continue
        pb = {r["pipeline"]: r for r in rb.get("results", [])}
        pa = {r["pipeline"]: r for r in ra.get("results", [])}
        for p in sorted(set(pb) | set(pa)):
            x, y = pb.get(p), pa.get(p)
            if x is None or y is None:
                problems.append(("pipeline present on one side only", k, p, ""))
                continue
            if x["status"] != y["status"]:
                problems.append(("STATUS MOVED", k, p, "%s -> %s" % (x["status"], y["status"])))
            for fk in sorted(set(x["finals"]) | set(y["finals"])):
                xv, yv = x["finals"].get(fk), y["finals"].get(fk)
                if xv != yv:
                    problems.append(("FIGURE MOVED", k, "%s.%s" % (p, fk), "%s -> %s" % (xv, yv)))
            if x.get("last_condition") != y.get("last_condition"):
                problems.append(("refusal text changed", k, p, "%r -> %r" % (x.get("last_condition"), y.get("last_condition"))))

    figure_moves = [p for p in problems if p[0] == "FIGURE MOVED"]
    status_moves = [p for p in problems if p[0] == "STATUS MOVED"]
    print("")
    print("DIFFERENCES: %d total, of which %d moved figures and %d moved statuses"
          % (len(problems), len(figure_moves), len(status_moves)))
    for kind, k, where, detail in problems[:400]:
        print("  [%s] %s %s %s" % (kind, k, where, detail))
    if len(problems) > 400:
        print("  ... %d more" % (len(problems) - 400))
    print("")
    print("⚠️ RULING 3: a moved figure is a STOP, not a rounding allowance.")
    return 1


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "coverage":
        coverage(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "diff":
        sys.exit(diff(sys.argv[2], sys.argv[3]))
    else:
        print(__doc__)
        sys.exit(2)

"""SLICE 12b(A) FOLD SEARCH -- TEMPORARY, UNTRACKED. No DB write, no AI call.

Owner ruling: S07 (0.495) is a fold of a 70% switchgear discount and a 65% markup -- the FOURTH fold,
after point wiring's three. "Check your remaining Class-A inputs for the SAME shape before the mint."

⚠️ THE FIRST VERSION OF THIS SCRIPT WAS USELESS AND THE REASON IS WORTH KEEPING. It graded a candidate
CONFIRMED when both factors merely EXISTED somewhere in the catalogue -- and with only 29 distinct
values across 161 cells, almost everything factorises into two of them by coincidence: it "confirmed"
38 of 48 groups, including `0.45 = (1-0.70)x(1+0.50)` and `0.20 = 0.25 x 0.80`. Arithmetically true,
meaningless. A search that flags everything has found nothing.

WHAT THE FOUR KNOWN FOLDS ACTUALLY HAVE IN COMMON -- the real signature:

  0.602  = (1-0.57)x(1+0.40)  and `wiring_cabling.cable_boq[4]` holds discount 0.57 AND markup 0.40 in
                              ONE condition, under the formula `(1-discount)*(1+markup)`.
  0.4515 = (1-0.57)x(1+0.05)  and `cable_bcs[1]` holds discount 0.57 AND wastage 0.05 in ONE condition,
                              under `(1-discount)*(1+wastage)`.
  0.0725 = 0.3625 x 0.20      and `switches_sockets` applies 0.3625 then 0.20 in successive steps of
                              ONE pipeline.
  0.495  = (1-0.70)x(1+0.65)  and NEITHER 0.70-as-a-switchgear-discount nor 0.65 appears ANYWHERE.

So the only mechanical evidence that means anything is CO-OCCURRENCE IN ONE STEP (or one pipeline) UNDER
THE MATCHING FORM. Everything else is arithmetic, and S07 proves the repo cannot settle those: 0.65 is
in no cell, so no amount of searching would have found it. Those go to the owner as questions, not
findings.

usage: python3 _slice12b_foldsearch.py <asset.json>
"""

import itertools
import json
import sys
from collections import defaultdict

TOL = 1e-12
# Round business factors only: 5% steps. A fold is a DECISION pair, and nobody decides on 0.5375.
GRID = [round(x * 0.05, 4) for x in range(1, 20)]


def close(a, b):
    return abs(a - b) <= TOL * max(1.0, abs(a), abs(b))


def steps_of(asset):
    for cfg in asset.get("category_configs", []):
        cid = cfg.get("category_id")
        for pname, pl in (cfg.get("pipelines") or {}).items():
            sts = pl.get("steps") if isinstance(pl, dict) else pl
            for i, st in enumerate(sts or []):
                yield cid, pname, i, st


def numeric_params(st):
    """Every numeric param of a step, and of each of its conditions, as {scope: {key: value}}."""
    out = {}
    ps = {k: float(v) for k, v in (st.get("params") or {}).items()
          if isinstance(v, (int, float)) and not isinstance(v, bool) and k != "digits"}
    if ps:
        out["params"] = ps
    for j, cond in enumerate(st.get("conditions") or []):
        cp = {k: float(v) for k, v in (cond.get("params") or {}).items()
              if isinstance(v, (int, float)) and not isinstance(v, bool) and k != "digits"}
        if cp:
            out["cond%d" % j] = cp
    return out


def main():
    asset = json.load(open(sys.argv[1], encoding="utf-8"))

    # --- 1. THE EVIDENCED SET: every value a step actually PRODUCES from a pair in its own params ---
    # For each step, for each pair of its own numeric params, compute the product the step's formula
    # implies and record it. Any Class-A value equal to one of these is a re-derivation, not a
    # coincidence.
    produced = defaultdict(list)  # value -> [(where, how)]
    for cid, pname, i, st in steps_of(asset):
        f = st.get("formula") or ""
        for scope, ps in numeric_params(st).items():
            for (k1, v1), (k2, v2) in itertools.permutations(ps.items(), 2):
                where = "%s.%s[%d].%s" % (cid, pname, i, scope)
                # the two combining forms this catalogue uses
                if "(1-" in f.replace(" ", "") and "(1+" in f.replace(" ", ""):
                    produced[round((1.0 - v1) * (1.0 + v2), 12)].append(
                        (where, "(1-%s %.4g)x(1+%s %.4g)  formula %s" % (k1, v1, k2, v2, f)))
                produced[round(v1 * v2, 12)].append((where, "%s %.4g x %s %.4g" % (k1, v1, k2, v2)))

    # successive multipliers WITHIN ONE PIPELINE (the 0.0725 shape)
    seq = defaultdict(list)
    for cfg in asset.get("category_configs", []):
        cid = cfg.get("category_id")
        for pname, pl in (cfg.get("pipelines") or {}).items():
            sts = pl.get("steps") if isinstance(pl, dict) else pl
            vals = []
            for i, st in enumerate(sts or []):
                for scope, ps in numeric_params(st).items():
                    for k, v in ps.items():
                        vals.append((i, scope + "." + k, v))
                for j, rs in enumerate(st.get("rate_stages") or []):
                    for k, v in rs.items():
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            vals.append((i, "stage%d.%s" % (j, k), float(v)))
            for (i1, k1, v1), (i2, k2, v2) in itertools.combinations(vals, 2):
                if v1 in (0.0, 1.0) or v2 in (0.0, 1.0):
                    continue
                seq[round(v1 * v2, 12)].append(("%s.%s" % (cid, pname), "%s[%d] %.4g x %s[%d] %.4g"
                                                % (k1, i1, v1, k2, i2, v2)))

    # --- 2. the Class-A population: one entry per (category, value) ---
    targets = defaultdict(list)
    for cid, pname, i, st in steps_of(asset):
        for scope, ps in numeric_params(st).items():
            for k, v in ps.items():
                if v in (0.0, 1.0):
                    continue
                targets[(cid, round(v, 12))].append("%s.%s[%d].%s.%s" % (cid, pname, i, scope, k))
        for j, rs in enumerate(st.get("rate_stages") or []):
            for k, v in rs.items():
                if not isinstance(v, (int, float)) or isinstance(v, bool) or v in (0.0, 1.0):
                    continue
                targets[(cid, round(float(v), 12))].append(
                    "%s.%s[%d].stage%d.%s" % (cid, pname, i, j, k))

    print("(category, value) groups examined: %d" % len(targets))
    print("")

    evidenced, arithmetic_only = [], []
    for (cid, v), sites in sorted(targets.items()):
        if v <= 0 or v >= 3:
            continue
        # EVIDENCED: some OTHER step already produces exactly this value from a pair of its own params,
        # or two multipliers in one pipeline multiply to it.
        ev = [(w, h) for w, h in produced.get(v, []) if not w.startswith(cid + ".")]
        ev += [(w, h) for w, h in seq.get(v, []) if not w.startswith(cid + ".")]
        if ev:
            evidenced.append((cid, v, sites, ev[:4]))
            continue
        hits = [(d, m) for d in GRID for m in GRID if close((1.0 - d) * (1.0 + m), v)]
        if hits:
            arithmetic_only.append((cid, v, sites, hits))

    print("=" * 98)
    print("A · EVIDENCED FOLD CANDIDATES -- another step already builds this exact number from a pair")
    print("=" * 98)
    if not evidenced:
        print("  none.")
    for cid, v, sites, ev in evidenced:
        print("%-22s %-10s  %d site(s)" % (cid, v, len(sites)))
        for w, h in ev:
            print("      built at %s  as  %s" % (w, h))
        for s in sites[:4]:
            print("        site: %s" % s)
        print("")

    print("=" * 98)
    print("B · ARITHMETIC ONLY -- fits (1-d)x(1+m) on round factors, but NOTHING in any config")
    print("    builds it that way. S07 was this shape, so these are QUESTIONS FOR THE OWNER, not")
    print("    findings. Each line is every round decomposition that fits exactly.")
    print("=" * 98)
    for cid, v, sites, hits in arithmetic_only:
        forms = ", ".join("(1-%.2f)x(1+%.2f)" % (d, m) for d, m in hits[:6])
        print("%-22s %-10s %d site(s)   %s%s"
              % (cid, v, len(sites), forms, "  ..." if len(hits) > 6 else ""))
    print("")
    print("groups with an evidenced decomposition: %d" % len(evidenced))
    print("groups with only an arithmetic decomposition: %d" % len(arithmetic_only))


if __name__ == "__main__":
    main()

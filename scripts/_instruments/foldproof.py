"""SLICE 12b(A) FOLD BIT-EXACTNESS PROOF -- TEMPORARY, UNTRACKED. No DB write, no AI call.

THE QUESTION THIS ANSWERS, BEFORE A LINE OF PRODUCT CODE IS WRITTEN.

Ruling 3 rewrites each folded literal to read its two inputs and multiply. That is only safe if the
PRODUCT equals the LITERAL -- and in IEEE-754 double it sometimes does not:

    (1-0.50)*(1+0.40) == 0.7      -> True   (conduit)
    (1-0.75)*(1+0.45) == 0.3625   -> True   (switches / sockets)
    (1-0.70)*(1+0.65) == 0.495    -> FALSE  0.49500000000000005   (S07 -- 552 figures, the heaviest)
    (1-0.57)*(1+0.40) == 0.602    -> FALSE  0.6020000000000001    (point wiring wire)

So two of the four folds change the number fed into the pipeline by one bit. Whether that reaches a
PRICE depends entirely on the ROUNDUP downstream -- and "it should round away" is not a proof.

This substitutes the COMPUTED product for the literal at every site, runs the rig, and diffs against
the baseline. It is the honest answer to ruling 3's "if any figure moves by any amount, STOP": it is
measured here, per fold, before anything is built on the assumption.

usage: python3 _slice12b_foldproof.py <asset.json> <baseline.json> <depth>
"""

import json
import os
import subprocess
import sys
import tempfile

# (label, literal, computed-product expression, a note on where it lives)
FOLDS = [
    ("S07 db/indsock 0.495 = (1-0.70)x(1+0.65)", 0.495, (1 - 0.70) * (1 + 0.65),
     "db_buildup_supply/install m x2, indsock paired_mcb.mult x2"),
    ("S01 conduit 0.70 = (1-0.50)x(1+0.40)", 0.7, (1 - 0.50) * (1 + 0.40),
     "conduit_boq boq_multiplier, pw conduit.mult x2, cable_boq conduit.mult"),
    ("S05 switch/accessory 0.3625 = (1-0.75)x(1+0.45)", 0.3625, (1 - 0.75) * (1 + 0.45),
     "swsock_boq m, popup_boq m, pw switch/socket/blank/plate/box.mult"),
    ("S03 pw wire 0.602 = (1-0.57)x(1+0.40)", 0.602, (1 - 0.57) * (1 + 0.40),
     "pw_boq_supply wire1/wire2/circuit_wire1/circuit_wire2.mult"),
    ("S04 pw wire 0.4515 = (1-0.57)x(1+0.05)", 0.4515, (1 - 0.57) * (1 + 0.05),
     "pw_bcs wire1/wire2/circuit_wire1/circuit_wire2.mult"),
    ("A30 pw accessory 0.0725 = 0.3625 x 0.20", 0.0725, 0.3625 * 0.20,
     "pw_boq_install socket/blank/plate/back_box.mult"),
    ("S06 switch/accessory cost 0.25 = 1-0.75", 0.25, 1 - 0.75,
     "swsock_bcs m, pw_bcs switch/socket/blank/plate/box.mult"),
    ("S02 conduit cost 0.50 = 1-0.50", 0.5, 1 - 0.50,
     "conduit_bcs bcs_multiplier, pw_bcs conduit.mult"),
]


def substitute(asset, literal, computed):
    """Replace every occurrence of `literal` with `computed` in every pipeline numeric cell."""
    d = json.loads(json.dumps(asset))
    n = 0

    def touch(c, k, v):
        nonlocal n
        if isinstance(v, bool) or not isinstance(v, (int, float)) or k == "digits":
            return
        if v == literal:
            c[k] = computed
            n += 1

    for cfg in d.get("category_configs", []):
        for pname, pl in (cfg.get("pipelines") or {}).items():
            steps = pl.get("steps") if isinstance(pl, dict) else pl
            for st in (steps or []):
                ps = st.get("params") or {}
                for k in list(ps):
                    touch(ps, k, ps[k])
                for k in list(ps.get("constants") or {}):
                    touch(ps["constants"], k, ps["constants"][k])
                for rs in (st.get("rate_stages") or []):
                    for k in list(rs):
                        touch(rs, k, rs[k])
                for cond in (st.get("conditions") or []):
                    cp = cond.get("params") or {}
                    for k in list(cp):
                        touch(cp, k, cp[k])
    return d, n


def figures(rows):
    out = {}
    for rec in rows:
        for r in rec.get("results", []):
            for k, v in (r.get("finals") or {}).items():
                out[(rec["category"], rec["item_uid"], r["pipeline"], k)] = v
    return out


def main():
    asset_path, baseline_path, depth = sys.argv[1], sys.argv[2], sys.argv[3]
    here = os.path.dirname(os.path.abspath(baseline_path))
    replay_js = os.path.join(here, "replay.js")
    asset = json.load(open(asset_path, encoding="utf-8"))
    base = figures(json.load(open(baseline_path, encoding="utf-8")))
    tmp = tempfile.mkdtemp()

    print("baseline figures: %d" % len(base))
    print("")
    print("%-52s %6s %5s %9s  %s" % ("fold", "bitEq", "sites", "moved", "verdict"))
    any_move = False
    for label, lit, comp, where in FOLDS:
        bit_equal = (comp == lit)
        d, n = substitute(asset, lit, comp)
        if n == 0:
            print("%-52s %6s %5d %9s  %s" % (label, bit_equal, 0, "-", "no site holds the literal"))
            continue
        if bit_equal:
            print("%-52s %6s %5d %9d  %s" % (label, "YES", n, 0,
                  "SAFE BY ARITHMETIC -- the product IS the literal"))
            continue
        ap, op = os.path.join(tmp, "a.json"), os.path.join(tmp, "o.json")
        json.dump(d, open(ap, "w", encoding="utf-8"))
        subprocess.run(["node", replay_js, ap, op, str(depth)], check=True, capture_output=True, text=True)
        after = figures(json.load(open(op, encoding="utf-8")))
        moved = [(k, base[k], after.get(k)) for k in base if after.get(k) != base[k]]
        if moved:
            any_move = True
        print("%-52s %6s %5d %9d  %s" % (label, "NO", n, len(moved),
              "ROUNDING ABSORBS IT" if not moved else "*** FIGURES MOVE -- STOP ***"))
        for k, b, a in moved[:8]:
            print("        %s  %s -> %s" % (" ".join(map(str, k)), b, a))
    print("")
    if any_move:
        print("*** AT LEAST ONE FOLD MOVES A FIGURE. Ruling 3: STOP and report, do not accept it. ***")
    else:
        print("Every fold is either bit-equal or fully absorbed by the downstream ROUNDUP: the")
        print("rewrite can be built without moving a single price. Measured, not assumed.")


if __name__ == "__main__":
    main()

"""SLICE 8 -- TEMPORARY, UNTRACKED.

(1) check: prove the BEFORE replay reproduces the captured run exactly (refusal text and figures).
(2) diff:  BEFORE vs AFTER -- newly priced, changed-while-priced, and priced -> blank.
"""
import json
import sys


def load(p):
    return json.load(open(p, encoding="utf-8"))


def key(r):
    return (r["boq"], r["sheet"], r["excel_row"])


def check(before_path):
    rows = load(before_path)
    bad_reason, bad_fig, ok = [], [], 0
    for r in rows:
        cap_ref = r["cap_refusal"]
        cap_val = r["cap_values"] or {}
        if r["priced"]:
            if cap_ref is not None:
                bad_reason.append((key(r), "replay priced, capture refused: " + str(cap_ref)))
                continue
            cs, ci = cap_val.get("supply_rate"), cap_val.get("install_rate")
            if cs != r["supply"] or ci != r["install"]:
                bad_fig.append((key(r), f"capture {cs}/{ci} vs replay {r['supply']}/{r['install']}"))
                continue
        else:
            if cap_ref is None:
                bad_reason.append((key(r), "replay refused, capture priced: " + str(r["reason"])))
                continue
            if cap_ref != r["reason"]:
                bad_reason.append((key(r), f"capture {cap_ref!r} vs replay {r['reason']!r}"))
                continue
        ok += 1
    print(f"BEFORE vs CAPTURE: {ok}/{len(rows)} identical")
    print(f"  reason mismatches: {len(bad_reason)}")
    for k, m in bad_reason[:15]:
        print("   ", k, m)
    print(f"  figure mismatches: {len(bad_fig)}")
    for k, m in bad_fig[:15]:
        print("   ", k, m)
    return not bad_reason and not bad_fig


def diff(before_path, after_path):
    b = {key(r): r for r in load(before_path)}
    a = {key(r): r for r in load(after_path)}
    assert set(b) == set(a), "row sets differ"
    # THE THREE QUESTIONS P1 ASKS, kept apart. A row that was refused and is STILL refused has no price on
    # either side, so a change in WHICH item names the refusal is NOT a price change -- it gets its own bucket.
    newly, repriced, reworded, lost, same = [], [], [], [], 0
    for k in b:
        rb, ra = b[k], a[k]
        if not rb["priced"] and ra["priced"]:
            newly.append(ra)
        elif rb["priced"] and not ra["priced"]:
            lost.append((rb, ra))
        elif rb["priced"] and ra["priced"]:
            if rb["supply"] != ra["supply"] or rb["install"] != ra["install"]:
                repriced.append((rb, ra))
            else:
                same += 1
        else:
            if rb["reason"] != ra["reason"]:
                reworded.append((rb, ra))
            else:
                same += 1
    print(f"rows={len(b)}  unchanged={same}")
    print(f"NEWLY PRICED (blank -> priced):            {len(newly)}")
    print(f"PRICE CHANGED WHILE PRICED:                {len(repriced)}   <- must be 0")
    print(f"PRICED -> BLANK:                           {len(lost)}   <- must be 0")
    print(f"still refused, different refusal wording:  {len(reworded)}   (no price either side)")
    print()
    by_rule = {"M-b (UL wins)": 0, "M-c (per piece)": 0, "other": 0}
    for r in newly:
        w = " ".join(x for i in r["items"] for x in i["working"])
        if "R-M-b" in w:
            by_rule["M-b (UL wins)"] += 1
        elif "R-M-c" in w:
            by_rule["M-c (per piece)"] += 1
        else:
            by_rule["other"] += 1
    print("newly priced BY RULE:", by_rule)
    print()
    print("=== NEWLY PRICED ===")
    for r in newly:
        it = [i for i in r["items"]]
        skus = " + ".join(f"{i['family']}: {i['sku']}" for i in it)
        pt = r["pricer_typed"] or {}
        print(f"{r['boq']} | {r['sheet']} | row {r['excel_row']} | unit {r['unit']} | qty {r['qty']}")
        print(f"    text   : {(r['row_text'] or '')[:150]}")
        print(f"    was    : {r['reason']}")
        print(f"    SKU    : {skus}")
        print(f"    figure : supply {r['supply']}  install {r['install']}")
        print(f"    pricer typed (information only): supply {pt.get('supply_rate')}  install {pt.get('install_rate')}")
        for i in it:
            for w in i["working"]:
                print(f"      working[{i['index']}]: {w}")
    print()
    print("=== STILL REFUSED, DIFFERENT REFUSAL WORDING (no price either side) ===")
    for rb, ra in reworded + repriced:
        print(f"{rb['boq']} | {rb['sheet']} | row {rb['excel_row']}")
        print(f"    before: priced={rb['priced']} {rb['supply']}/{rb['install']} reason={rb['reason']}")
        print(f"    after : priced={ra['priced']} {ra['supply']}/{ra['install']} reason={ra['reason']}")
    print()
    print("=== PRICED -> BLANK ===")
    for rb, ra in lost:
        print(f"{rb['boq']} | {rb['sheet']} | row {rb['excel_row']}  was {rb['supply']}/{rb['install']}  now {ra['reason']}")


if __name__ == "__main__":
    if sys.argv[1] == "check":
        sys.exit(0 if check(sys.argv[2]) else 1)
    diff(sys.argv[2], sys.argv[3])

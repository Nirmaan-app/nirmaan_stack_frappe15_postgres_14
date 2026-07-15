#!/usr/bin/env python
"""
decay_sweep.py -- tracked offline proximity-decay multiplier sweep over a labelled corpus (D2c).

Promotes the proven D2 scratch sweep into a parameterized, version-controlled analysis tool. Given a
folder of labelled verdict files (the Set2_Verdicts_Relabeled format: xlsx/csv, the locked 20-column
harness schema + a team_classification LAST column, BoQ id from the filename prefix, parent_excel_row
for the ancestor walk), it rebuilds each row's classifier feed, runs the rule runner across a ladder of
decay multipliers via classify_line(decay_override=...), and scores predictions against the human team
labels. Pure OFFLINE: imports only the framework-free runner + routing; NO frappe, NO DB, NO AI, NO
network in the hot path.

Feed rebuild MATCHES context_builder.py:181-184 semantics (anc_texts=[sheet]+[desc+notes] root-first,
anc_headers=[sheet]+[desc-only]); context_builder itself is DB-bound (frappe.get_all) so it cannot be
imported for a file-based offline tool -- the walk is re-implemented from parent_excel_row and kept
faithful to the harness feed (own notes = the file's pre-combined 'notes' column = _notes_text).

The faithfulness section (flat prediction vs the files' stored rule_category column) is REPORT-ONLY,
never a gate: the D2 finding is that the stored rule_category ages with the engine tip while
team_classification does not, so a low flat-vs-stored rate is expected on an older export and does NOT
invalidate the sweep (which scores against the tip-independent team labels).

MEASURED RESULT (electrical, Set2 = 4,159 labelled line items, D2/D2b): flat m=1.0 = 84.68% and NO
multiplier beats flat beyond noise (best +3 rows at m=0.90/0.95); the topmost-exempt variant shapes were
tested and REJECTED for electrical (they recover the ups/earthing losses but erase the wiring_cabling
gains -- same-distance-banner cancellation). Electrical decay is therefore LOCKED FLAT (1.0). The
variant shapes are deliberately NOT included here; a tracked shape option gets built only if a measured
HVAC sweep wins with it.

INPUT + OUTPUT stay LOCAL and are NEVER defaulted into the repo tree. INPUT via env BOQ_SWEEP_INPUT or a
positional CLI arg (no default; never defaulted inside _classification_review/). OUTPUT (--out) is
REQUIRED, must already exist, and is refused if it lies inside _classification_review/.

Usage:
  BOQ_SWEEP_INPUT=<labelled_dir> env/bin/python \\
      apps/nirmaan_stack/nirmaan_stack/services/boq_category/harness/decay_sweep.py --out <OUTPUT_DIR>
  # or: ... decay_sweep.py <labelled_dir> --out <OUTPUT_DIR> --discipline Electrical --ladder 1.0,0.9,0.8
"""
import argparse
import collections
import csv
import glob
import os
import sys

import openpyxl

from nirmaan_stack.services.boq_category.routing import load_routing_config, route_r3d
from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset

# The certified D2 ladder (20 values). Overridable via --ladder.
DEFAULT_LADDER = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55,
                  0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05]
# The harness scorable-row rule (context_builder / electrical_classification_harness CLASSIFY_NT).
CLASSIFY_NT = {"Line Item", "Preamble"}
_HOP_CAP = 80  # mirrors context_builder ancestor walk


# --------------------------------------------------------------------------- file IO
def _norm(v):
    return "" if v is None else str(v).strip()


def _to_int(v):
    s = _norm(v)
    if s == "":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _num(v):
    s = _norm(v)
    try:
        return float(s)
    except ValueError:
        return 0.0


def _read_xlsx(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def _read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return [r for r in csv.reader(fh)]


def _find_header(rows):
    """The header row = the first of the first 6 rows carrying sheet_name + team_classification."""
    for i, r in enumerate(rows[:6]):
        hs = {_norm(c) for c in r}
        if "sheet_name" in hs and "team_classification" in hs:
            return i, [_norm(c) for c in r]
    return 0, [_norm(c) for c in (rows[0] if rows else [])]


def load_file(path):
    """Return (header_list, list-of-row-dicts). Row dicts key each header name -> cell value."""
    rows = _read_xlsx(path) if path.lower().endswith(".xlsx") else _read_csv(path)
    hidx, header = _find_header(rows)
    ci = {h: j for j, h in enumerate(header)}
    out = []
    for r in rows[hidx + 1:]:
        if r is None or not any(_norm(c) for c in r):
            continue
        out.append({h: (r[j] if j < len(r) else None) for h, j in ci.items()})
    return header, out


def corpus_files(folder):
    """BoQ data files only (BOQ-*__*.xlsx|csv); excludes report .md + non-BoQ helper files."""
    fs = []
    for p in sorted(glob.glob(os.path.join(folder, "*"))):
        b = os.path.basename(p)
        if not b.startswith("BOQ-") or "__" not in b:
            continue
        if b.lower().rsplit(".", 1)[-1] not in ("xlsx", "csv"):
            continue
        fs.append(p)
    return fs


# --------------------------------------------------------------------------- feed rebuild
def _ancestor_feed(row, by_excel):
    """Rebuild (desc, anc_texts, anc_headers, notes_list) for one row, faithful to
    context_builder.py:181-184 / the harness. Walk parent_excel_row -> root, cycle-guarded and
    hop-capped, then root-first: anc_texts=[sheet]+[desc+notes], anc_headers=[sheet]+[desc-only]."""
    chain = []
    seen = set()
    cur = _to_int(row.get("parent_excel_row"))
    hops = 0
    while cur is not None and cur in by_excel and cur not in seen and hops < _HOP_CAP:
        seen.add(cur)
        hops += 1
        a = by_excel[cur]
        chain.append(a)
        cur = _to_int(a.get("parent_excel_row"))
    chain.reverse()  # root-first
    sn = _norm(row.get("sheet_name"))
    desc = "" if row.get("description") is None else str(row.get("description"))
    own_notes = "" if row.get("notes") is None else str(row.get("notes")).strip()
    anc_texts = [sn] + [
        f"{('' if a.get('description') is None else str(a.get('description')))} "
        f"{('' if a.get('notes') is None else str(a.get('notes')).strip())}".strip()
        for a in chain
    ]
    anc_headers = [sn] + [("" if a.get("description") is None else str(a.get("description"))) for a in chain]
    notes_list = [own_notes] if own_notes else []
    disp = [_norm(a.get("description"))[:34] for a in chain][-2:]
    return desc, anc_texts, anc_headers, notes_list, disp


def build_scored_feed(files):
    """Scored set = LINE ITEM rows with a non-blank team_classification. Returns (records, has_ai)."""
    records = []
    has_ai = True
    for p in files:
        header, rows = load_file(p)
        if "ai_category" not in header or "ai_confidence" not in header:
            has_ai = False
        by_excel = {}
        for r in rows:
            er = _to_int(r.get("excel_row"))
            if er is not None:
                by_excel[er] = r
        for r in rows:
            if _norm(r.get("node_type")) != "Line Item":
                continue
            truth = _norm(r.get("team_classification"))
            if truth == "":
                continue
            desc, at, ah, nl, disp = _ancestor_feed(r, by_excel)
            records.append({
                "file": os.path.basename(p), "excel_row": _norm(r.get("excel_row")),
                "desc": desc, "at": at, "ah": ah, "nl": nl, "truth": truth,
                "ai_cat": _norm(r.get("ai_category")), "ai_conf": _num(r.get("ai_confidence")),
                "anc_disp": disp,
            })
    return records, has_ai


# --------------------------------------------------------------------------- pipeline sections
def faithfulness_report(files, discipline):
    """REPORT-ONLY: flat classify_line vs the files' stored rule_category over eligible rows."""
    print("=== FAITHFULNESS (report-only; flat prediction vs stored rule_category) ===")
    tot = match = 0
    have_col = False
    buckets = collections.Counter()
    for p in files:
        header, rows = load_file(p)
        if "rule_category" not in header:
            continue
        have_col = True
        by_excel = {}
        for r in rows:
            er = _to_int(r.get("excel_row"))
            if er is not None:
                by_excel[er] = r
        for r in rows:
            if _norm(r.get("node_type")) not in CLASSIFY_NT:
                continue
            desc, at, ah, nl, _ = _ancestor_feed(r, by_excel)
            cat = classify_line(desc, at, nl, discipline=discipline, ancestor_headers=ah)["category_id"]
            stored = _norm(r.get("rule_category"))
            tot += 1
            if stored == (cat or ""):
                match += 1
            else:
                buckets[(stored, cat or "")] += 1
    if not have_col:
        print("  (no rule_category column in the corpus -- faithfulness skipped)\n")
        return
    rate = (100.0 * match / tot) if tot else 0.0
    print(f"  eligible rows compared = {tot}   flat == stored = {match}  ({rate:.2f}%)")
    print("  NOTE: report-only, NOT a gate. The stored rule_category ages with the engine tip while the")
    print("        team labels do not; a low rate on an older export is expected and does not invalidate")
    print("        the sweep (which scores against team_classification). See D2 findings.")
    print("  top drift buckets (stored -> flat):")
    for (s, c), n in buckets.most_common(8):
        print(f"    {n:>4}  {s!r:22} -> {c!r}")
    print()


def _predict(records, discipline, m):
    dov = None if m >= 1.0 else {"rules_multiplier": m}
    out = []
    for rec in records:
        res = classify_line(rec["desc"], rec["at"], rec["nl"], discipline=discipline,
                            ancestor_headers=rec["ah"], decay_override=dov)
        out.append((res["category_id"], res["band"]))
    return out


def sweep(records, discipline, ladder, has_ai, out_dir):
    """Run the ladder; print + CSV the main table. Returns (table, predcache)."""
    n = len(records)
    rcfg = load_routing_config() if has_ai else None
    flat = _predict(records, discipline, 1.0) if 1.0 in ladder else _predict(records, discipline, 1.0)
    predcache = {1.0: flat}
    table = []
    for m in ladder:
        preds = flat if m == 1.0 else _predict(records, discipline, m)
        predcache[m] = preds
        correct = blank = changed = 0
        bc = collections.Counter()
        bok = collections.Counter()
        aa = aa_ok = human = 0
        for rec, (cat, band), (fc, _fb) in zip(records, preds, flat):
            t = rec["truth"]
            if cat == "":
                blank += 1
            if cat == t:
                correct += 1
                bok[band] += 1
            bc[band] += 1
            if cat != fc:
                changed += 1
            if has_ai:
                routed = route_r3d({"category_id": cat, "band": band},
                                   {"category_id": rec["ai_cat"], "confidence": rec["ai_conf"]}, rcfg)
                if routed["routing"] == "Auto-accepted":
                    aa += 1
                    if routed["final_category_id"] == t:
                        aa_ok += 1
                else:
                    human += 1
        high_acc = (100.0 * bok["HIGH"] / bc["HIGH"]) if bc["HIGH"] else float("nan")
        table.append({
            "m": m, "acc": 100.0 * correct / n, "correct": correct, "blank": blank,
            "placed": (100.0 * correct / (n - blank)) if (n - blank) else 0.0,
            "high_n": bc["HIGH"], "high_acc": high_acc,
            "med_n": bc["MED"], "med_acc": (100.0 * bok["MED"] / bc["MED"]) if bc["MED"] else 0.0,
            "low_n": bc["LOW"], "low_acc": (100.0 * bok["LOW"] / bc["LOW"]) if bc["LOW"] else 0.0,
            "abstain_n": bc["ABSTAIN"], "changed": changed,
            "aa": aa, "aa_acc": (100.0 * aa_ok / aa) if aa else 0.0, "human": human,
            "breach": (bc["HIGH"] and high_acc < 95.0),
        })

    ai_note = "with routing (AI held at export tip)" if has_ai else "routing SKIPPED (no AI columns)"
    print(f"=== SWEEP TABLE  (scored on {n} line items; {ai_note}) ===")
    hdr = (f"{'m':>5} {'acc%':>6} {'placed%':>7} {'blank':>5} {'HIGHn':>5} {'HIGHacc':>7} {'chg':>5} "
           f"{'auto':>5} {'autoAcc':>7} {'human':>5}  flag")
    print(hdr)
    print("-" * len(hdr))
    for t in table:
        flag = "  <HIGH<95>" if t["breach"] else ""
        auto = f"{t['aa']:>5}" if has_ai else f"{'-':>5}"
        aacc = f"{t['aa_acc']:>7.2f}" if has_ai else f"{'-':>7}"
        human = f"{t['human']:>5}" if has_ai else f"{'-':>5}"
        print(f"{t['m']:>5.2f} {t['acc']:>6.2f} {t['placed']:>7.2f} {t['blank']:>5} {t['high_n']:>5} "
              f"{t['high_acc']:>7.2f} {t['changed']:>5} {auto} {aacc} {human}{flag}")

    with open(os.path.join(out_dir, "sweep_table.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["m", "accuracy_pct", "correct", "denominator", "blank_routed_to_human",
                    "accuracy_placed_pct", "HIGH_n", "HIGH_acc_pct", "MED_n", "MED_acc_pct",
                    "LOW_n", "LOW_acc_pct", "ABSTAIN_n", "rows_changed_vs_flat",
                    "auto_accept_n", "auto_accept_acc_pct", "human_review_n", "HIGH_guardrail_breach"])
        for t in table:
            aa = t["aa"] if has_ai else ""
            aacc = f"{t['aa_acc']:.3f}" if has_ai else ""
            human = t["human"] if has_ai else ""
            w.writerow([t["m"], f"{t['acc']:.3f}", t["correct"], n, t["blank"], f"{t['placed']:.3f}",
                        t["high_n"], f"{t['high_acc']:.3f}", t["med_n"], f"{t['med_acc']:.3f}",
                        t["low_n"], f"{t['low_acc']:.3f}", t["abstain_n"], t["changed"],
                        aa, aacc, human, int(bool(t["breach"]))])
    print(f"\n  saved sweep_table.csv")
    return table, predcache


def per_category_matrix(records, discipline, ladder, predcache, out_dir):
    """categories x multipliers recall vs team labels -> per_category_accuracy_matrix.csv (+ print)."""
    truth_n = collections.Counter(r["truth"] for r in records)
    cats = sorted(truth_n, key=lambda k: -truth_n[k])
    n = len(records)
    cols = {}
    for m in ladder:
        ok = collections.Counter()
        blank = 0
        for rec, (cat, _b) in zip(records, predcache[m]):
            if cat == "":
                blank += 1
            if cat == rec["truth"]:
                ok[rec["truth"]] += 1
        col = {c: (100.0 * ok[c] / truth_n[c]) for c in cats}
        col["_BLANK"] = 100.0 * blank / n
        col["_TOTAL"] = 100.0 * sum(ok.values()) / n
        cols[m] = col
    base = 1.0 if 1.0 in cols else ladder[0]
    print(f"\n=== PER-CATEGORY RECALL vs team labels (%)  base m={base:.2f}; * = moved >2pp ===")
    head = f"{'category':22} {'userN':>6} " + " ".join(f"{('m'+format(m, '.2f')):>8}" for m in ladder)
    print(head)
    print("-" * len(head))
    rowsout = []
    for key in cats + ["_BLANK", "_TOTAL"]:
        label = key
        un = truth_n.get(key, "")
        if key == "_BLANK":
            label, un = "(blank %ofN)", "-"
        elif key == "_TOTAL":
            label, un = "TOTAL accuracy", n
        cells = []
        for m in ladder:
            v = cols[m][key]
            star = "*" if (key != "_BLANK" and abs(v - cols[base][key]) > 2.0) else " "
            cells.append(f"{v:7.1f}{star}")
        print(f"{label:22} {str(un):>6} " + " ".join(cells))
        rowsout.append([label, un] + [f"{cols[m][key]:.1f}" for m in ladder])
    with open(os.path.join(out_dir, "per_category_accuracy_matrix.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["category", "userN"] + [f"m{m:.2f}" for m in ladder])
        w.writerows(rowsout)
    print("  saved per_category_accuracy_matrix.csv")


def diagnostics(records, ladder, table, predcache, out_dir):
    """Per-category delta + improvement/regression piles at the best candidate multipliers."""
    flat = predcache[1.0] if 1.0 in predcache else predcache[ladder[0]]
    ranked = sorted(table, key=lambda t: (-t["acc"], t["m"]))
    best = [t["m"] for t in ranked[:3] if t["m"] < 1.0][:3]
    if not best:
        print("\n=== DIAGNOSTICS: no non-flat candidate in the ladder; nothing to compare. ===")
        return
    print(f"\n=== DIAGNOSTICS at best candidates {[f'{b:.2f}' for b in best]} (vs flat m=1.0) ===")
    for m in best:
        preds = predcache[m]
        tot = collections.Counter()
        okf = collections.Counter()
        okm = collections.Counter()
        imp = collections.Counter()
        reg = collections.Counter()
        for rec, (cm, _bm), (cf, _bf) in zip(records, preds, flat):
            t = rec["truth"]
            tot[t] += 1
            if cf == t:
                okf[t] += 1
            if cm == t:
                okm[t] += 1
            if cf != t and cm == t:
                imp[(t, cf)] += 1
            if cf == t and cm != t:
                reg[(t, cm)] += 1
        net = sum(okm.values()) - sum(okf.values())
        print(f"\n----- m={m:.2f}  net correct delta vs flat = {net:+d} -----")
        for c in sorted(tot, key=lambda k: -tot[k]):
            d = okm[c] - okf[c]
            if d:
                print(f"    {c:22} {okf[c]:>4} -> {okm[c]:<4} /{tot[c]:<4} ({d:+d})")
        print("    TOP improvement piles (truth <- was):",
              [f"{n}x {t}<-{f}" for (t, f), n in imp.most_common(5)] or "none")
        print("    TOP regression piles  (truth -> now):",
              [f"{n}x {t}->{c}" for (t, c), n in reg.most_common(5)] or "none")
        with open(os.path.join(out_dir, f"per_category_delta_m{m:.2f}.csv"), "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["category", "N", "flat_correct", "m_correct", "delta"])
            for c in sorted(tot, key=lambda k: -tot[k]):
                w.writerow([c, tot[c], okf[c], okm[c], okm[c] - okf[c]])


# --------------------------------------------------------------------------- CLI
def _parse_ladder(text):
    out = []
    for tok in text.split(","):
        tok = tok.strip()
        if tok:
            out.append(float(tok))
    if not out:
        raise ValueError("empty ladder")
    return out


def _inside_review(path):
    return "_classification_review" in os.path.abspath(path).split(os.sep)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Offline proximity-decay multiplier sweep over a labelled corpus.")
    ap.add_argument("input", nargs="?", default=None,
                    help="labelled-corpus folder (else env BOQ_SWEEP_INPUT). Never defaulted.")
    ap.add_argument("--out", required=True, help="output folder (must already exist; not in _classification_review/).")
    ap.add_argument("--discipline", default="Electrical", help="ruleset discipline (default Electrical).")
    ap.add_argument("--ladder", default=None, help="comma-separated multipliers (default: the 20-value D2 ladder).")
    args = ap.parse_args(argv)

    inp = args.input or os.environ.get("BOQ_SWEEP_INPUT")
    if not inp:
        print("STOP: no input -- pass a folder arg or set BOQ_SWEEP_INPUT.", file=sys.stderr)
        return 2
    if not os.path.isdir(inp):
        print(f"STOP: input folder not found: {inp!r}", file=sys.stderr)
        return 2
    if not os.path.isdir(args.out):
        print(f"STOP: --out folder must already exist: {args.out!r}", file=sys.stderr)
        return 2
    if _inside_review(args.out):
        print("STOP: --out must NOT be inside _classification_review/ (untouchable).", file=sys.stderr)
        return 2
    try:
        ladder = _parse_ladder(args.ladder) if args.ladder else list(DEFAULT_LADDER)
    except ValueError as exc:
        print(f"STOP: bad --ladder ({exc}).", file=sys.stderr)
        return 2

    try:
        load_ruleset(args.discipline)
    except Exception as exc:
        print(f"STOP: discipline {args.discipline!r} has no ruleset ({exc}).", file=sys.stderr)
        return 2

    files = corpus_files(inp)
    if not files:
        print(f"STOP: no BOQ-*__*.xlsx|csv data files in {inp!r}.", file=sys.stderr)
        return 2
    print(f"corpus: {len(files)} data files in {inp}\ndiscipline: {args.discipline}\n"
          f"ladder: {','.join(format(m, 'g') for m in ladder)}\nout: {args.out}\n")

    faithfulness_report(files, args.discipline)

    records, has_ai = build_scored_feed(files)
    n = len(records)
    valid = {c["category_id"] for c in load_ruleset(args.discipline)["categories"]}
    oov = {r["truth"] for r in records} - valid
    print(f"=== SCORED SET ===\n  LINE ITEM rows with non-blank team_classification = {n}")
    print(f"  truth out-of-vocab values: {oov if oov else 'none'}")
    if not has_ai:
        print("  NOTE: corpus lacks ai_category/ai_confidence -- routing-impact columns skipped.")
    print()
    if n == 0:
        print("STOP: no scored rows (no LINE ITEM rows carry a team_classification).", file=sys.stderr)
        return 3

    table, predcache = sweep(records, args.discipline, ladder, has_ai, args.out)
    per_category_matrix(records, args.discipline, ladder, predcache, args.out)
    diagnostics(records, ladder, table, predcache, args.out)
    print(f"\nDONE. CSVs in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

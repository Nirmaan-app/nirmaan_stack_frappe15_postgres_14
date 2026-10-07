#!/usr/bin/env python3
"""SLICE 12d-2F (owner F4): a suggestion run's FULL cost from the capture log -- the batch calls AND the
second-opinion calls, which are metered SEPARATELY on every batch record (`usage` beside
`drops.second_opinion_usage`) and were being reported as "unmetered" because nobody summed the second map.

Usage (in the container, the log lives beside the bench's other boq_*.log files):
    env/bin/python apps/nirmaan_stack/scripts/_instruments/run_cost.py logs/boq_rate_extraction_capture.jsonl [YYYY-MM-DD]

Prints one row per (boq, sheet) seen on the given day (default: every day): batch calls, main input /
output tokens, second-opinion calls, second-opinion input / output tokens, and the totals.
READ-ONLY. No AI call, no DB.
"""
import collections
import json
import sys


def run_costs(records, day=None):
    """{(boq, sheet_name): {...}} over the BATCH records of `day` (a 'YYYY-MM-DD' prefix) or of every day.

    `records` is an iterable of parsed capture records. A record that is not a batch, or not on the day,
    contributes nothing; a batch record with no `usage` (a failed attempt) counts its second-opinion
    usage all the same, because those calls were made.
    """
    out = collections.defaultdict(lambda: {"batches": 0, "input": 0, "output": 0,
                                           "so_calls": 0, "so_input": 0, "so_output": 0,
                                           "first": None, "last": None})
    for rec in records:
        if rec.get("kind") != "batch":
            continue
        ts = str(rec.get("ts") or "")
        if day and not ts.startswith(day):
            continue
        r = out[(rec.get("boq"), rec.get("sheet_name"))]
        u = rec.get("usage") or {}
        so = (rec.get("drops") or {}).get("second_opinion_usage") or {}
        r["batches"] += 1
        r["input"] += int(u.get("input_tokens") or 0)
        r["output"] += int(u.get("output_tokens") or 0)
        r["so_calls"] += int(so.get("calls") or 0)
        r["so_input"] += int(so.get("input") or 0)
        r["so_output"] += int(so.get("output") or 0)
        r["first"] = ts if r["first"] is None or ts < r["first"] else r["first"]
        r["last"] = ts if r["last"] is None or ts > r["last"] else r["last"]
    return dict(out)


def _read(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    costs = run_costs(_read(argv[1]), argv[2] if len(argv) > 2 else None)
    hdr = ("boq", "sheet", "batches", "in", "out", "so_calls", "so_in", "so_out", "all_calls", "all_in", "all_out")
    print("| " + " | ".join(hdr) + " |")
    print("|" + "---|" * len(hdr))
    for (boq, sheet), r in sorted(costs.items(), key=lambda kv: (kv[1]["first"] or "")):
        print("| %s | %s | %d | %d | %d | %d | %d | %d | %d | %d | %d |" % (
            boq, sheet, r["batches"], r["input"], r["output"], r["so_calls"], r["so_input"], r["so_output"],
            r["batches"] + r["so_calls"], r["input"] + r["so_input"], r["output"] + r["so_output"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

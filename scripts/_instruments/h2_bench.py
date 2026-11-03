"""THE H2 BENCH - historical matching's standing check (DEV2-B3 S3; owner build requirement 2, "ok" 12:45: the bench
- 300 bench + 100 held-out + 260 traps + the known-same files - stays a runnable check; B0 G18 (a)).

WHAT IT RUNS: the APP's code end to end on the bench - the lanes (services/boq_rate_match/lanes.py) on the pool
(pool.py) built AS OF the bench date, the judge (judge.py: J10h's request, the judge model from the settings) and N1b
- then scores the result exactly as DEV2-S8's X1 did (scripts x_s8.py: score / overall / traps):
  * bench (300 targets) and held-out (100): top 5 / first = a known-same row (known_same_s6.json), or a copy of one
    (the same pool group), reachable under the bench's own eligibility (pool_s5 / pool_s0: own BoQ, kept, 2X), among
    the first 5 / first of the order (SAME > CLOSE > UNCLEAR > DIFFERENT, then the judge's order) after N1b;
    denominators 199 / 68; a target with no verdict leaves the denominator, as in S8, and is counted apart;
  * the first row's verdict by every chat-Claude verdict file (v6, then H2_S5 .. H2_S8_Unjudged_Verdicts; copies
    expanded; the newest file wins for a pair);
  * traps: size changed (mutation) - the original first and SAME (the failure); reworded (paraphrase) - the original
    first; S0 flipped / added - a known row called SAME.
WHAT IT WRITES (--out DIR): table.json (+ table.txt), orders.json (per target: list, raw and N1b order, the coloured
matches, no-verdict reason, spend), and the blind export unjudged_pairs_<tag>.json + unjudged_pairs_<tag>_key.json (X3
format, section a: every bench / held-out pair in a top 5 or called SAME with no verdict yet and not in a known-same
group). --archive DIR keeps every request and raw reply (block 54).

WHERE THE DATA LIVES: the site's private folder, `private/boq_rate_match/bench/` (client BoQ text never enters the
repo): manifest.json (as_of, seed, every file's sha256) and the files it names. The script refuses when a file is
missing or its sha256 differs. The bench pool is cached beside them (bench_pool_v<FORMAT>.pkl, pool.ensure_pool).
The CARD lane and the payload's cards come from the bench's Haiku cards (haiku_cards_all.jsonl) through a card source;
with --stored-cards (DEV2-B6, the app path) from the site's `BoQ Row Spec Card` rows instead (pool.StoredCards, as the
product's pool reads them), cached as bench_pool_stored_v<FORMAT>.pkl. A trap's own card stays the bench file's.

WHEN TO RUN IT: before any change of the judge model, the card model, the judge prompt or the lanes - and after, to
compare. It costs one judge call a target (660), at the settings' prices; --dry builds the requests only and prints
the PLAN line (calls, tokens, $), no call is made. Budget flags (--max-calls / --max-tokens / --max-usd) are the
caller's test budget: a call that would pass one is SKIPPED (named, counted in table.json budget_skipped) and the run
goes on (DEV2-B4); the product itself has no cost cap. DEV2-B6: a call in flight reserves chars / 2 + the MEASURED p90
reply (P90_REPLY_TOKENS), not the 32,000 reply ceiling; the caps stay hard on the REAL totals - once one is reached no
further call is sent (table.json budget_reached says so). --extra-verdicts adds later verdict files by path.

usage (in the bench container, from frappe-bench):
  env/bin/python -I apps/nirmaan_stack/scripts/_instruments/h2_bench.py --site <site> --out <dir> [--dry]
      [--archive <dir>] [--seed N] [--max-calls N --max-tokens N --max-usd X] [--selfcheck orders.json]
"""
import argparse
import collections
import hashlib
import json
import os
import random
import sys
import time

SETS = ("bench", "heldout", "mutation", "paraphrase", "s0")
RANK = {"SAME": 0, "CLOSE": 1, "UNCLEAR": 2, "DIFFERENT": 3}
VERDICT_FILES = ("H2_T3_Judge_Verdicts_v6_2026-11-01.json", "H2_S5_Unjudged_Verdicts_2026-11-01.json",
                 "H2_S6_Unjudged_Verdicts_2026-11-02.json", "H2_S7_Unjudged_Verdicts_2026-11-02.json",
                 "H2_S8_Unjudged_Verdicts_2026-11-02.json")      # oldest first: a later file wins for a pair
EXPORT_SEED_OFFSET = 1131                                      # the blind export's shuffle: manifest seed + this


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


class Bench:
    """The bench files, sha-checked against manifest.json."""

    def __init__(self, folder, extra_verdicts=()):
        self.folder = folder
        self.manifest = json.load(open(os.path.join(folder, "manifest.json"), encoding="utf-8"))
        bad = [n for n, s in self.manifest["files"].items()
               if not os.path.exists(os.path.join(folder, n)) or sha256(os.path.join(folder, n)) != s]
        if bad:
            raise SystemExit(f"bench files missing or changed (sha256): {bad}")
        j = lambda n: json.load(open(os.path.join(folder, n), encoding="utf-8"))  # noqa: E731
        self.testset = j("bench_testset.json")["targets"]
        self.key = j("bench_key.json")["targets"]
        self.held = {h["id"]: h for h in j("heldout_s5.json")["targets"]}
        self.tg = {t["id"]: t for t in j("w2_targets_s5.json")}
        self.s0 = {t["id"]: t for t in j("s0_targets.json")}
        self.s0r = {t["trap_id"]: t for t in j("s0_traps.json")["traps"]}
        self.traps = j("bench_traps.json")
        self.p5, self.p0 = j("pool_s5.json"), j("pool_s0.json")
        self.kept5, self.kept0 = set(self.p5["kept"]), set(self.p0["kept"])
        ksd = j("known_same_s6.json")
        self.ks = {**ksd["bench"]["targets"], **ksd["heldout"]["targets"]}
        self.vv = {}
        for n in VERDICT_FILES:
            if n not in self.manifest["files"]:
                continue
            v = j(n)
            if n.startswith("H2_T3"):
                self.vv.update(v)
                continue
            for u in v.values():
                for k in [u["candidate_key"]] + (u.get("copies") or []):
                    self.vv[f"{u['target_ref']}|{k}"] = u["consensus"]
        # DEV2-B4: later verdict files given by path (e.g. H2_B3_Unjudged_Verdicts from a scratch copy; the bench
        # folder's manifest does not list them), read after the manifest's, in the order given: a later file wins.
        self.extra_verdicts = []
        for path in extra_verdicts or ():
            v = json.load(open(path, encoding="utf-8"))
            for u in v.values():
                for k in [u["candidate_key"]] + (u.get("copies") or []):
                    self.vv[f"{u['target_ref']}|{k}"] = u["consensus"]
            self.extra_verdicts.append({"path": path, "sha256": sha256(path), "entries": len(v)})
        self.cards = os.path.join(folder, "haiku_cards_all.jsonl")
        self.as_of, self.seed = self.manifest["as_of"], int(self.manifest["seed"])

    def set_of(self, t):
        return ("bench" if t.startswith("T") else "heldout" if t.startswith("H") else "mutation" if t.startswith("MUT")
                else "paraphrase" if t.startswith("PAR") else "s0")

    def per_target(self, t):
        return (self.p0 if t in self.s0 else self.p5)["per_target"][t]


def card_source(path):
    from nirmaan_stack.services.boq_rate_match import pool as P

    class BenchCards(P.CardSource):
        """The bench's Haiku cards, keyed by row key (the doctype holds none until B6)."""

        def cards_for(self, rows):
            want = {k for k, _ in rows}
            out = {}
            for line in open(path, encoding="utf-8"):
                x = json.loads(line)
                if x["key"] in want and x.get("card"):
                    out[x["key"]] = x["card"]
            return out

    return BenchCards()


def bench_pool(bench, stored_cards=False):
    """The bench pool (cached beside the bench files). stored_cards (DEV2-B6): the cards of the site's spec-card rows
    (the product's reader), in a file of its own - the bench-file pool is never overwritten by it."""
    from nirmaan_stack.services.boq_rate_match import pool as P

    path = os.path.join(bench.folder, f"bench_pool_{'stored_' if stored_cards else ''}v{P.POOL_FORMAT}.pkl")
    src = P.StoredCards() if stored_cards else card_source(bench.cards)
    return P.ensure_pool(path=path, builder=lambda: P.build_pool(as_of=bench.as_of, card_source=src))


def targets(bench, pool):
    """Every bench target as lanes.candidates takes it: a pool row (bench, held-out) or a trap's own text."""
    from nirmaan_stack.services.boq_rate_match import lanes as L

    alls = {**bench.tg, **bench.s0}
    # a trap is not a pool row: its own Haiku card comes from the bench card file, keyed by its id (as DEV2-S8 sent it)
    tcards = card_source(bench.cards).cards_for([(tid, None) for tid, t in alls.items() if t["kind"] != "target"])
    out = []
    for tid, t in sorted(alls.items()):
        pt = bench.per_target(tid)
        if t["kind"] == "target":
            tt = L.target_from_row(pool, t["key"], id=tid, own_boq=pt["own_boq"])
        else:
            of = pool.rows[pool.byk[t["of"]]] if t["of"] in pool.byk else {}
            tt = {k: t.get(k) for k in ("key", "kind", "of", "fam", "project", "cat", "disc", "self", "parent", "upper",
                                        "desc", "unit", "payload")}
            tt.update(id=tid, own_boq=pt["own_boq"], v1=[], rules_key=None, has_readings=False,
                      card=tcards.get(tid), unit_raw=t.get("unit_raw", of.get("unit_raw")))
        tt["set"] = bench.set_of(tid)
        out.append(tt)
    return out


def _sibling(name):
    """A module beside this file, loaded by path (the bench runs with python -I: its folder is not on sys.path)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(f"_h2_{name}", os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_RC = _sibling("h2_recording_client")       # DEV2-B6: the test client (RecordingClient, the p90 reply reserve)
RecordingClient, P90_REPLY_TOKENS, reply_reserve = _RC.RecordingClient, _RC.P90_REPLY_TOKENS, _RC.reply_reserve


# ---- the scoring: DEV2-S8 x_s8.py, unchanged in substance (groups from the pool: the same partition, DEV2-B2) ----
class Scorer:
    def __init__(self, bench, pool):
        self.b, self.pool = bench, pool
        self.members = pool.index["members"]

    def group(self, k):
        i = self.pool.byk.get(k)
        return self.pool.rows[i]["group"] if i is not None else None

    def eligible(self, t, k):
        pt = self.b.per_target(t)
        tk = self.b.tg[t]["key"] if t in self.b.tg else t
        kept = self.b.kept0 if t in self.b.s0 else self.b.kept5
        return k != tk and (k in pt["extra"] or (k in kept and k.split("|")[0] != pt["own_boq"]))

    def reach(self, t):
        out = set()
        for k in self.b.ks.get(t, {}).get("rows", {}):
            g = self.group(k)
            if g is not None and any(self.eligible(t, x) for x in self.members[g]):
                out.add(k)
        return out

    def verdict_of(self, t, k):
        v = self.b.vv.get(f"{t}|{k}")
        if v:
            return v, False
        g = self.group(k)
        vs = [self.b.vv[f"{t}|{m}"] for m in (self.members[g] if g is not None else []) if f"{t}|{m}" in self.b.vv]
        if vs:
            return min(vs, key=lambda x: {"DIFFERENT": 0, "CLOSE": 1, "UNCLEAR": 2, "SAME": 3}[x]), True
        return None, False

    def score(self, order, ts):
        c = collections.Counter()
        for t in ts:
            ks = self.reach(t)
            if not ks or t not in order:
                c["no verdict (left out)"] += bool(ks) and t not in order
                continue
            o, gs = order[t], {self.group(k) for k in ks}
            hit = lambda k: k in ks or self.group(k) in gs  # noqa: E731
            c["denominator"] += 1
            c["top5"] += any(hit(k) for k in o[:5])
            c["first"] += bool(o) and hit(o[0])
            c["in_list"] += any(hit(k) for k in o)
        return dict(c)

    def overall(self, order, verdicts, ts):
        c = collections.Counter()
        for t in ts:
            if not order.get(t):
                continue
            f = order[t][0]
            vf, _via = self.verdict_of(t, f)
            c["targets"] += 1
            c[f"first {vf or 'no verdict'}"] += 1
            if verdicts[t][f]["v"] == "SAME":
                c["shown first as SAME"] += 1
                c["shown first as SAME, verdict CLOSE or DIFFERENT"] += vf in ("CLOSE", "DIFFERENT")
        return dict(c)

    def traps(self, verdicts, order):
        res = {}
        for kind in ("mutation", "paraphrase"):
            c = collections.Counter()
            for tr in self.b.traps:
                if tr["kind"] != kind:
                    continue
                tid, of = tr["trap_id"], tr["of"]
                c["traps"] += 1
                if tid not in order:
                    c["no verdict"] += 1
                    continue
                o, x = order[tid], verdicts[tid]
                c["original first"] += bool(o) and o[0] == of
                c["original in top 5"] += of in o[:5]
                if kind == "mutation":
                    c["original first and SAME (the failure)"] += bool(o) and o[0] == of and x[of]["v"] == "SAME"
            res[kind] = dict(c)
        c = collections.Counter()
        for tid, tr in self.b.s0r.items():
            c["traps"] += 1
            if tid not in order:
                c["no verdict"] += 1
                continue
            x = verdicts[tid]
            kn = set(self.b.ks[tr["target"]]["rows"]) | {tr["of"]}
            gs = {self.group(k) for k in kn}
            sm = [k for k in order[tid] if (k in kn or self.group(k) in gs) and x[k]["v"] == "SAME"]
            how = "added" if tr["how"] == "added" else "flipped"
            c[f"{how}"] += 1
            c[f"{how} called SAME"] += bool(sm)
        res["s0"] = dict(c)
        return res


def table(sc, orders, verdicts, bench):
    ts = {s: sorted(t for t in orders if bench.set_of(t) == s) for s in SETS}
    out = {}
    for view in ("n1b", "raw", "shown"):
        o = {t: x[view] for t, x in orders.items() if x["ok"]}
        out[view] = {"bench": sc.score(o, ts["bench"]), "heldout": sc.score(o, ts["heldout"])}
    o = {t: x["n1b"] for t, x in orders.items() if x["ok"]}
    out["bench_overall"] = sc.overall(o, verdicts, ts["bench"])
    out["heldout_overall"] = sc.overall(o, verdicts, ts["heldout"])
    out["traps"] = sc.traps(verdicts, o)
    b, h = out["n1b"]["bench"], out["n1b"]["heldout"]
    out["go"] = (b.get("top5", 0) >= 177 and b.get("first", 0) >= 156 and h.get("top5", 0) >= 63 and h.get("first", 0) >= 54)
    return out


def blind_export(sc, orders, verdicts, bench, pool, seed):
    """X3 section a: bench / held-out pairs the run puts in a top 5 or calls SAME, with no verdict in any chat-Claude
    file and not in a known-same group. Each side = the exact payload + card the judge read; opaque pair ids."""
    import nirmaan_stack.services.boq_rate_match.judge as J

    need = collections.defaultdict(set)
    for t, x in orders.items():
        if bench.set_of(t) not in ("bench", "heldout") or not x["ok"]:
            continue
        gs = {sc.group(k) for k in bench.ks.get(t, {}).get("rows", {})}
        for view in ("raw", "n1b"):
            ks = set(x[view][:5]) | {k for k, v in x["verdicts_" + view].items() if v["v"] == "SAME"}
            for k in ks:
                if sc.group(k) in gs or sc.verdict_of(t, k)[0]:
                    continue
                need[t].add(k)
    rng = random.Random(seed + EXPORT_SEED_OFFSET)
    tids = sorted(need)
    rng.shuffle(tids)
    serial, out_t, keymap = 13000, [], {}
    for t in tids:
        ks = sorted(need[t])
        rng.shuffle(ks)
        tside = orders[t]["target_side"]
        cl = []
        for k in ks:
            serial += 1
            pid = f"R{serial:05d}"
            r = pool.rows[pool.byk[k]]
            cl.append({"pair_id": pid, "category": r["cat"] or None, "unit": r["unit_raw"], "payload": r["payload"],
                       "card": orders[t]["candidate_sides"][k]})
            keymap[pid] = {"target_ref": t, "target_key": bench.tg[t]["key"], "candidate_key": k, "section": "a",
                           "copies": [m for m in sc.members[sc.group(k)] if m != k and sc.eligible(t, m)]}
        out_t.append({**tside, "id": t, "candidates": cl})
    return {"about": "H2 bench blind export (X3 format, section a), seed %d" % (seed + EXPORT_SEED_OFFSET),
            "prompt_version": J.prompt_version(), "targets": out_t}, keymap


def main():
    ap = argparse.ArgumentParser(description="The H2 bench (historical matching's standing check).")
    ap.add_argument("--site", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--data", help="bench folder (default: <site>/private/boq_rate_match/bench)")
    ap.add_argument("--dry", action="store_true", help="build the requests and print the PLAN line; no model call")
    ap.add_argument("--archive", help="keep every request and raw reply here (block 54)")
    ap.add_argument("--seed", type=int, help="the shuffle seed (default: the manifest's)")
    ap.add_argument("--selfcheck", help="score a saved orders file ({target: [keys]}) with this scorer and stop")
    ap.add_argument("--max-calls", type=int)
    ap.add_argument("--max-tokens", type=int)
    ap.add_argument("--max-usd", type=float)
    ap.add_argument("--limit", type=int, help="the first N targets only (a smoke run)")
    ap.add_argument("--tag", default="b4", help="the blind export's file tag (unjudged_pairs_<tag>.json)")
    ap.add_argument("--extra-verdicts", nargs="*", default=[], help="later verdict files (X3 answer format), read "
                    "after the manifest's in the order given; a later file wins for a pair")
    ap.add_argument("--stored-cards", action="store_true", help="the pool's and the payload's cards from the site's "
                    "BoQ Row Spec Card rows (the app path; DEV2-B6) instead of the bench's card file")
    a = ap.parse_args()
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "sites"))
    import frappe

    frappe.init(site=a.site)
    frappe.connect()
    frappe.set_user("Administrator")
    try:
        run(a, frappe)
    finally:
        frappe.db.rollback()
        frappe.destroy()


def run(a, frappe):
    from nirmaan_stack.api.boq.wizard.ai_settings import require_match_settings
    from nirmaan_stack.services.boq_rate_match import call_runner, judge as J, lanes as L

    os.makedirs(a.out, exist_ok=True)
    settings = require_match_settings("judge")     # an empty judge model or price refuses before anything is read
    bench = Bench(a.data or frappe.get_site_path("private", "boq_rate_match", "bench"), a.extra_verdicts)
    seed = a.seed if a.seed is not None else bench.seed
    secs = {}
    t0 = time.time()
    pool, rebuilt = bench_pool(bench, stored_cards=a.stored_cards)
    secs["pool"] = round(time.time() - t0, 1)
    sc = Scorer(bench, pool)
    if a.selfcheck:
        saved = json.load(open(a.selfcheck, encoding="utf-8"))
        ts = {s: sorted(t for t in saved if bench.set_of(t) == s) for s in SETS}
        res = {"bench": sc.score(saved, ts["bench"]), "heldout": sc.score(saved, ts["heldout"])}
        print("SELFCHECK", json.dumps(res))
        return
    tg = targets(bench, pool)[: a.limit] if a.limit else targets(bench, pool)
    t1 = time.time()
    lists = [(t, L.candidates(t, pool)["entries"]) for t in tg]
    secs["lanes"] = round(time.time() - t1, 1)
    t2 = time.time()
    items, info = J.prepare(lists, pool)
    secs["prepare"] = round(time.time() - t2, 1)
    reqs, calls = J.requests_for(items, seed, settings)
    est_in = sum(call_runner.estimate_tokens(c) for c in calls)
    est_out = int(len(calls) * 2734)               # DEV2-S8 J10h's measured mean output tokens a call
    usd = (est_in * settings["price_in"] + est_out * settings["price_out"]) / 1e6
    plan = {"calls": len(calls), "projected_tokens": est_in + est_out, "projected_input": est_in, "projected_output": est_out,
            "projected_usd": round(usd, 3), "refused_by_size_guard": sum(1 for c in calls if call_runner.estimate_tokens(c) > settings["max_request_tokens"]),
            "model": settings["model"], "reply_max_tokens": settings["reply_max_tokens"], "calls_at_once": settings["calls_at_once"],
            "seed": seed, "pool_rebuilt": rebuilt, "pool_as_of": pool.as_of, "stored_cards": bool(a.stored_cards), **info}
    caps = (a.max_calls, a.max_tokens, a.max_usd)
    plan["caps_ok"] = all(c is None or v <= c for c, v in zip(caps, (plan["calls"], plan["projected_tokens"], plan["projected_usd"])))
    json.dump(plan, open(os.path.join(a.out, "plan.json"), "w"), indent=1)
    print(f"PLAN calls={plan['calls']} projected_tokens={plan['projected_tokens']} projected_usd={plan['projected_usd']} caps_ok={plan['caps_ok']}", flush=True)
    json.dump({t["id"]: [e["key"] for e in ents] for t, ents in lists}, open(os.path.join(a.out, "lists.json"), "w"), indent=0)
    if a.dry:
        if a.archive:
            os.makedirs(a.archive, exist_ok=True)
            with open(os.path.join(a.archive, "dry_requests.jsonl"), "w", encoding="utf-8") as f:
                for r in reqs:
                    f.write(json.dumps({k: r[k] for k in ("id", "n", "candidates", "shuffle", "seed", "content")}, ensure_ascii=False) + "\n")
        return
    if not plan["caps_ok"]:
        raise SystemExit("the plan passes the given budget: nothing sent")
    client = RecordingClient(call_runner.make_client(), a.archive, *caps, settings["price_in"], settings["price_out"])
    t3 = time.time()
    res = J.judge_items(items, seed=seed, settings=settings, client=client)
    secs["judge"] = round(time.time() - t3, 1)
    by_id = {it["target"]["id"]: it for it in items}
    tcat = {t["id"]: t.get("cat") for t, _e in lists}
    cat_of = lambda td: tcat.get(td["id"]) or None  # noqa: E731
    orders, verdicts = {}, {}
    for tid, x in res["targets"].items():
        it = by_id[tid]
        ok = x["no_verdict"] is None
        orders[tid] = {"ok": ok, "no_verdict": x["no_verdict"], "list": [c["key"] for c in it["candidates"]],
                       "n1b": x["order"], "raw": x.get("raw_order", []), "shown": [m["key"] for m in x["matches"]],
                       "matches": x["matches"], "spend": x["spend"], "shuffle": x["shuffle"],
                       "verdicts_n1b": x["verdicts"] or {}, "verdicts_raw": x.get("raw_verdicts") or {},
                       "target_side": {"category": cat_of(it["target"]), "unit": it["target"]["unit"], "payload": it["target"]["payload"],
                                       "card": J.card_block(it["target"].get("card"), it["target"].get("after"))},
                       "candidate_sides": {c["key"]: J.card_block(c.get("card"), c.get("after")) for c in it["candidates"]}}
        if ok:
            verdicts[tid] = x["verdicts"]
    tab = table(sc, orders, verdicts, bench)
    tab.update(run=res["run"] | {"attempts": len(res["run"]["attempts"])}, secs=secs, seed=seed, settings=res["settings"],
               prompt_version=res["prompt_version"], no_verdict=sorted(t for t, x in orders.items() if not x["ok"]),
               budget_reached=client.reached,
               budget_skipped={"count": len(client.skipped),
                               "targets": [r["name"] for r in res["run"]["refused"] if r["reason"] == "caller_refused"]},
               extra_verdicts=bench.extra_verdicts)
    json.dump(tab, open(os.path.join(a.out, "table.json"), "w"), indent=1, default=str)
    json.dump(orders, open(os.path.join(a.out, "orders.json"), "w", encoding="utf-8"), ensure_ascii=False, default=str)
    exp, key = blind_export(sc, orders, verdicts, bench, pool, seed)
    json.dump(exp, open(os.path.join(a.out, f"unjudged_pairs_{a.tag}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(key, open(os.path.join(a.out, f"unjudged_pairs_{a.tag}_key.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    b, h = tab["n1b"]["bench"], tab["n1b"]["heldout"]
    print(f"TABLE bench top5 {b.get('top5')} / first {b.get('first')} of {b.get('denominator')}; held-out top5 "
          f"{h.get('top5')} / first {h.get('first')} of {h.get('denominator')}; {'GO' if tab['go'] else 'NO-GO'}; "
          f"spent ${res['run']['spent_usd']:.4f}; stop {res['run']['stop_reason']}; budget skipped "
          f"{len(client.skipped)}; export pairs {len(key)}", flush=True)


if __name__ == "__main__":
    sys.exit(main())

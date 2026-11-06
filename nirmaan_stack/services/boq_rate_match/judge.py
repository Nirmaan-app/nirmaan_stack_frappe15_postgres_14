# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE JUDGE (DEV2-B3 S2; owner R-H2AH: the Haiku judge - J8's prompt with its two changes, short reply, as DEV2-S8
J10h - plus N1b; N2 dropped). For one target row and its merged candidate list (lanes.candidates), one model call
says, per candidate, SAME / CLOSE / DIFFERENT / UNCLEAR and orders them; N1b then demotes a SAME whose size the
pricing rules say differs; the result is the ordered matches with their colour.

THE REQUEST IS DEV2-S8 J10h's, BYTE FOR BYTE (the bench measured it; DEV2-B3 parity on all 660 archived requests):
  * the prompt is `judge_prompt.txt` beside this file: J10h's prompt (DEV2-S6 j8_prompts.j8) at 20 candidates,
    copied verbatim; the count enters by its three phrases (COUNT_PHRASES);
  * content = prompt(n) + "\\n\\nTARGET:\\n" + the target's block + "\\n\\nCANDIDATES:\\n" + one block a line;
  * a block = json.dumps({"c": number (candidates only), "text": the row's payload (extraction._ai_item: the WHOLE
    Suggest payload, never cut - R-H2SPEC; the sheet name is its first ancestor), "unit", "card": the row's spec card
    (its "id" dropped) + "values after the pricing rules" (judge_n1b.after_values of the server pricing step's
    record)}, ensure_ascii=False); "card": null when the row has no card. Nothing else: no score, rate, lane or project;
  * the candidates are shuffled by random.Random(f"{seed}|j8|{target id}") - the caller passes the seed and it is
    recorded with every request;
  * ONE target per call; model, max_tokens (match_reply_max_tokens) and prices from the JUDGE settings; sent through
    the safe call runner (call_runner: calls at once, retry / stop rule, size guard; no cost cap).

THE REPLY: one JSON object {"verdicts": [{"c", "v"}], "order": [c, ...]}. It must give every candidate exactly one
verdict from the four, and "order" every number exactly once; anything else (a missing, extra, repeated or unknown
number, an unknown verdict, no object, a reply cut at max_tokens) is "no verdict" for that target - never guessed,
never re-asked here.

THE ORDER: SAME, CLOSE, UNCLEAR, DIFFERENT, each in the judge's own order (DEV2-S8 x_s8.order_of), after N1b.
THE COLOUR (owner G13 / build requirement 3, 16:13 "lets just color code them red, amber green"): SAME after N1b =
green, UNCLEAR = amber, CLOSE = red, DIFFERENT is not shown. Colour is never the only signal: each match carries its
verdict word and its N1b note.
"""
import json
import random
from pathlib import Path

from nirmaan_stack.services.boq_rate_match import call_runner
from nirmaan_stack.services.boq_rate_match import judge_n1b as N1B

PROMPT_PATH = Path(__file__).resolve().parent / "judge_prompt.txt"
PROMPT_COUNT = 20                                   # the candidate count judge_prompt.txt is written at
COUNT_PHRASES = ("and {n} candidate rows", "all {n} verdicts", "all {n} numbers")
VERDICTS = ("SAME", "CLOSE", "DIFFERENT", "UNCLEAR")
RANK = {"SAME": 0, "CLOSE": 1, "UNCLEAR": 2, "DIFFERENT": 3}
COLOUR = {"SAME": "green", "UNCLEAR": "amber", "CLOSE": "red"}     # DIFFERENT: not shown
SHUFFLE_TAG = "j8"                                  # part of J10h's shuffle string, kept so the order is J10h's


# ---- the request ----
def prompt_text() -> str:
    return PROMPT_PATH.read_bytes().decode("utf-8")


def prompt_version() -> str:
    import hashlib

    return hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest()


def judge_prompt(n: int) -> str:
    """The prompt for n candidates: the three count phrases of the stored prompt, each exactly once, set to n."""
    s = prompt_text()
    for ph in COUNT_PHRASES:
        a = ph.format(n=PROMPT_COUNT)
        if s.count(a) != 1:
            raise ValueError(f"judge_prompt.txt: the phrase {a!r} must occur exactly once")
        s = s.replace(a, ph.format(n=n))
    return s


def card_block(card, after):
    """The row's "card" as sent: the spec card without its "id", plus the values after the rules; None = no card."""
    if card is None:
        return None
    c = {k: v for k, v in card.items() if k != "id"}
    if after:
        c["values after the pricing rules"] = after
    return c


def row_block(num, row) -> str:
    """One row as the judge reads it. `row`: {payload, unit, card, after}."""
    d = {}
    if num is not None:
        d["c"] = num
    d["text"] = row["payload"]
    d["unit"] = row["unit"]
    d["card"] = card_block(row.get("card"), row.get("after"))
    return json.dumps(d, ensure_ascii=False)


def shuffle_key(seed, target_id) -> str:
    return f"{seed}|{SHUFFLE_TAG}|{target_id}"


def build_request(target, candidates, seed) -> dict:
    """{id, n, candidates (keys, in the order sent), shuffle, seed, content}. `target`: {id, payload, unit, card, after};
    `candidates`: [{key, payload, unit, card, after}] in the merged list's order."""
    by_key = {c["key"]: c for c in candidates}
    order = [c["key"] for c in candidates]
    sk = shuffle_key(seed, target["id"])
    random.Random(sk).shuffle(order)
    blocks = [row_block(i, by_key[k]) for i, k in enumerate(order, 1)]
    content = (judge_prompt(len(order)) + "\n\nTARGET:\n" + row_block(None, target) + "\n\nCANDIDATES:\n"
               + "\n".join(blocks))
    return {"id": target["id"], "n": len(order), "candidates": order, "shuffle": sk, "seed": seed, "content": content}


# ---- the reply ----
def parse_reply(text, n, stop_reason=None):
    """({number: verdict}, [numbers in the judge's order], None) or (None, None, the reason it is no verdict)."""
    if stop_reason == "max_tokens":
        return None, None, "the reply was cut at max_tokens"
    if stop_reason == "refusal":
        return None, None, "the model refused"
    s = (text or "").strip()
    a, b = s.find("{"), s.rfind("}")
    if a < 0 or b < a:
        return None, None, "no JSON object in the reply"
    try:
        obj = json.loads(s[a:b + 1])
    except ValueError as e:
        return None, None, f"the reply's JSON does not parse: {e}"
    if not isinstance(obj, dict) or not isinstance(obj.get("verdicts"), list) or not isinstance(obj.get("order"), list):
        return None, None, "the reply has no verdicts / order lists"
    want = list(range(1, n + 1))
    try:
        cs = [v["c"] for v in obj["verdicts"]]
        vs = {v["c"]: v["v"] for v in obj["verdicts"]}
    except (TypeError, KeyError):
        return None, None, "a verdict has no c or v"
    if not all(isinstance(c, int) and not isinstance(c, bool) for c in cs + obj["order"]):
        return None, None, "a candidate number is not a whole number"
    if sorted(cs) != want:
        return None, None, "the verdicts do not cover the candidates exactly once"
    if sorted(obj["order"]) != want:
        return None, None, "the order does not cover the candidates exactly once"
    bad = sorted({v for v in vs.values() if v not in VERDICTS}, key=str)
    if bad:
        return None, None, f"unknown verdicts {bad[:3]}"
    return vs, list(obj["order"]), None


def verdict_map(req, verdicts, order):
    """{candidate key: {"v", "pos"}} from a parsed reply (DEV2-S8 x_s8.jmap)."""
    pos = {c: i for i, c in enumerate(order)}
    return {req["candidates"][c - 1]: {"v": v, "pos": pos[c]} for c, v in verdicts.items()}


def apply_n1b(vmap, target, rows):
    """A SAME whose size the pricing rules say differs becomes CLOSE, with the reason. `rows`: {key: row data}."""
    out = {}
    for k, x in vmap.items():
        y = dict(x)
        if x["v"] == "SAME":
            c = rows[k]
            r = N1B.check(target.get("rec"), c.get("rec"), target["payload"], c["payload"], target.get("has_config"))
            if r:
                y["v"], y["n1b"] = "CLOSE", r
        out[k] = y
    return out


def ordered(vmap):
    """Every candidate, SAME > CLOSE > UNCLEAR > DIFFERENT, then the judge's own order (x_s8.order_of)."""
    return sorted(vmap, key=lambda k: (RANK[vmap[k]["v"]], vmap[k]["pos"]))


def matches(vmap):
    """What the panel shows: the ordered matches with verdict, colour and N1b note; DIFFERENT dropped."""
    return [{"key": k, "verdict": vmap[k]["v"], "colour": COLOUR[vmap[k]["v"]],
             "n1b": N1B.note(vmap[k].get("n1b"))} for k in ordered(vmap) if vmap[k]["v"] in COLOUR]


def judged(req, result, target, rows):
    """One target's outcome from its request and its CallResult (None = not sent)."""
    spend = {"tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "seconds": 0.0, "attempts": 0}
    if result is not None:
        spend = {"tokens_in": result.tokens_in, "tokens_out": result.tokens_out, "cost_usd": result.cost_usd,
                 "seconds": round(result.seconds, 3), "attempts": result.attempts}
    out = {"id": req["id"], "shuffle": req["shuffle"], "seed": req["seed"], "n": req["n"], "spend": spend,
           "no_verdict": None, "verdicts": None, "order": [], "matches": []}
    if result is None:
        out["no_verdict"] = "not sent"
        return out
    if not result.ok:
        out["no_verdict"] = f"the call failed: {result.error}"
        return out
    vs, order, err = parse_reply(result.text, req["n"], result.stop_reason)
    if err:
        out["no_verdict"] = err
        return out
    raw = verdict_map(req, vs, order)
    vm = apply_n1b(raw, target, rows)
    out.update(verdicts=vm, order=ordered(vm), matches=matches(vm), raw_verdicts=raw, raw_order=ordered(raw))
    return out


# ---- the rows' data, from the pool and the server pricing step ----
def pricing_recs(keys, pool, asset=None):
    """{key: the pricing step's record} for the pool rows among `keys` that have stored readings (an active run at
    the sheet's current version), priced in ONE pricing-step call over their sheets (pricing_step.sheet_inputs +
    price_rows, B2, unchanged). -> (recs, available, reason). Fails closed: unavailable -> no records, the reason."""
    from nirmaan_stack.services.boq_rate_match import pricing_step as PS

    want = {k for k in keys if k in pool.byk and pool.rows[pool.byk[k]].get("readings") is not None}
    sheets = sorted({(pool.rows[pool.byk[k]]["boq"], pool.rows[pool.byk[k]]["sheet"]) for k in want})
    page_rows, rows = {}, []
    for boq, sheet in sheets:
        p, rr = PS.sheet_inputs(boq, sheet)
        page_rows.update(p)
        rows += [r for r in rr if f"{r['boq']}|{r['sheet_name']}|{r['excel_row']}" in want]
    if not rows:
        return {}, True, None
    res = PS.price_rows(page_rows, rows, asset=asset)
    if not res["available"]:
        return {}, False, res["reason"]
    return {k: v["rec"] for k, v in res["rows"].items()}, True, None


def row_data(pool, key, recs):
    """One pool row as the judge reads it: payload, unit as written, card, the rules' record and its values."""
    r = pool.rows[pool.byk[key]]
    rec = recs.get(key)
    return {"key": key, "payload": r["payload"], "unit": r["unit_raw"], "card": pool.index["cards"].get(key),
            "rec": rec, "after": N1B.after_values(rec)}


def prepare(lists, pool, *, asset=None, configs=None):
    """Judge items from merged lists: `lists` = [(target, entries)], target as lanes.candidates takes it (a pool row's
    key, or a new row with its own payload / unit_raw / card / cat), entries = lanes.candidates(...)["entries"].
    -> (items, {"pricing_available", "pricing_reason"})."""
    from nirmaan_stack.services.boq_rate_match import pricing_step as PS

    if asset is None:
        asset = PS.load_asset()
    configs = configs if configs is not None else asset[0]["configs"]
    keys = {e["key"] for _t, ents in lists for e in ents} | {t.get("key") for t, _e in lists if t.get("key")}
    recs, ok, reason = pricing_recs(keys, pool, asset=asset)
    items = []
    for t, ents in lists:
        k = t.get("key")
        if k in pool.byk:
            td = row_data(pool, k, recs)
            cat = pool.rows[pool.byk[k]]["cat"]
        else:
            rec = t.get("rec")
            td = {"key": k, "payload": t["payload"], "unit": t.get("unit_raw", t.get("unit")), "card": t.get("card"),
                  "rec": rec, "after": N1B.after_values(rec)}
            cat = t.get("cat")
        if "card" in t:
            td["card"] = t["card"]
        td.update(id=t.get("id") or k, has_config=bool(cat) and cat in configs)
        items.append({"target": td, "candidates": [row_data(pool, e["key"], recs) for e in ents]})
    return items, {"pricing_available": ok, "pricing_reason": reason}


def judge_lists(lists, pool, *, seed, settings=None, client=None, on_request=None):
    """The app's entry point: refuse on an empty judge model or price BEFORE any read, then prepare and judge."""
    from nirmaan_stack.api.boq.wizard.ai_settings import require_match_settings

    s = settings or require_match_settings("judge")
    items, info = prepare(lists, pool)
    out = judge_items(items, seed=seed, settings=s, client=client, on_request=on_request)
    out.update(info)
    return out


# ---- the run ----
def requests_for(items, seed, settings):
    """CallRequests + their J10h requests, one per item ({target, candidates}); a target with no candidate is skipped."""
    reqs, calls = [], []
    for it in items:
        if not it["candidates"]:
            continue
        r = build_request(it["target"], it["candidates"], seed)
        reqs.append(r)
        calls.append(call_runner.CallRequest(name=r["id"], content=r["content"], model=settings["model"],
                                             max_tokens=settings["reply_max_tokens"], price_in=settings["price_in"],
                                             price_out=settings["price_out"], timeout=settings.get("request_timeout_seconds")))
    return reqs, calls


def judge_items(items, *, seed, settings=None, client=None, on_request=None):
    """Judge prepared items (prepare below): {target: row data + id, rec, has_config; candidates: [row data]}.
    Refuses (MatchSettingsIncomplete) BEFORE anything is built or sent when the judge model or a price is empty.
    -> {"targets": {id: outcome}, "run": {stop_reason, not_sent, refused, spent_usd, tokens_in, tokens_out, attempts},
    "settings": {model, reply_max_tokens, calls_at_once}, "seed", "prompt_version"}.
    `on_request(req, call)` is a seam for the payload archive (no model call happens there)."""
    from nirmaan_stack.api.boq.wizard.ai_settings import require_match_settings

    s = settings or require_match_settings("judge")
    reqs, calls = requests_for(items, seed, s)
    if on_request:
        for r, c in zip(reqs, calls):
            on_request(r, c)
    res = call_runner.run(calls, limits=call_runner.Limits.from_settings(s), client=client) if calls else call_runner.RunResult()
    by_id = {it["target"]["id"]: it for it in items}
    targets = {}
    for r in reqs:
        it = by_id[r["id"]]
        rows = {c["key"]: c for c in it["candidates"]}
        targets[r["id"]] = judged(r, res.results.get(r["id"]), it["target"], rows)
    for r in res.refused:
        if r["reason"] == call_runner.REFUSED_BY_CALLER:      # DEV2-B4: a caller's test budget skipped it
            targets[r["name"]]["no_verdict"] = f"not sent: {r['reason']} ({r.get('detail')})"
        else:
            targets[r["name"]]["no_verdict"] = f"not sent: {r['reason']} (estimate {r['estimate_tokens']} > {r['limit']})"
    return {"targets": targets, "seed": seed, "prompt_version": prompt_version(),
            "settings": {"model": s["model"], "reply_max_tokens": s["reply_max_tokens"], "calls_at_once": s["calls_at_once"]},
            "run": {"stop_reason": res.stop_reason, "stop_detail": res.stop_detail, "not_sent": res.not_sent,
                    "refused": res.refused, "spent_usd": res.spent_usd, "tokens_in": res.tokens_in,
                    "tokens_out": res.tokens_out, "attempts": res.attempts, "max_in_flight": res.max_in_flight}}

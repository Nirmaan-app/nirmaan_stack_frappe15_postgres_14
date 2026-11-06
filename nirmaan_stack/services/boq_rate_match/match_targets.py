# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""The match job's TARGETS and its FORKED LANES (DEV2-B4 S2).

    build_targets(boq, sheet_name, excel_rows, pool, asset)  -> (targets, info)
    lanes_forked(targets, pool, workers)                     -> [entries], one list per target, in target order

TARGETS are the Suggest run's own rows with their readings (owner SEQUENCE ruling: matching follows a COMPLETE Suggest
run and reads it): `pricing_step.sheet_inputs` (the sheet's ACTIVE run at the current committed version, as the pool
reads every other sheet) priced through the server pricing step, so each target carries
  * its payload = `extraction._ai_item` (the Suggest payload, exactly what the card and the judge read);
  * its readings view `v1` = `match_index.readings_view` over the step's record with the POOL's measured driving
    fields (pool.driving["lists"]), as pool.build_pool computes a pool row's v1;
  * its rules key (signature + values after the rules), its record (`rec`, for N1b's "values after the rules");
  * its card from the card store (cards.card_sheet runs first; reuse before any call).
A target that is itself a pool row (its sheet priced and settled) is `lanes.target_from_row` with those fresh values;
its own BoQ is never offered, its 2X extras are the pool's (Pool.extra_for).

FORKED LANES: the lanes are pure Python over the loaded pool (no database, no model). With `workers` > 1 the targets
are split round-robin over that many FORKED processes that share the one loaded pool copy-on-write (DEV2-B3 T4: 206
rows 57 s in one process, 33 s at 2, 24 s at 3); the lists come back in target order and are the same lists one
process makes (T1 pins it on fixtures).
"""
import json
import multiprocessing as mp

import frappe

from nirmaan_stack.services.boq_rate_match import lanes as L
from nirmaan_stack.services.boq_rate_match import match_text as MT
from nirmaan_stack.services.boq_rate_match.match_index import StoredCards, readings_view


def rules_key(v):
    """The RULES lane key of a priced row: signature + values after the rules (as pool.build_pool builds it)."""
    if v and v.get("priced") and v.get("signature"):
        return v["signature"] + "|" + json.dumps(v["values_after_rules"], sort_keys=True)
    return None


def _family_root(boq):
    from nirmaan_stack.services.boq_ai_guidance import revision_family
    try:
        return min(revision_family(boq) or [boq])
    except Exception:  # noqa: BLE001 -- the family only labels an entry (own_family); never fail a run on it
        return boq


def build_targets(boq, sheet_name, excel_rows, pool, asset, card_source=None):
    """The targets for `excel_rows` of the sheet's active Suggest run. -> (targets, info). A requested row the run
    does not hold is named in info["not_in_run"], never dropped silently."""
    from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
    from nirmaan_stack.services.boq_rate_master.extraction import _ai_item
    from nirmaan_stack.services.boq_rate_match import pricing_step as PS

    want = {int(r) for r in excel_rows}
    page, step_rows = PS.sheet_inputs(boq, sheet_name)
    rows = {int(x["excel_row"]): x for x in step_rows if int(x["excel_row"]) in want}
    step = PS.price_rows(page, list(rows.values()), asset=asset) if rows else {"available": True, "reason": None, "rows": {}}
    ctx = build_sheet_context(boq, sheet_name)
    by_row = {r["excel_row"]: r for r in ctx["rows"]}
    project = frappe.db.get_value("BOQs", boq, "project")
    fam = _family_root(boq)
    extra = pool.extra_for(boq)
    lists = (pool.driving or {}).get("lists") or {}
    keyed = []
    for er in sorted(rows):
        x = rows[er]
        key = f"{boq}|{sheet_name}|{er}"
        payload = _ai_item(by_row[er]) if er in by_row else None
        if payload is None:
            continue
        keyed.append((key, er, x, payload))
    cards = (card_source or StoredCards()).cards_for([(k, p) for k, _er, _x, p in keyed])
    targets = []
    for key, er, x, payload in keyed:
        got = (step.get("rows") or {}).get(key)
        v1 = readings_view(got["rec"].get("cat"), got["rec"], got["ac7"], x, lists) if got else []
        fresh = {"v1": v1, "rules_key": rules_key(got), "has_readings": True, "card": cards.get(key),
                 "rec": (got or {}).get("rec"), "excel_row": er, "extra": extra}
        if key in pool.byk:
            t = L.target_from_row(pool, key, own_boq=boq, **fresh)
        else:
            npay = MT.nz_payload(payload)
            s, p, u = MT.row_texts(npay)
            unit_raw = x.get("unit")
            t = {"key": key, "id": key, "kind": "target", "own_boq": boq, "payload": payload,
                 "cat": x.get("resolved_category") or x.get("category_id") or "", "disc": x.get("discipline"),
                 "project": project, "fam": fam, "self": s, "parent": p, "upper": u,
                 "desc": npay.get("description") or "", "unit": MT.unit_norm(unit_raw), "unit_raw": unit_raw, **fresh}
        targets.append(t)
    info = {"not_in_run": sorted(want - set(rows)), "pricing_available": step.get("available"),
            "pricing_reason": step.get("reason"), "with_card": sum(1 for t in targets if t.get("card"))}
    return targets, info


# ---- the forked lanes -------------------------------------------------------------------------------------------
_FORK = {}        # set in the parent just before the fork; the children read it (the pool is never pickled)


def _lane_chunk(idx):
    targets, pool = _FORK["targets"], _FORK["pool"]
    return [(i, L.candidates(targets[i], pool)["entries"]) for i in idx]


def lanes_forked(targets, pool, workers):
    """[entries] per target, in target order: one process when workers <= 1 (or one target), else `workers` forked
    processes over round-robin chunks, sharing the loaded pool."""
    if workers <= 1 or len(targets) < 2:
        return [L.candidates(t, pool)["entries"] for t in targets]
    n = min(int(workers), len(targets))
    chunks = [list(range(i, len(targets), n)) for i in range(n)]
    _FORK.update(targets=targets, pool=pool)
    try:
        with mp.get_context("fork").Pool(n) as wp:
            parts = wp.map(_lane_chunk, chunks)
    finally:
        _FORK.clear()
    out = [None] * len(targets)
    for part in parts:
        for i, entries in part:
            out[i] = entries
    return out

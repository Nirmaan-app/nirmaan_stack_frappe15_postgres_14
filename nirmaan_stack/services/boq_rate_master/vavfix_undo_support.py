"""VAV-FIX (HVAC v88: the Calculator starts blank (`boq_rows_only`), the no-unit bar's one sentence, rules page line 52 without its internal label;
no item changed): a LIVE category config as v87 held it, for a test that compares the live catalogue with an older file. Test support, no product
code. Driven by ONE file -- frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vavfixEdits.json, the mint's own edits -- the Python twin of
vavfixEdits.harness.ts (undoVavfix) in the frontend.

It undoes ONLY the declared edits and refuses anything else, so nothing can hide in it: a config that holds v88's edits is reversed edit by edit;
a config that holds v87's (or an older file's) shape comes back as it is; one that holds neither raises. VAV-2c3 FIX-2's `as_v86` applies this
first, so every older comparison reads v88 as v87, then v86, v85 ...
"""
import copy
import json
import os

_FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__",
                    "vavfixEdits.json")
_MISSING = object()


def edits():
    with open(_FIX, encoding="utf-8") as f:
        return json.load(f)


def _at(cfg, path):
    node = cfg
    for p in path:
        if isinstance(node, list):
            if not isinstance(p, int) or p >= len(node):
                return _MISSING
            node = node[p]
        elif isinstance(node, dict):
            if p not in node:
                return _MISSING
            node = node[p]
        else:
            return _MISSING
    return node


def _holds(cfg, path, value):
    have = _at(cfg, path)
    return have is _MISSING if value is None else (have is not _MISSING and have == value)


def as_v87(cfg, category_id=None):
    """`cfg` (one live category config) with v88's edits undone; v87's and older shapes come back as they are. Raises otherwise."""
    cid = category_id or cfg["category_id"]
    mine = [e for e in edits()["configs"] if e["c"] == cid]
    if not mine:
        return cfg
    if all(_holds(cfg, e["p"], e["from"]) for e in mine):
        return cfg
    # an older file than v87: none of v88's new keys or values, and not every v87 text either -- leave it to the next undo in the chain
    # (a key v88 REMOVES is absent from older files too, so it never counts as a sign of v88)
    if not any(_holds(cfg, e["p"], e["to"]) for e in mine if e["to"] is not None):
        return cfg
    for e in mine:
        if not _holds(cfg, e["p"], e["to"]):
            raise AssertionError("as_v87: %s %s holds neither v87's nor v88's value" % (cid, "/".join(str(x) for x in e["p"])))
    out = copy.deepcopy(cfg)
    for e in reversed(mine):
        parent = _at(out, e["p"][:-1])
        last = e["p"][-1]
        if e["from"] is None:
            del parent[last]
        else:
            parent[last] = copy.deepcopy(e["from"])
    return out

"""VAV-2c3 FIX (HVAC v85: VAV Box's three ruled defaults; no item changed): a LIVE category config as v84 held it, for a test
that compares the live catalogue with an older file. Test support, no product code. Driven by ONE file -- frontend/src/pages/boq-wizard/
rate-helper/__fixtures__/vav2c3bEdits.json, the mint's own edits -- the Python twin of vav2c3bEdits.harness.ts (undoVav2c3b) in the frontend.

It undoes ONLY the declared edits and refuses anything else, so nothing can hide in it: a config that holds v85's edits is reversed edit by edit
(a key v85 added is taken out again, a value it replaced comes back); a config that holds v84's (or an older file's) shape comes back as it is;
one that holds neither raises. VAV-2c3's `as_v83` applies this first, so every older comparison reads v85 as v84, then v83, v82 and v81.
"""
import copy
import json
import os

_FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__",
                    "vav2c3bEdits.json")
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


def as_v84(cfg, category_id=None):
    """`cfg` (one live category config) with v85's edits undone; v84's and older shapes come back as they are. Raises otherwise."""
    cid = category_id or cfg["category_id"]
    mine = [e for e in edits()["configs"] if e["c"] == cid]
    if not mine:
        return cfg
    if all(_holds(cfg, e["p"], e["from"]) for e in mine):
        return cfg
    # an older file than v84: none of v85's new keys, and not every v84 text either -- leave it to the next undo in the chain
    if not any(_holds(cfg, e["p"], e["to"]) for e in mine):
        return cfg
    for e in mine:
        if not _holds(cfg, e["p"], e["to"]):
            raise AssertionError("as_v84: %s %s holds neither v84's nor v85's value" % (cid, "/".join(str(x) for x in e["p"])))
    out = copy.deepcopy(cfg)
    for e in reversed(mine):
        parent = _at(out, e["p"][:-1])
        last = e["p"][-1]
        if e["from"] is None:
            del parent[last]
        else:
            parent[last] = copy.deepcopy(e["from"])
    return out

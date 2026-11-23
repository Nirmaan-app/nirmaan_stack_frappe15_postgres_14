"""VAV-2c2 (HVAC v83: texts, VAV Box's scope rule and two reading fields; no item changed): a LIVE category config as v82 held it, for a test
that compares the live catalogue with an older file. Test support, no product code. Driven by ONE file -- frontend/src/pages/boq-wizard/
rate-helper/__fixtures__/vav2c2Edits.json, the mint's own edits -- the Python twin of vav2c2Edits undo in the frontend harness.

It undoes ONLY the declared edits and refuses anything else, so nothing can hide in it: a config that holds v83's edits is reversed edit by edit
(a key v83 added is taken out again, a value it replaced comes back); a config that holds v82's (or an older file's) shape comes back as it is;
one that holds neither raises. VAV-2c1's `as_v81` applies this first, so every older comparison reads v83 as v81.
"""
import copy
import json
import os

_FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__",
                    "vav2c2Edits.json")
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


def as_v82(cfg, category_id=None):
    """`cfg` (one live category config) with v83's edits undone; v82's and older shapes come back as they are. Raises otherwise."""
    cid = category_id or cfg["category_id"]
    mine = [e for e in edits()["configs"] if e["c"] == cid]
    if not mine:
        return cfg
    if all(_holds(cfg, e["p"], e["from"]) for e in mine):
        return cfg
    # an older file than v82: none of v83's new keys, and not every v82 text either -- leave it to the next undo in the chain
    if not any(_holds(cfg, e["p"], e["to"]) for e in mine):
        return cfg
    for e in mine:
        if not _holds(cfg, e["p"], e["to"]):
            raise AssertionError("as_v82: %s %s holds neither v82's nor v83's value" % (cid, "/".join(str(x) for x in e["p"])))
    out = copy.deepcopy(cfg)
    for e in reversed(mine):
        parent = _at(out, e["p"][:-1])
        last = e["p"][-1]
        if e["from"] is None:
            del parent[last]
        else:
            parent[last] = copy.deepcopy(e["from"])
    return out

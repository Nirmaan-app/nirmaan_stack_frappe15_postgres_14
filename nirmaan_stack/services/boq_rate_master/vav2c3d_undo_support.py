"""VAV-2c3 FIX-2 (HVAC v87: A2 narrowed to round / oval / circular naming the box; no item changed): a LIVE category config as v86 held it,
for a test that compares the live catalogue with an older file. Test support, no product code. Driven by ONE file --
frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2c3dEdits.json, the mint's own edits -- the Python twin of vav2c3dEdits.harness.ts
(undoVav2c3d) in the frontend.

It undoes ONLY the declared edits and refuses anything else, so nothing can hide in it: a config that holds v87's edits is reversed edit by edit;
a config that holds v86's (or an older file's) shape comes back as it is; one that holds neither raises. VAV-2c3 FIX-2's `as_v85` applies this
first, so every older comparison reads v87 as v86, then v85, v84 ...
"""
import copy
import json
import os

from nirmaan_stack.services.boq_rate_master.vavfix_undo_support import as_v87 as _as_v87

_FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__",
                    "vav2c3dEdits.json")
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


def as_v86(cfg, category_id=None):
    """`cfg` (one live category config) with v87's edits undone; v86's and older shapes come back as they are. Raises otherwise."""
    cid = category_id or cfg["category_id"]
    cfg = _as_v87(cfg, cid)  # VAV-FIX (PIN VAVFIX F-B, accepted ANSWER 3): v88's edits undone first, so a v88 config reads as v86 (and on down)
    mine = [e for e in edits()["configs"] if e["c"] == cid]
    if not mine:
        return cfg
    if all(_holds(cfg, e["p"], e["from"]) for e in mine):
        return cfg
    # an older file than v85: none of v86's new keys or values, and not every v85 text either -- leave it to the next undo in the chain
    # (a key v86 REMOVES is absent from older files too, so it never counts as a sign of v86)
    if not any(_holds(cfg, e["p"], e["to"]) for e in mine if e["to"] is not None):
        return cfg
    for e in mine:
        if not _holds(cfg, e["p"], e["to"]):
            raise AssertionError("as_v86: %s %s holds neither v86's nor v87's value" % (cid, "/".join(str(x) for x in e["p"])))
    out = copy.deepcopy(cfg)
    for e in reversed(mine):
        parent = _at(out, e["p"][:-1])
        last = e["p"][-1]
        if e["from"] is None:
            del parent[last]
        else:
            parent[last] = copy.deepcopy(e["from"])
    return out

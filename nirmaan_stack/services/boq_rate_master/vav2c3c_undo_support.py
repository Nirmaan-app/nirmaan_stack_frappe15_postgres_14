"""VAV-2c3 FIX-2 (HVAC v86: VAV Box's notes, word checks, no-unit warning, heading note B, BACnet controller row, reading guidance; no item
changed): a LIVE category config as v85 held it, for a test that compares the live catalogue with an older file. Test support, no product code.
Driven by ONE file -- frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2c3cEdits.json, the mint's own edits -- the Python twin of
vav2c3cEdits.harness.ts (undoVav2c3c) in the frontend.

It undoes ONLY the declared edits and refuses anything else, so nothing can hide in it: a config that holds v86's edits is reversed edit by edit
(a key v86 added is taken out again, a key it removed comes back, a value it replaced comes back); a config that holds v85's (or an older file's)
shape comes back as it is; one that holds neither raises. VAV-2c3 FIX's `as_v84` applies this first, so every older comparison reads v86 as v85,
then v84, v83 ...
"""
import copy
import json
import os

from nirmaan_stack.services.boq_rate_master.vav2c3d_undo_support import as_v86 as _as_v86

_FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__",
                    "vav2c3cEdits.json")
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


def as_v85(cfg, category_id=None):
    """`cfg` (one live category config) with v86's edits undone; v85's and older shapes come back as they are. Raises otherwise."""
    cid = category_id or cfg["category_id"]
    cfg = _as_v86(cfg, cid)  # v87's edits undone first (ANSWER 22: the A2 correction is v87), so a v87 config reads as v85 (and on down)
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
            raise AssertionError("as_v85: %s %s holds neither v85's nor v86's value" % (cid, "/".join(str(x) for x in e["p"])))
    out = copy.deepcopy(cfg)
    for e in reversed(mine):
        parent = _at(out, e["p"][:-1])
        last = e["p"][-1]
        if e["from"] is None:
            del parent[last]
        else:
            parent[last] = copy.deepcopy(e["from"])
    return out

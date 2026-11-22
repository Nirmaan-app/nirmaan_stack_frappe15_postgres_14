"""VAV-2c1 (HVAC v82, text only): the LIVE catalogue as v81 held it, for a test that compares it with an older file. Test support, no product
code. Driven by ONE file -- frontend/src/pages/boq-wizard/rate-helper/__fixtures__/vav2c1Edits.json, the mint's own edits -- the Python twin of
vav2c1Edits.harness.ts `undoVav2c1`.

It undoes ONLY the declared edits and refuses anything else, so nothing can hide in it: a text of v82 that is in the config is reversed edit by
edit and must be exactly what the edits file says it became; a config that holds neither v81's nor v82's texts raises.
"""
import copy
import json
import os

_FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "frontend", "src", "pages", "boq-wizard", "rate-helper", "__fixtures__",
                    "vav2c1Edits.json")


def edits():
    with open(_FIX, encoding="utf-8") as f:
        return json.load(f)


def _at(cfg, path):
    node = cfg
    for p in path:
        if isinstance(node, list):
            node = node[p] if p < len(node) else None
        else:
            node = node.get(p) if isinstance(node, dict) else None
        if node is None:
            return None
    return node


def as_v81(cfg, category_id=None):
    """`cfg` (one live category config) with v82's text edits undone; v81's and older shapes come back as they are. Raises otherwise."""
    cid = category_id or cfg["category_id"]
    mine = [e for e in edits()["configs"] if e["c"] == cid]
    if not mine:
        return cfg
    if all(_at(cfg, e["p"]) == e["from"] for e in mine):
        return cfg
    for e in mine:
        if _at(cfg, e["p"]) != e["to"]:
            raise AssertionError("as_v81: %s %s holds neither v81's nor v82's text: %r" % (cid, "/".join(str(x) for x in e["p"]), _at(cfg, e["p"])))
    out = copy.deepcopy(cfg)
    for e in reversed(mine):
        parent = _at(out, e["p"][:-1])
        last = e["p"][-1]
        if e["from"] is None:
            del parent[last]
        else:
            parent[last] = copy.deepcopy(e["from"])
    return out


def item_as_v81(item_uid, item):
    """One live catalogue item ({unit, attributes ...}) with its v82 text edits undone; any other item unchanged. Raises if its text is neither."""
    ch = edits()["pricing_inputs"].get(item_uid)
    if not ch:
        return item
    out = copy.deepcopy(item)
    for leaf in ("unit", "remarks", "name"):
        if leaf not in ch:
            continue
        holder = out if leaf == "unit" else out["attributes"]
        if holder.get(leaf) not in ch[leaf]:
            raise AssertionError("item_as_v81: %s %s is %r" % (item_uid, leaf, holder.get(leaf)))
        holder[leaf] = ch[leaf][0]
    return out


def asset_as_v81(asset):
    """A whole HVAC asset file with v82's text edits undone (its configs by `as_v81`, its items by `item_as_v81`); any other file as it is."""
    out = dict(asset)
    if asset.get("discipline") != "HVAC":
        return out
    out["category_configs"] = [as_v81(c) for c in asset["category_configs"]]
    out["items"] = [item_as_v81(i["item_uid"], i) for i in asset["items"]]
    return out

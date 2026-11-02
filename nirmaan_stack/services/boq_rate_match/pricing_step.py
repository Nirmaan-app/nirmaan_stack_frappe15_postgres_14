# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""The SERVER PRICING STEP (DEV2-B2, owner G2 option A): the pricing rules' output for matching, computed on the
server by THE SAME functions, from THE SAME source files, the browser uses.

    price_rows(page_rows, rows)  -> {"available", "reason", "stamp", "rows": {key: {signature, values_after_rules, ...}}}
    ensure_current(stored, page_rows, rows)  -> the stored values, with every stale or missing one recomputed

HOW. `frontend/scripts/build_pricing_step.mjs` bundles the browser's pricing source (through
`rate-helper/serverPricingStep.ts`, which only re-exports the pricing functions plus one thin function) into ONE
git-ignored file, `_build/pricing_step.mjs`, on every deploy: the frontend `build` script runs it, and production's
`bench build` runs that. This module runs the bundle under `node` as a child process: rows in as JSON on stdin,
results out as JSON on stdout, a timeout, no shell. Nothing here prices: there is no pricing logic in Python.

THE SAME DATA. The rate asset the browser prices with is the LIVE catalogue, read through
`api/boq/rate_master.get_rate_master_items` (active items, `brand` projected into attributes) and
`get_rate_category_config` (the active config per category). `load_asset` calls those same two functions, and the
thin function merges the items in the page's own order (Electrical first, then RATE_MASTER_ITEM_DISCIPLINES).
The row data is what the page hands the panel: the committed page rows (`get_committed_rows`) and the active run's
stored readings (`sheet_inputs`, as the tracked replay's dump builds them).

THE STAMP. Each value carries `{"code": <code_hash of the bundle's inputs, from the build's stamp file>, "asset":
<latest rate-master snapshot + sha256 of the catalogue as served>}`. A stored value whose stamp differs from the
current one is STALE and is recomputed before use (`ensure_current`).

FAILS CLOSED. A missing bundle, a stamp file that cannot be read (or does not match the bundle's bytes), `node`
missing, a timeout or any error makes the step report `available: False` with the reason; the caller's RULES lane
then reports "unavailable" and every other lane runs on. Never a crash, never a guessed value.
"""
import hashlib
import json
import os
import shutil
import subprocess

import frappe

BUILD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_build")
BUNDLE = "pricing_step.mjs"
STAMP = "pricing_step.stamp.json"
DEFAULT_TIMEOUT_S = 600
# the page rows' fields the thin function reads (rowOwnNotes / rowHeadingNotes and the row lookup) -- the replay dump's set
PAGE_KEYS = ("row_index", "source_row_number", "effective_parent_index", "effective_classification", "description",
             "row_notes", "append_notes_raw")


class Unavailable(Exception):
    """The step cannot run; str(exc) is the reason reported to the caller."""


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_code_stamp(build_dir=None):
    """The build's stamp file, checked against the bundle's bytes. Raises Unavailable with the reason."""
    d = build_dir or BUILD_DIR
    bundle, stamp_path = os.path.join(d, BUNDLE), os.path.join(d, STAMP)
    if not os.path.isfile(bundle):
        raise Unavailable(f"pricing step bundle missing ({bundle}): the frontend build has not run")
    try:
        with open(stamp_path, encoding="utf-8") as f:
            stamp = json.load(f)
    except FileNotFoundError:
        raise Unavailable(f"pricing step stamp missing ({stamp_path})")
    except (OSError, ValueError) as e:
        raise Unavailable(f"pricing step stamp unreadable: {e}")
    if not isinstance(stamp, dict) or not stamp.get("code_hash") or not stamp.get("bundle_sha256"):
        raise Unavailable("pricing step stamp unreadable: no code_hash / bundle_sha256")
    with open(bundle, "rb") as f:
        actual = _sha256(f.read())
    if actual != stamp["bundle_sha256"]:
        raise Unavailable("pricing step stamp does not match the bundle (rebuild the frontend)")
    return stamp


def node_binary():
    node = shutil.which("node")
    if not node:
        raise Unavailable("node not found on the worker's PATH")
    return node


def load_asset():
    """The catalogue exactly as the browser reads it, and its version. -> ({"configs", "itemsByDiscipline"}, version)"""
    from nirmaan_stack.api.boq import rate_master

    disciplines = [r[0] for r in frappe.db.sql(
        'select distinct discipline from "tabBoQ Rate Master Item" where active=1 order by discipline')]
    items_by = {d: rate_master.get_rate_master_items(discipline=d)["items"] for d in disciplines}
    configs = {}
    for d, cid in frappe.db.sql(
            'select discipline, category_id from "tabBoQ Rate Category Config" where active=1 order by discipline, category_id'):
        cfg = rate_master.get_rate_category_config(discipline=d, category_id=cid).get("config")
        if cfg is not None:
            configs[cid] = cfg
    payload = {"configs": configs, "itemsByDiscipline": items_by}
    snap = frappe.db.sql('select name from "tabBoQ Rate Master Snapshot" order by creation desc limit 1')
    canon = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()
    version = f"{snap[0][0] if snap else 'no-snapshot'}:{_sha256(canon)[:16]}"
    return payload, version


def current_stamp(code_stamp, asset_version):
    return {"code": code_stamp["code_hash"], "asset": asset_version}


def is_stale(stored_stamp, stamp):
    """A value is current only when it was computed by this bundle's code on this asset version."""
    return not isinstance(stored_stamp, dict) or stored_stamp.get("code") != stamp.get("code") or stored_stamp.get("asset") != stamp.get("asset")


def _run_bundle(node, bundle, payload, timeout):
    try:
        p = subprocess.run([node, bundle], input=json.dumps(payload, default=str).encode(), capture_output=True,
                           timeout=timeout, check=False, shell=False)
    except subprocess.TimeoutExpired:
        raise Unavailable(f"pricing step timed out after {timeout} s")
    except OSError as e:
        raise Unavailable(f"pricing step could not start node: {e}")
    try:
        out = json.loads(p.stdout or b"null")
    except ValueError:
        out = None
    if p.returncode != 0 or not isinstance(out, dict) or not out.get("ok"):
        err = (out or {}).get("error") if isinstance(out, dict) else None
        tail = (p.stderr or b"").decode("utf-8", "replace")[-500:]
        raise Unavailable(f"pricing step failed (exit {p.returncode}): {err or tail or 'no output'}")
    return out["rows"]


def price_rows(page_rows, rows, asset=None, full=False, timeout=DEFAULT_TIMEOUT_S, build_dir=None):
    """Run the bundle on `rows` (the replay dump's row records) with `page_rows` ({"<boq>|<sheet>": [...]}).
    `asset` = (payload, version) from load_asset(), loaded when not given. Never raises."""
    try:
        code = read_code_stamp(build_dir)
        node = node_binary()
        payload, version = asset if asset is not None else load_asset()
        stamp = current_stamp(code, version)
        bundle = os.path.join(build_dir or BUILD_DIR, BUNDLE)
        got = _run_bundle(node, bundle, {**payload, "pageRows": page_rows, "rows": list(rows), "full": bool(full)}, timeout)
        out = {}
        for r in got:
            rec = r.get("rec") or {}
            out[r["key"]] = {"signature": rec.get("signature"), "values_after_rules": rec.get("values"),
                             "priced": bool(rec.get("priced")), "rec": rec, "ac7": r.get("ac7"), "stamp": stamp}
        return {"available": True, "reason": None, "stamp": stamp, "rows": out}
    except Unavailable as e:
        return {"available": False, "reason": str(e), "stamp": None, "rows": {}}
    except Exception as e:  # noqa: BLE001 -- fail closed on anything; the reason travels with the result
        return {"available": False, "reason": f"pricing step error: {type(e).__name__}: {e}", "stamp": None, "rows": {}}


def ensure_current(stored, page_rows, rows, asset=None, timeout=DEFAULT_TIMEOUT_S, build_dir=None):
    """`stored` = {key: value with its "stamp"}. Every row of `rows` whose stored value is missing or stale is
    recomputed; current values are kept as they are. -> {"available", "reason", "stamp", "rows", "recomputed": [keys]}"""
    try:
        code = read_code_stamp(build_dir)
        payload_version = asset if asset is not None else load_asset()
    except Unavailable as e:
        return {"available": False, "reason": str(e), "stamp": None, "rows": {}, "recomputed": []}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"pricing step error: {type(e).__name__}: {e}", "stamp": None, "rows": {}, "recomputed": []}
    stamp = current_stamp(code, payload_version[1])
    key_of = lambda r: f"{r['boq']}|{r['sheet_name']}|{r['excel_row']}"
    need = [r for r in rows if is_stale((stored.get(key_of(r)) or {}).get("stamp"), stamp)]
    keep = {key_of(r): stored[key_of(r)] for r in rows if key_of(r) in stored and not is_stale(stored[key_of(r)].get("stamp"), stamp)}
    if not need:
        return {"available": True, "reason": None, "stamp": stamp, "rows": keep, "recomputed": []}
    res = price_rows(page_rows, need, asset=payload_version, timeout=timeout, build_dir=build_dir)
    if not res["available"]:
        return {**res, "recomputed": []}
    return {"available": True, "reason": None, "stamp": stamp, "rows": {**keep, **res["rows"]}, "recomputed": sorted(res["rows"])}


def sheet_inputs(boq, sheet_name):
    """The page rows and the row records for one sheet's ACTIVE run at the current committed version, built as the
    tracked replay's dump (scripts/_instruments ac5_dump.py) builds them. -> (page_rows dict, rows list); ({}, []) when
    the sheet has no active run at its current version."""
    from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows
    from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
    from nirmaan_stack.services.boq_rate_master.extraction import _resolved_categories

    run = frappe.db.get_value("BoQ Rate Suggestion Run", {"boq": boq, "sheet_name": sheet_name, "active": 1},
                              ["committed_version", "run_id", "results"], as_dict=True)
    cur = frappe.db.get_value("BoQ Sheet", {"boq": boq, "sheet_name": sheet_name, "is_current": 1}, ["name", "commit_version"], as_dict=True)
    if not run or not cur or cur["commit_version"] != run["committed_version"]:
        return {}, []
    ctx = build_sheet_context(boq, sheet_name)
    page = [{k: pr.get(k) for k in PAGE_KEYS} for pr in (get_committed_rows(boq_name=boq, sheet_name=sheet_name).get("rows") or [])]
    by_row = {x["excel_row"]: x for x in ctx["rows"]}
    resolved = _resolved_categories(boq, sheet_name, cur["commit_version"])
    nodes = {nd["source_row_number"]: nd for nd in frappe.get_all(
        "BOQ Nodes", filters={"boq": boq, "sheet": cur["name"], "is_current": 1}, fields=["source_row_number", "unit"])}
    res = run["results"]
    res = json.loads(res) if isinstance(res, str) else res
    out = []
    for x in (res if isinstance(res, list) else (res or {}).get("rows", [])):
        er = x.get("excel_row")
        if er is None:
            continue
        cx = by_row.get(er)
        cat, disc = resolved.get(er, (x.get("category_id"), None))
        out.append({"boq": boq, "sheet_name": sheet_name, "excel_row": er, "run_id": run["run_id"],
                    "category_id": x.get("category_id"), "resolved_category": cat, "discipline": disc,
                    "description": x.get("description") or (cx or {}).get("description") or "",
                    "unit": (nodes.get(er) or {}).get("unit"),
                    "headings": [a.get("description") or "" for a in (cx or {}).get("ancestors") or []],
                    "attributes": x.get("attributes") or {}, "items": x.get("items")})
    return {f"{boq}|{sheet_name}": page}, out

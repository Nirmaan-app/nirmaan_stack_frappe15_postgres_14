# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-attribute extraction runner (RM-3 -> EA-2, N-category).

The SERVER half of the rate helper: assemble the population (rate-editable rows whose resolved
category is an ELIGIBLE rate-master config), then extract product attributes with an independent AI
call that MIRRORS ai_voter wholesale (same ai_settings resolution, same anthropic.Anthropic().
messages.create, same 20-row batching, same 3x retry/backoff, same fail-closed ai_status envelope).
A regex CORROBORATOR tags an attribute corroborated=True where a cheap local pattern AGREES with the
AI value -- DISPLAY METADATA ONLY, it never overrides the AI.

EA-2 (N-category): the run is NO LONGER hardcoded to wiring_cabling. The population spans EVERY
category on the sheet whose active config has BOTH non-empty pipelines AND non-empty attribute
definitions (an empty-pipelines DATA-ONLY config such as lighting_mgmt_system is excluded
automatically -- no special case). Batches are SINGLE-CATEGORY: each batch carries ITS category's
attribute definitions + prompt, 20 rows within a category; progress counts rows across all
categories. Each result row carries its category_id.

MODE SWITCH per category (config.matching_mode):
  - "item_identity": inject the IDENTITY prompt asset; the identity attribute (config.
    identity_attribute_id) is flagged {"identity": true} and its allowed values ARE the category's
    live item catalog (the distinct identity-attr values across that category's active master items
    -- read live, NEVER hardcoded). _coerce_value then enforces catalog membership exactly like any
    other choice vocabulary (a value not in the catalog coerces to null).
  - else: the existing attribute prompt asset, unchanged.

SPLIT (owner ruling): this server side extracts ATTRIBUTES only. VALUES are always (re)computed
client-side by the RM-2 interpreter from the CURRENT master/config -- so a rate/param change flows in
live without re-running the AI. Nothing here imports the interpreter or computes a rate.

FAIL CLOSED: settings disabled / no key -> NO Anthropic client, NO call, every attribute null,
ai_status 'disabled' | 'no_key'. There is NO fallback extraction -- an off toggle is an honest
failure, exactly like the classifier.
"""

import json
import os
import re
import time
from collections import OrderedDict

import frappe

from nirmaan_stack.services.boq_category import persist
from nirmaan_stack.services.boq_category.ai_voter import _extract_json_array
from nirmaan_stack.services.boq_category.context_builder import build_sheet_context

# Backward-compat default for get_extraction_attribute_defs() (the RM-3 no-arg call): the wiring
# category. EA-2 no longer uses these as the run scope -- the scope is derived per run.
CATEGORY_ID = "wiring_cabling"
DISCIPLINE = "Electrical"

_BATCH = 20
_AI_MAX_TOKENS = 8000
_AI_TIMEOUT = 300
_RETRIES = 3
_DEFAULT_MODEL = "claude-opus-4-8"

_ROW_CATEGORY = "BoQ Row Category"
_BOQ_NODES = "BOQ Nodes"
_BOQ_SHEET = "BoQ Sheet"
_CONFIG_DOCTYPE = "BoQ Rate Category Config"
_MASTER_ITEM = "BoQ Rate Master Item"

_PROMPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "boq_category", "prompts")
_ATTR_PROMPT_PATH = os.path.join(_PROMPT_DIR, "boq_rate_attr_extraction_prompt.md")
_IDENTITY_PROMPT_PATH = os.path.join(_PROMPT_DIR, "boq_rate_item_identity_prompt.md")


def _read_prompt(path):
    with open(os.path.abspath(path), encoding="utf-8") as fh:
        return fh.read()


# ── config eligibility / kinds / catalog ────────────────────────────────────────────
def _config_kinds(cfg):
    """The master-item kinds this config prices: config.item_kinds if declared, else derived from
    each pipeline's match_master_row params.kind (in declaration order, de-duplicated)."""
    kinds = list(cfg.get("item_kinds") or [])
    if kinds:
        return kinds
    out = []
    for p in (cfg.get("pipelines") or {}).values():
        for s in p.get("steps") or []:
            if s.get("step") == "match_master_row":
                k = (s.get("params") or {}).get("kind")
                if k and k not in out:
                    out.append(k)
    return out


def config_is_eligible(cfg):
    """A config participates in extraction iff it has BOTH non-empty pipelines AND non-empty
    attribute_definitions. Empty-pipelines DATA-ONLY configs (e.g. lighting_mgmt_system) are
    excluded automatically -- NO special case."""
    return bool(cfg.get("pipelines")) and bool(cfg.get("attribute_definitions"))


def _load_active_configs(disciplines=None):
    """{(discipline, category_id): config_dict} for active configs, optionally scoped to a set of
    disciplines (the disciplines actually present in the sheet's resolved rows)."""
    filters = {"active": 1}
    if disciplines:
        filters["discipline"] = ["in", sorted(disciplines)]
    rows = frappe.get_all(
        _CONFIG_DOCTYPE, filters=filters, fields=["discipline", "category_id", "config"]
    )
    out = {}
    for r in rows:
        cfg = r["config"] if isinstance(r["config"], dict) else json.loads(r["config"] or "{}")
        out[(r["discipline"], r["category_id"])] = cfg
    return out


def catalog_values(discipline, cfg):
    """The identity attribute's CATALOG: the distinct identity-attr values across this category's
    active master items (kinds from the config). Empty when the config declares no identity
    attribute. Read LIVE from the master -- never hardcoded; a rate-item added/removed flows in."""
    attr = cfg.get("identity_attribute_id")
    if not attr:
        return []
    kinds = _config_kinds(cfg)
    if not kinds:
        return []
    rows = frappe.get_all(
        _MASTER_ITEM,
        filters={"discipline": discipline, "kind": ["in", kinds], "active": 1},
        fields=["attributes"],
    )
    out = []
    seen = set()
    for r in rows:
        a = r["attributes"] if isinstance(r["attributes"], dict) else json.loads(r["attributes"] or "{}")
        v = a.get(attr)
        if isinstance(v, str):
            v = v.strip()
        if v not in (None, "") and v not in seen:
            seen.add(v)
            out.append(v)
    return out


# ── attribute-definition injection ──────────────────────────────────────────────────
def build_attribute_defs(cfg, catalog=None):
    """The attribute definitions injected into the AI prompt for one config. Selectable defs only
    (exclude selector:false, e.g. brand). When the config is item-identity, the identity attribute
    carries {"identity": true} and its `values` = the live catalog (overriding any stored values);
    all other choice defs keep their stored `values`."""
    identity = cfg.get("identity_attribute_id") if cfg.get("matching_mode") == "item_identity" else None
    out = []
    for d in cfg.get("attribute_definitions") or []:
        if d.get("selector") is False:
            continue
        entry = {"id": d["id"], "label": d.get("label") or d["id"], "type": d.get("type") or "choice"}
        if identity and d["id"] == identity:
            entry["identity"] = True
            entry["values"] = list(catalog or [])
        elif d.get("values"):
            entry["values"] = d["values"]
        out.append(entry)
    return out


def get_extraction_attribute_defs(config=None, catalog=None):
    """The attribute definitions the AI extracts. Backward-compatible: with NO config it returns the
    wiring_cabling config's selectable defs (the RM-3 shape). With a config it returns that config's
    injected defs (identity-flagged + catalog values when the config is item-identity)."""
    if config is None:
        rows = frappe.get_all(
            _CONFIG_DOCTYPE,
            filters={"discipline": DISCIPLINE, "category_id": CATEGORY_ID, "active": 1},
            fields=["config"],
            limit=1,
        )
        if not rows:
            return []
        config = rows[0]["config"]
        config = config if isinstance(config, dict) else json.loads(config or "{}")
    return build_attribute_defs(config, catalog)


def select_prompt_text(cfg):
    """The prompt asset for one config: the item-identity prompt when matching_mode == 'item_identity',
    else the attribute-extraction prompt (unchanged)."""
    path = _IDENTITY_PROMPT_PATH if cfg.get("matching_mode") == "item_identity" else _ATTR_PROMPT_PATH
    return _read_prompt(path)


# ── population assembly ─────────────────────────────────────────────────────────────
def _resolved_categories(boq, sheet_name, committed_version):
    """{excel_row: (effective_category_id, resolved_discipline)} via persist.resolve_row_ladder (the
    SAME ladder get_sheet_categories_resolved / blank_category_eligible_rows use). A blank effective
    category is kept as ('', discipline) and filtered out downstream."""
    cat_rows = frappe.get_all(
        _ROW_CATEGORY,
        filters={
            "boq": boq, "sheet_name": sheet_name,
            "committed_version": committed_version, "is_current": 1,
        },
        fields=["excel_row", "discipline", "routing", "human_category_id",
                "human_verdict_at", "ai_confidence", "final_category_id"],
    )
    votes_by_row = {}
    for r in cat_rows:
        votes_by_row.setdefault(r["excel_row"], {})[r["discipline"]] = r
    out = {}
    for er, votes in votes_by_row.items():
        res = persist.resolve_row_ladder(votes)
        out[er] = ((res[0] or "").strip(), res[2])
    return out


def _rate_editable_excel_rows(boq, sheet_name, committed_version):
    """The FULL rate-editable excel_row set (Line Item always; qty-bearing Preamble) -- the same
    predicate blank_category_eligible_rows(population='rate_editable') uses, via the shared
    persist._qty_bearing_node_names. Returns a set of source_row_number."""
    sheet_doc = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq, "sheet_name": sheet_name, "commit_version": committed_version, "is_current": 1},
        "name",
    )
    if not sheet_doc:
        return set()
    nodes = frappe.get_all(
        _BOQ_NODES,
        filters={"boq": boq, "sheet": sheet_doc, "is_current": 1},
        fields=["name", "source_row_number", "node_type", "qty"],
    )
    qty_bearing = persist._qty_bearing_node_names(nodes)
    out = set()
    for n in nodes:
        nt = (n.get("node_type") or "").strip()
        if nt == "Line Item" or (nt == "Preamble" and n["name"] in qty_bearing):
            out.add(n["source_row_number"])
    return out


def assemble_population(boq, sheet_name):
    """(committed_version, rows) -- rate-editable rows whose RESOLVED category is an ELIGIBLE config
    (non-empty pipelines AND definitions), ACROSS ALL categories on the sheet (EA-2). Each row keeps
    its excel_row, description, anc_headers, notes AND gains `category_id` + `discipline`.

    Rows resolved to a blank category, or to a category with no eligible config (e.g. an empty-
    pipelines LMS config, or a category with no rate-master config at all), are excluded.
    """
    ctx = build_sheet_context(boq, sheet_name)
    cv = ctx["committed_version"]
    if cv is None:
        return None, []
    resolved = _resolved_categories(boq, sheet_name, cv)
    rate_editable = _rate_editable_excel_rows(boq, sheet_name, cv)
    disciplines = {disc for (_cat, disc) in resolved.values() if disc}
    eligible = {
        key: cfg for key, cfg in _load_active_configs(disciplines).items() if config_is_eligible(cfg)
    }
    rows = []
    for r in ctx["rows"]:
        er = r["excel_row"]
        if er not in rate_editable:
            continue
        cat, disc = resolved.get(er, ("", None))
        if not cat or (disc, cat) not in eligible:
            continue
        rr = dict(r)
        rr["category_id"] = cat
        rr["discipline"] = disc
        rows.append(rr)
    return cv, rows


# ── AI extraction (mirrors ai_voter) ────────────────────────────────────────────────
def _ai_item(row):
    """One extraction payload item: {id, description, ancestor_chain, notes}. ancestor_chain =
    the section headers above the row, outermost first (anc_headers)."""
    return {
        "id": row["excel_row"],
        "description": row.get("description") or "",
        "ancestor_chain": row.get("anc_headers") or [],
        "notes": row.get("notes") or "",
    }


def _coerce_value(defn, raw):
    """Coerce/validate one extracted value against its definition. choice -> must be an allowed
    value (else None; for an identity attribute the allowed values ARE the catalog); number -> a
    float/int (else None); null stays None."""
    if raw is None:
        return None
    if defn["type"] == "number":
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return None
        return int(v) if v == int(v) else v
    # choice (incl. the identity catalog)
    allowed = defn.get("values")
    sval = str(raw)
    if allowed and sval not in allowed:
        return None
    return sval


def _extract_batch(client, model, prompt_text, attr_defs, rows_batch):
    """One extraction batch call with retry/backoff. Returns {excel_row: {attr_id: {value,
    confidence}}} for the batch's OWN rows only. Ports ai_voter._ai_batch mechanics (<=20 rows, 3
    attempts, sleep 2*attempt)."""
    payload_items = [_ai_item(r) for r in rows_batch]
    content = (
        prompt_text
        + "\n\nATTRIBUTE_DEFINITIONS:\n"
        + json.dumps(attr_defs, ensure_ascii=False)
        + "\n\nROWS:\n"
        + json.dumps(payload_items, ensure_ascii=False)
    )
    batch_ids = {r["excel_row"] for r in rows_batch}
    defs_by_id = {d["id"]: d for d in attr_defs}
    last = None
    for attempt in range(1, _RETRIES + 1):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=_AI_MAX_TOKENS,
                messages=[{"role": "user", "content": content}],
                timeout=_AI_TIMEOUT,
            )
            text = "".join(getattr(b, "text", "") for b in resp.content)
            out = {}
            for el in _extract_json_array(text):
                rid = int(el["id"])
                if rid not in batch_ids:
                    continue  # ignore any id the model echoed that is not in THIS batch
                attrs = el.get("attributes") or {}
                row_out = {}
                for aid, defn in defs_by_id.items():
                    cell = attrs.get(aid) or {}
                    value = _coerce_value(defn, cell.get("value"))
                    try:
                        conf = float(cell.get("confidence"))
                    except (TypeError, ValueError):
                        conf = 0.0
                    row_out[aid] = {"value": value, "confidence": max(0.0, min(1.0, conf))}
                out[rid] = row_out
            return out
        except Exception as exc:
            last = exc
            time.sleep(2 * attempt)
    raise RuntimeError(f"AI extraction batch failed after {_RETRIES} attempts: {last!r}")


# ── regex corroborator (display-only) ──────────────────────────────────────────────
_MATERIAL_RE = [
    (re.compile(r"\b(COPPER|CU)\b", re.I), "COPPER"),
    (re.compile(r"\b(ALUMINI?UM|AL)\b", re.I), "ALUMINIUM"),
]
_INSULATION_RE = [
    (re.compile(r"\bUN[\s-]?ARMOU?RED\b", re.I), "UNARMOURED"),
    (re.compile(r"\bARMOU?RED\b", re.I), "ARMOURED"),
]
# "3C x 2.5", "3Cx2.5", "3 core 2.5 sqmm", "2 core 4 sq mm", "4c x 16 sqmm"
_CORE_SIZE_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:c|core|cores)\b\s*(?:x|X|\*)?\s*(\d+(?:\.\d+)?)?\s*(?:sq\.?\s*mm|sqmm|mm)?",
    re.I,
)


def _regex_attributes(text):
    """Cheap local corroboration. Returns {attr_id: value} for whatever it can read from `text`
    (description + ancestor headers). Material/insulation stop at the first match; core/thickness
    from the first core-x-size pattern. Missing keys => no corroboration for that attribute. It only
    knows the wiring dimensions -- a non-wiring category simply gets no corroboration (all False)."""
    out = {}
    for rx, val in _INSULATION_RE:
        if rx.search(text):
            out["insulation"] = val
            break
    for rx, val in _MATERIAL_RE:
        if rx.search(text):
            out["material"] = val
            break
    m = _CORE_SIZE_RE.search(text)
    if m:
        try:
            core = float(m.group(1))
            out["core"] = int(core) if core == int(core) else core
        except (TypeError, ValueError):
            pass
        if m.group(2):
            try:
                th = float(m.group(2))
                out["thickness_sqmm"] = int(th) if th == int(th) else th
            except (TypeError, ValueError):
                pass
    return out


def _corroborate(row, row_attrs):
    """Tag each attribute corroborated=True where the regex reading AGREES with the AI value.
    DISPLAY-ONLY -- never changes the AI value. Mutates row_attrs in place (adds 'corroborated')."""
    text = " ".join(
        [row.get("description") or ""] + list(row.get("anc_headers") or []) + [row.get("notes") or ""]
    )
    regex = _regex_attributes(text)
    for aid, cell in row_attrs.items():
        rx_val = regex.get(aid)
        cell["corroborated"] = bool(
            rx_val is not None and cell.get("value") is not None and str(rx_val) == str(cell["value"])
        )
    return row_attrs


# ── the runner ──────────────────────────────────────────────────────────────────────
def run_extraction(boq, sheet_name, client=None, progress_cb=None):
    """Assemble the population and extract attributes ACROSS ALL eligible categories (EA-2). Returns
    {committed_version, ai_status, model, results} where results =
    [{excel_row, description, category_id, attributes:{id:{value, confidence, corroborated}}}].

    Batches are SINGLE-CATEGORY (each carries its category's defs + prompt; item-identity categories
    inject the identity prompt + the live catalog). Progress counts rows across all categories.

    Fails CLOSED (disabled / no key) -> results with all-null attributes + ai_status set; NO call.
    client is injectable for tests (a mock Anthropic client); when None and enabled, a real
    anthropic.Anthropic is built from the encrypted key.
    """
    from nirmaan_stack.api.boq.wizard.ai_settings import (
        get_boq_ai_api_key,
        get_boq_ai_settings,
    )

    cv, rows = assemble_population(boq, sheet_name)
    settings = get_boq_ai_settings()
    model = settings.get("model") or _DEFAULT_MODEL

    def _envelope(ai_status, results):
        return {
            "committed_version": cv,
            "ai_status": ai_status,
            "model": model,
            "results": results,
        }

    if cv is None or not rows:
        # Nothing to extract (uncommitted or no eligible rate-editable rows). Honest empty run;
        # ai_status reflects the toggle so the UI can still surface "AI was off".
        status = "ran" if settings.get("enabled") else "disabled"
        return _envelope(status, [])

    # Group rows by (discipline, category_id), preserving sheet order; build each group's context.
    groups = OrderedDict()
    for r in rows:
        groups.setdefault((r["discipline"], r["category_id"]), []).append(r)
    configs = _load_active_configs({disc for (disc, _cat) in groups})
    group_ctx = {}
    for (disc, cat), _grp in groups.items():
        cfg = configs.get((disc, cat)) or {}
        catalog = catalog_values(disc, cfg) if cfg.get("matching_mode") == "item_identity" else None
        group_ctx[(disc, cat)] = {"defs": build_attribute_defs(cfg, catalog), "prompt": select_prompt_text(cfg)}

    def _defs_for(r):
        return group_ctx[(r["discipline"], r["category_id"])]["defs"]

    def _blank_row(r):
        return {
            "excel_row": r["excel_row"],
            "description": r.get("description") or "",
            "category_id": r["category_id"],
            "attributes": {d["id"]: {"value": None, "confidence": 0.0, "corroborated": False} for d in _defs_for(r)},
        }

    # Fail closed.
    if not settings.get("enabled"):
        return _envelope("disabled", [_blank_row(r) for r in rows])
    if client is None:
        api_key = get_boq_ai_api_key()
        if not api_key:
            return _envelope("no_key", [_blank_row(r) for r in rows])
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

    total = len(rows)
    done = 0
    ai_out = {}
    for (disc, cat), grp_rows in groups.items():
        gc = group_ctx[(disc, cat)]
        for b in range(0, len(grp_rows), _BATCH):
            batch = grp_rows[b : b + _BATCH]
            ai_out.update(_extract_batch(client, model, gc["prompt"], gc["defs"], batch))
            done += len(batch)
            if progress_cb:
                progress_cb(min(done, total), total)

    results = []
    for r in rows:
        row_attrs = ai_out.get(r["excel_row"])
        if row_attrs is None:
            row_attrs = {d["id"]: {"value": None, "confidence": 0.0} for d in _defs_for(r)}
        _corroborate(r, row_attrs)
        results.append({
            "excel_row": r["excel_row"],
            "description": r.get("description") or "",
            "category_id": r["category_id"],
            "attributes": row_attrs,
        })
    return _envelope("ran", results)

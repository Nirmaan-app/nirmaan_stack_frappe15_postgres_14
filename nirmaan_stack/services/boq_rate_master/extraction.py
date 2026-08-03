# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-attribute extraction runner (RM-3).

The SERVER half of the rate helper going real: assemble the population (rate-editable rows resolved
to wiring_cabling, with their committed-tree ancestry), then extract product attributes with an
independent AI call that MIRRORS ai_voter wholesale (same ai_settings resolution, same
anthropic.Anthropic().messages.create, same 20-row batching, same 3x retry/backoff, same fail-closed
ai_status envelope). A regex CORROBORATOR tags an attribute corroborated=True where a cheap local
pattern AGREES with the AI value -- DISPLAY METADATA ONLY, it never overrides the AI.

SPLIT (owner ruling): this server side extracts ATTRIBUTES only. VALUES are always (re)computed
client-side by the RM-2 interpreter from the CURRENT master/config -- so a rate/param change flows in
live without re-running the AI. Nothing here imports the interpreter or computes a rate.

FAIL CLOSED: settings disabled / no key -> NO Anthropic client, NO call, every attribute null,
ai_status 'disabled' | 'no_key'. There is NO fallback extraction -- an off toggle is an honest
failure, exactly like the classifier.

POPULATION note: the rate-editable predicate is the SAME one persist.blank_category_eligible_rows
uses for population='rate_editable' (Line Item always; qty-bearing Preamble), via the shared
persist._qty_bearing_node_names. We recompute the FULL rate-editable set here (not the blank subset
that helper returns) and JOIN the resolved category (persist.resolve_row_ladder, the same ladder
get_sheet_categories_resolved uses) filtered to wiring_cabling, plus the ancestry from
context_builder.build_sheet_context (the classifier's own single feed source).
"""

import json
import os
import re
import time

import frappe

from nirmaan_stack.services.boq_category import persist
from nirmaan_stack.services.boq_category.ai_voter import _extract_json_array
from nirmaan_stack.services.boq_category.context_builder import build_sheet_context

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

_PROMPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "boq_category", "prompts", "boq_rate_attr_extraction_prompt.md",
)


def _read_prompt():
    with open(os.path.abspath(_PROMPT_PATH), encoding="utf-8") as fh:
        return fh.read()


# ── config / attribute definitions ─────────────────────────────────────────────────
def get_extraction_attribute_defs():
    """The attribute definitions the AI extracts -- the wiring_cabling config's selectable dims
    (material/insulation/core/thickness_sqmm), EXCLUDING brand (selector:false; brand is fixed and
    not part of the pipeline match). Returns the list the prompt injects as ATTRIBUTE_DEFINITIONS,
    or [] when no active config exists."""
    rows = frappe.get_all(
        _CONFIG_DOCTYPE,
        filters={"discipline": DISCIPLINE, "category_id": CATEGORY_ID, "active": 1},
        fields=["config"],
        limit=1,
    )
    if not rows:
        return []
    cfg = rows[0]["config"]
    cfg = cfg if isinstance(cfg, dict) else json.loads(cfg or "{}")
    defs = cfg.get("attribute_definitions") or []
    return [
        {
            "id": d["id"],
            "label": d.get("label") or d["id"],
            "type": d.get("type") or "choice",
            **({"values": d["values"]} if d.get("values") else {}),
        }
        for d in defs
        if d.get("selector") is not False
    ]


# ── population assembly ─────────────────────────────────────────────────────────────
def _resolved_categories(boq, sheet_name, committed_version):
    """{excel_row: effective_category_id} across every discipline, via persist.resolve_row_ladder
    (the SAME ladder get_sheet_categories_resolved / blank_category_eligible_rows use)."""
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
    return {
        er: (persist.resolve_row_ladder(votes)[0] or "").strip()
        for er, votes in votes_by_row.items()
    }


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
    """(committed_version, rows) -- rate-editable rows resolved to wiring_cabling, with ancestry.

    rows come from context_builder.build_sheet_context (the classifier's feed) filtered to the
    rate-editable set AND resolved-category == wiring_cabling. Each row keeps its excel_row,
    description, anc_headers (section headers, outermost first) and notes.
    """
    ctx = build_sheet_context(boq, sheet_name)
    cv = ctx["committed_version"]
    if cv is None:
        return None, []
    resolved = _resolved_categories(boq, sheet_name, cv)
    rate_editable = _rate_editable_excel_rows(boq, sheet_name, cv)
    rows = [
        r for r in ctx["rows"]
        if r["excel_row"] in rate_editable and resolved.get(r["excel_row"]) == CATEGORY_ID
    ]
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
    value (else None); number -> a float/int (else None); null stays None."""
    if raw is None:
        return None
    if defn["type"] == "number":
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return None
        return int(v) if v == int(v) else v
    # choice
    allowed = defn.get("values")
    sval = str(raw)
    if allowed and sval not in allowed:
        return None
    return sval


def _extract_batch(client, model, prompt_text, attr_defs, rows_batch):
    """One extraction batch call with retry/backoff. Returns {excel_row: {attr_id: {value,
    confidence}}}. Ports ai_voter._ai_batch mechanics (<=20 rows, 3 attempts, sleep 2*attempt)."""
    payload_items = [_ai_item(r) for r in rows_batch]
    content = (
        prompt_text
        + "\n\nATTRIBUTE_DEFINITIONS:\n"
        + json.dumps(attr_defs, ensure_ascii=False)
        + "\n\nROWS:\n"
        + json.dumps(payload_items, ensure_ascii=False)
    )
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
    from the first core-x-size pattern. Missing keys => no corroboration for that attribute."""
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
    """Assemble the population and extract attributes. Returns
    {committed_version, ai_status, model, category_id, attribute_definitions, results}
    where results = [{excel_row, description, attributes:{id:{value, confidence, corroborated}}}].

    Fails CLOSED (disabled / no key) -> results with all-null attributes + ai_status set; NO call.
    client is injectable for tests (a mock Anthropic client); when None and enabled, a real
    anthropic.Anthropic is built from the encrypted key.
    """
    from nirmaan_stack.api.boq.wizard.ai_settings import (
        get_boq_ai_api_key,
        get_boq_ai_settings,
    )

    cv, rows = assemble_population(boq, sheet_name)
    attr_defs = get_extraction_attribute_defs()
    settings = get_boq_ai_settings()
    model = settings.get("model") or _DEFAULT_MODEL

    def _blank_row(r):
        return {
            "excel_row": r["excel_row"],
            "description": r.get("description") or "",
            "attributes": {
                d["id"]: {"value": None, "confidence": 0.0, "corroborated": False}
                for d in attr_defs
            },
        }

    def _envelope(ai_status, results):
        return {
            "committed_version": cv,
            "ai_status": ai_status,
            "model": model,
            "category_id": CATEGORY_ID,
            "attribute_definitions": attr_defs,
            "results": results,
        }

    if cv is None or not rows:
        # Nothing to extract (uncommitted or no wiring_cabling rate-editable rows). Honest empty run;
        # ai_status reflects the toggle so the UI can still surface "AI was off".
        status = "ran" if settings.get("enabled") else "disabled"
        return _envelope(status, [])

    # Fail closed.
    if not settings.get("enabled"):
        return _envelope("disabled", [_blank_row(r) for r in rows])
    if client is None:
        api_key = get_boq_ai_api_key()
        if not api_key:
            return _envelope("no_key", [_blank_row(r) for r in rows])
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

    prompt_text = _read_prompt()
    ai_out = {}
    total = len(rows)
    for b in range(0, total, _BATCH):
        batch = rows[b : b + _BATCH]
        ai_out.update(_extract_batch(client, model, prompt_text, attr_defs, batch))
        if progress_cb:
            progress_cb(min(b + _BATCH, total), total)

    results = []
    for r in rows:
        row_attrs = ai_out.get(r["excel_row"])
        if row_attrs is None:
            row_attrs = {
                d["id"]: {"value": None, "confidence": 0.0} for d in attr_defs
            }
        _corroborate(r, row_attrs)
        results.append({
            "excel_row": r["excel_row"],
            "description": r.get("description") or "",
            "attributes": row_attrs,
        })
    return _envelope("ran", results)

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


class ExtractionHalted(Exception):
    """SR-1: a batch could not be completed and the RUN must stop cleanly, KEEPING everything
    extracted so far (the caller saves a partial and the user resumes). Distinguishable from a
    generic failure on purpose -- run_extraction catches exactly this to break out of the batch
    loop and fall through to the normal results assembly.

    `reason` is plain language shown to the pricer; `terminal` records whether the underlying
    error was non-retryable (a usage limit / auth / invalid request) or a transient one that
    exhausted its retries.
    """

    def __init__(self, reason, terminal=True, detail=""):
        super().__init__(reason)
        self.reason = reason
        self.terminal = terminal
        self.detail = detail


# Errors that will NOT clear by trying again: the account/request itself is refused. Retrying these
# burns two guaranteed-failed calls and delays the partial save.
_TERMINAL_MARKERS = (
    "USAGE LIMIT", "USAGE_LIMIT", "QUOTA", "CREDIT BALANCE", "BILLING",
    "AUTHENTICATION", "UNAUTHORIZED", "INVALID_API_KEY", "INVALID API KEY", "PERMISSION_ERROR",
    "INVALID_REQUEST_ERROR",
)


def _is_transient(exc):
    """True when the error is worth retrying -- i.e. everything EXCEPT a positively-identified
    terminal error.

    THE DEFAULT DIRECTION IS LOAD-BEARING. An unrecognised error must keep the pre-SR-1 retry
    behaviour, because that is what it had before; only errors we can positively name as
    non-retryable may fast-fail. Defaulting the other way silently converted retryable failures
    into instant halts -- a TRUNCATED AI reply (ValueError from _extract_json_array) is exactly
    that case, and it is common enough to have caused a production run failure. It is a per-call
    artifact that usually succeeds on the next attempt.

    The transient vocabulary still ADOPTS the existing precedent (boq_ai_assist._TRANSIENT_MARKERS)
    for the positive signals it recognises; the import is LAZY and defensive because boq_ai_assist
    calls frappe.logger("boq_ai") at module load (the documented reason the raw unittest runner
    fails on it), so a module-scope import would extend that constraint to every importer here.
    """
    blob = f"{type(exc).__name__} {exc}".upper()
    if any(marker in blob for marker in _TERMINAL_MARKERS):
        return False
    try:
        from nirmaan_stack.services.boq_ai_assist import _TRANSIENT_MARKERS
    except Exception:
        return True
    if any(marker in blob for marker in _TRANSIENT_MARKERS):
        return True
    return True  # unrecognised -> retry, exactly as before SR-1


def _halt_reason_for(exc):
    """Plain-language halt reason for a NON-retryable error, for the pricer -- never the opaque
    'suggest_failed'. Keeps the provider's own words in the detail for the log."""
    blob = f"{type(exc).__name__} {exc}"
    upper = blob.upper()
    if "USAGE LIMIT" in upper or "USAGE_LIMIT" in upper or "CREDIT" in upper or "BILLING" in upper:
        return "The AI account's usage limit was reached, so the run stopped early."
    if "AUTHENTICATION" in upper or "UNAUTHORIZED" in upper or "API KEY" in upper or "API_KEY" in upper:
        return "The AI API key was rejected, so the run stopped early."
    if "PERMISSION" in upper or "FORBIDDEN" in upper:
        return "The AI account is not permitted to run this request, so the run stopped early."
    return "The AI request was refused, so the run stopped early."


_ROW_CATEGORY = "BoQ Row Category"
_BOQ_NODES = "BOQ Nodes"
_BOQ_SHEET = "BoQ Sheet"
_CONFIG_DOCTYPE = "BoQ Rate Category Config"
_MASTER_ITEM = "BoQ Rate Master Item"

_PROMPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "boq_category", "prompts")
_ATTR_PROMPT_PATH = os.path.join(_PROMPT_DIR, "boq_rate_attr_extraction_prompt.md")
_IDENTITY_PROMPT_PATH = os.path.join(_PROMPT_DIR, "boq_rate_item_identity_prompt.md")
# EA-4d: the general composite-decomposition prompt -- decompose an assembled unit (a DB filled with
# breakers, a switch point, an industrial socket with a paired MCB, a future HVAC composite) into its
# component SLOTS. Selected by matching_mode == "composite_decomposition".
_DECOMPOSITION_PROMPT_PATH = os.path.join(_PROMPT_DIR, "boq_composite_decomposition_prompt.md")


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
def values_from_catalog(discipline, spec):
    """EA-4a: resolve an attribute's allowed values FROM the live master -- the distinct `attr` values
    across the `kind` rows matching every key in `where` (exact). The SAME live-read shape as the
    item-identity catalog (catalog_values), for a NON-identity choice whose options are another
    category's rows (point_wiring's switch/socket/plate selects, keyed by family). Empty when the spec
    is malformed or no discipline -- an HONEST empty select, never a hardcoded list."""
    if not discipline or not isinstance(spec, dict):
        return []
    kind = spec.get("kind")
    attr = spec.get("attr")
    if not kind or not attr:
        return []
    where = spec.get("where") or {}
    rows = frappe.get_all(
        _MASTER_ITEM,
        filters={"discipline": discipline, "kind": kind, "active": 1},
        fields=["attributes"],
    )
    out, seen = [], set()
    for r in rows:
        a = r["attributes"] if isinstance(r["attributes"], dict) else json.loads(r["attributes"] or "{}")
        if not all(a.get(k) == v for k, v in where.items()):
            continue
        v = a.get(attr)
        if isinstance(v, str):
            v = v.strip()
        if v not in (None, "") and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def build_attribute_defs(cfg, catalog=None, discipline=None):
    """The attribute definitions injected into the AI prompt for one config. Selectable defs only
    (exclude selector:false, e.g. brand). When the config is item-identity, the identity attribute
    carries {"identity": true} and its `values` = the live catalog (overriding any stored values); a
    def with `values_from` (EA-4a) gets its `values` resolved from the live master exactly like the
    identity catalog; all other choice defs keep their stored `values`. A def with an `extraction`
    `default` (EA-4a) carries it through so the prompt can offer it as the no-positive-identification
    fallback (the actual default set lives in cfg.extraction_defaults, injected in _extract_batch)."""
    identity = cfg.get("identity_attribute_id") if cfg.get("matching_mode") == "item_identity" else None
    out = []
    for d in cfg.get("attribute_definitions") or []:
        if d.get("selector") is False:
            continue
        entry = {"id": d["id"], "label": d.get("label") or d["id"], "type": d.get("type") or "choice"}
        if identity and d["id"] == identity:
            entry["identity"] = True
            entry["values"] = list(catalog or [])
        elif d.get("values_from"):
            entry["values"] = values_from_catalog(discipline, d["values_from"])
        elif d.get("values"):
            entry["values"] = d["values"]
        if d.get("default") is not None:
            entry["default"] = d["default"]
        # EA-4a-r: an allow_none def may be POSITIVELY ABSENT -- "None" is a valid extracted value (added
        # to the allowed set so _coerce_value keeps it) and the flag rides through for the prompt guidance.
        if d.get("allow_none"):
            entry["allow_none"] = True
            entry["values"] = [*(entry.get("values") or []), "None"]
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
    """The prompt asset for one config, selected by matching_mode:
      - "item_identity"          -> the identity prompt (match ONE catalog item, refuse composites);
      - "composite_decomposition" -> the general decomposition prompt (DECOMPOSE an assembled unit into
                                     its slots -- EA-4d; driven entirely by composite_slots + decomposition_rules);
      - else                     -> the attribute-extraction prompt (unchanged).
    The mode is read from config -- NOTHING category-specific is hardcoded, so a future composite category
    inherits the decomposition prompt by declaring matching_mode alone."""
    mode = cfg.get("matching_mode")
    if mode == "item_identity":
        path = _IDENTITY_PROMPT_PATH
    elif mode == "composite_decomposition":
        path = _DECOMPOSITION_PROMPT_PATH
    else:
        path = _ATTR_PROMPT_PATH
    return _read_prompt(path)


def build_slot_spec(cfg, discipline=None):
    """EA-4d: for a composite_decomposition config, emit the structured SLOT_SPEC the decomposition
    prompt consumes -- a SHELL, a REPEATABLE group (expanded to its enumerated slot attrs), and FIXED
    slots, each with its allowed CATALOG resolved via the EXISTING `values_from` path (one resolve per
    slot family: the shell catalog, the repeatable group's catalog, each fixed slot's catalog).

    Entirely CONFIG-DRIVEN from cfg.composite_slots -- the repeatable prefix/count/suffixes and every
    values_from spec come from the config, so NOTHING db-specific is hardcoded here. A future composite
    (switches_point, industrial sockets, HVAC) declares composite_slots and inherits this with zero code
    change. Returns None when the config declares no composite_slots (the mode is inert without it)."""
    cs = cfg.get("composite_slots")
    if not isinstance(cs, dict):
        return None
    spec = {}
    shell = cs.get("shell")
    if isinstance(shell, dict):
        spec["shell"] = {
            "item_attr": shell.get("attr"),
            "qty_attr": shell.get("qty_attr"),
            "optional": bool(shell.get("optional")),
            "role": shell.get("role"),
            "catalog": values_from_catalog(discipline, shell.get("values_from") or {}),
        }
    rep = cs.get("repeatable")
    if isinstance(rep, dict):
        prefix = rep.get("prefix") or ""
        count = int(rep.get("count") or 0)
        isuf = rep.get("item_suffix") or "_item"
        qsuf = rep.get("qty_suffix") or "_qty"
        spec["repeatable"] = {
            "item_attrs": [f"{prefix}{i}{isuf}" for i in range(1, count + 1)],
            "qty_attrs": [f"{prefix}{i}{qsuf}" for i in range(1, count + 1)],
            "role": rep.get("role"),
            "catalog": values_from_catalog(discipline, rep.get("values_from") or {}),
        }
    fixed = cs.get("fixed")
    if isinstance(fixed, list):
        spec["fixed"] = [
            {
                "item_attr": f.get("attr"),
                "qty_attr": f.get("qty_attr"),
                "optional": bool(f.get("optional")),
                "role": f.get("role"),
                "catalog": values_from_catalog(discipline, f.get("values_from") or {}),
            }
            for f in fixed if isinstance(f, dict)
        ]
    return spec or None


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


def _coerce_value(defn, raw, synonyms_for_attr=None):
    """Coerce/validate one extracted value against its definition. choice -> must be an allowed
    value (else None; for an identity attribute the allowed values ARE the catalog); number -> a
    float/int (else None); null stays None.

    EA-DIFF: `synonyms_for_attr` ({variant: canonical}) maps a returned variant to its canonical BEFORE
    the choice check -- defence in depth, so a model that echoes the row's variant (e.g. GI) still
    lands on the canonical (MS) even though the .md prompt was told to map it. Price-interchangeable
    per business rule."""
    if raw is None:
        return None
    # EA-4a-r: the "None" sentinel is POSITIVE ABSENCE -- preserve it verbatim for an allow_none def (a
    # number one included, where float("None") would raise and drop the signal). Distinct from null/blank.
    if defn.get("allow_none") and str(raw) == "None":
        return "None"
    if defn["type"] == "number":
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return None
        return int(v) if v == int(v) else v
    # choice (incl. the identity catalog)
    sval = str(raw)
    if synonyms_for_attr and sval in synonyms_for_attr:
        sval = str(synonyms_for_attr[sval])  # variant -> canonical, before the allowed-values check
    allowed = defn.get("values")
    if allowed and sval not in allowed:
        return None
    return sval


def _extract_batch(client, model, prompt_text, attr_defs, rows_batch, synonyms=None, defaults=None, none_guidance=None, slot_spec=None, resolution_rules=None, rules=None):
    """One extraction batch call with retry/backoff. Returns {excel_row: {attr_id: {value,
    confidence[, defaulted]}}} for the batch's OWN rows only. Ports ai_voter._ai_batch mechanics
    (<=20 rows, 3 attempts, sleep 2*attempt).

    EA-DIFF: when `synonyms` ({attr_id: {variant: canonical}}) is configured for the category, a
    SYNONYMS section + one guidance line are appended (the .md prompt ASSETS stay untouched -- the
    guidance lives in this wrapper). _coerce_value ALSO maps variant->canonical (defence in depth).

    EA-4a: when `defaults` (cfg.extraction_defaults: {attr_id: default | {default, text_overrides}})
    is configured, a DEFAULTS section + one guidance line are appended -- where the row text gives NO
    positive identification of a default-carrying attribute the model returns the default with moderate
    confidence and `defaulted: true`; a text_override word in the row text IS a positive identification
    of that override value. That per-attribute `defaulted` flag is carried into the result (coercion
    keeps the value; this wrapper keeps the flag). Absent synonyms AND defaults -> byte-identical."""
    payload_items = [_ai_item(r) for r in rows_batch]
    content = (
        prompt_text
        + "\n\nATTRIBUTE_DEFINITIONS:\n"
        + json.dumps(attr_defs, ensure_ascii=False)
    )
    # EA-4d: the composite-decomposition mode passes a SLOT_SPEC (shell / repeatable / fixed, each with
    # its catalog) + RESOLUTION_RULES (curve/amp/partial). Absent (item_identity / attribute modes) ->
    # byte-identical to before. The model returns the filled slots under a "slots" key (parsed below).
    if slot_spec:
        content += "\n\nSLOT_SPEC:\n" + json.dumps(slot_spec, ensure_ascii=False)
    if resolution_rules:
        content += "\n\nRESOLUTION_RULES:\n" + json.dumps(resolution_rules, ensure_ascii=False)
    # EA-4 ext-a: owner-authored estimator rules, injected for EVERY category (never composite-gated).
    # The guidance text is authored by the estimator and passed through VERBATIM -- do not reword it
    # here. Absent => this block is skipped and the payload is byte-identical to pre-ext-a.
    if rules:
        content += (
            "\n\nESTIMATOR_RULES: apply these domain rules when choosing catalog items and attribute "
            "values for these rows. They override your default reading of the row text where they "
            "conflict.\n"
            + json.dumps(rules, ensure_ascii=False)
        )
    if synonyms:
        content += (
            "\n\nSYNONYMS: where a row states a variant key, extract the mapped canonical value "
            "(these are price-interchangeable per business rule).\n"
            + json.dumps(synonyms, ensure_ascii=False)
        )
    if defaults:
        content += (
            "\n\nDEFAULTS: where an attribute below has a default and the row text gives NO positive "
            "identification, return the default with moderate confidence AND set that attribute's "
            "\"defaulted\": true. For an attribute whose default is an object with text_overrides: when "
            "the row text contains the given word, that override value IS the positive identification "
            "(return it normally, defaulted false).\n"
            + json.dumps(defaults, ensure_ascii=False)
        )
    # EA-4a-r: an allow_none attribute may be POSITIVELY ABSENT. "None" is a distinct answer from
    # null/blank: None = the row's enumerated bill names no such component; null = too vague to tell.
    none_defs = [d["id"] for d in attr_defs if d.get("allow_none")]
    if none_defs:
        # none_guidance may be a CUSTOM string (used verbatim) or a truthy FLAG (e.g. True -> use the
        # default wording); anything not a non-empty string falls back to the default line.
        guidance = none_guidance if isinstance(none_guidance, str) and none_guidance.strip() else (
            'return "None" when the row\'s enumerated bill names NO such component (positive absence -- a '
            "real light point may have a switch and plate but no socket, or a single wire and no second wire); "
            "return null/blank ONLY when the row is too vague to tell."
        )
        content += (
            '\n\nOPTIONAL COMPONENTS (may be "None"): ' + guidance + "\n"
            + json.dumps(none_defs, ensure_ascii=False)
        )
    content += "\n\nROWS:\n" + json.dumps(payload_items, ensure_ascii=False)
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
                # EA-4d: the composite-decomposition prompt returns the filled slots under "slots"; the
                # identity/attribute prompts use "attributes". Accept EITHER -- the per-attr shape
                # ({value, confidence}) and the downstream coercion are identical for both.
                attrs = el.get("attributes")
                if attrs is None:
                    attrs = el.get("slots")
                attrs = attrs or {}
                row_out = {}
                for aid, defn in defs_by_id.items():
                    cell = attrs.get(aid) or {}
                    value = _coerce_value(defn, cell.get("value"), (synonyms or {}).get(aid))
                    try:
                        conf = float(cell.get("confidence"))
                    except (TypeError, ValueError):
                        conf = 0.0
                    row_out[aid] = {"value": value, "confidence": max(0.0, min(1.0, conf))}
                    # EA-4a: keep the model's per-attribute `defaulted` flag (only when the value
                    # survived coercion -- a defaulted value is one of the allowed values, so this
                    # simply marks WHY it is present). Absent/false -> flag omitted (byte-compat).
                    if defaults and value is not None and bool(cell.get("defaulted")):
                        row_out[aid]["defaulted"] = True
                out[rid] = row_out
            return out
        except Exception as exc:
            last = exc
            # SR-1: classify BEFORE retrying. A TERMINAL error (usage limit / auth / invalid
            # request) will not clear in six seconds, so retrying it burns two guaranteed-failed
            # calls and delays the partial save. Fail fast and let the caller keep what it has.
            # A TRANSIENT error keeps today's retry/backoff behaviour byte-identical.
            if not _is_transient(exc):
                raise ExtractionHalted(
                    _halt_reason_for(exc), terminal=True, detail=repr(exc)
                ) from exc
            time.sleep(2 * attempt)
    # Retries exhausted on a transient error. Still a HALT, not a crash: the run keeps every batch
    # completed so far and becomes resumable, instead of discarding the whole run's work.
    raise ExtractionHalted(
        f"An AI request kept failing after {_RETRIES} attempts, so the run stopped early.",
        terminal=False,
        detail=repr(last),
    )


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
def run_extraction(boq, sheet_name, client=None, progress_cb=None, checkpoint_cb=None, skip_rows=None):
    """Assemble the population and extract attributes ACROSS ALL eligible categories (EA-2). Returns
    {committed_version, ai_status, model, results} where results =
    [{excel_row, description, category_id, attributes:{id:{value, confidence, corroborated}}}].

    Batches are SINGLE-CATEGORY (each carries its category's defs + prompt; item-identity categories
    inject the identity prompt + the live catalog). Progress counts rows across all categories.

    Fails CLOSED (disabled / no key) -> results with all-null attributes + ai_status set; NO call.
    client is injectable for tests (a mock Anthropic client); when None and enabled, a real
    anthropic.Anthropic is built from the encrypted key.

    SR-1 additions (all ADDITIVE -- absent => the pre-SR-1 behaviour):
      * checkpoint_cb(row_results, attempted_rows) is called after EVERY completed batch, following
        the SAME injection pattern as progress_cb. The service layer still performs NO frappe.db
        writes -- the callback owns persistence, exactly as progress_cb owns the Redis marker.
      * skip_rows: excel_rows already attempted by a previous run of THIS run doc; a resume passes
        the persisted attempted_rows so only pending rows are processed.
      * On a halt the loop BREAKS and falls through to the normal results assembly (which already
        tolerates a partial ai_out), returning the additive keys `complete` / `halted` /
        `halt_reason` / `attempted_rows`. ai_status is deliberately NOT widened -- it keeps its own
        3-value vocabulary, which the doctype and the frontend both treat as a contract.
    """
    from nirmaan_stack.api.boq.wizard.ai_settings import (
        get_boq_ai_api_key,
        get_boq_ai_settings,
    )

    cv, all_rows = assemble_population(boq, sheet_name)
    settings = get_boq_ai_settings()
    model = settings.get("model") or _DEFAULT_MODEL

    # SR-1 resume: process only rows a previous pass of this run has NOT already attempted. The
    # population itself is always recomputed in full so `population_rows` stays the completeness
    # yardstick regardless of how many passes it took.
    skip = {int(x) for x in (skip_rows or [])}
    population_rows = [r["excel_row"] for r in all_rows]
    rows = [r for r in all_rows if r["excel_row"] not in skip]

    def _envelope(ai_status, results, complete=True, halt_reason=None, attempted=None):
        attempted_now = sorted(attempted) if attempted is not None else [r["excel_row"] for r in results]
        return {
            "committed_version": cv,
            "ai_status": ai_status,
            "model": model,
            "results": results,
            # SR-1 additive keys (never widen ai_status -- see the docstring).
            "complete": complete,
            "halted": not complete,
            "halt_reason": halt_reason,
            "attempted_rows": attempted_now,      # attempted by THIS pass only
            "population_rows": population_rows,   # the full sheet population (completeness yardstick)
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
        is_composite = cfg.get("matching_mode") == "composite_decomposition"
        group_ctx[(disc, cat)] = {
            "defs": build_attribute_defs(cfg, catalog, disc),  # EA-4a: disc resolves values_from
            "prompt": select_prompt_text(cfg),
            "synonyms": cfg.get("synonyms"),  # EA-DIFF: {attr_id: {variant: canonical}} or None
            "defaults": cfg.get("extraction_defaults"),  # EA-4a: {attr_id: default | {default, ...}} or None
            "none_guidance": cfg.get("extraction_none_guidance"),  # EA-4a-r: optional per-config None wording
            # EA-4d: the composite-decomposition slot spec + resolution rules (None for the other modes,
            # so _extract_batch stays byte-identical for item_identity / attribute categories).
            "slot_spec": build_slot_spec(cfg, disc) if is_composite else None,
            "resolution_rules": cfg.get("decomposition_rules") if is_composite else None,
            # EA-4 ext-a: owner-authored estimator rules. DELIBERATELY UNGATED -- unlike slot_spec /
            # resolution_rules (composite-only), these must reach EVERY category, composite or not
            # (R7 lands on cabletray_raceway, an ordinary attribute category). Absent => None =>
            # the prompt is byte-identical to before.
            "rules": cfg.get("rules"),
        }

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
    attempted = set()
    halt_reason = None
    halt_detail = None
    halt_terminal = None

    def _row_result(r, row_attrs):
        if row_attrs is None:
            row_attrs = {d["id"]: {"value": None, "confidence": 0.0} for d in _defs_for(r)}
        _corroborate(r, row_attrs)
        return {
            "excel_row": r["excel_row"],
            "description": r.get("description") or "",
            "category_id": r["category_id"],
            "attributes": row_attrs,
        }

    try:
        for (disc, cat), grp_rows in groups.items():
            gc = group_ctx[(disc, cat)]
            for b in range(0, len(grp_rows), _BATCH):
                batch = grp_rows[b : b + _BATCH]
                batch_out = _extract_batch(client, model, gc["prompt"], gc["defs"], batch, gc["synonyms"], gc["defaults"], gc["none_guidance"], gc["slot_spec"], gc["resolution_rules"], gc["rules"])
                ai_out.update(batch_out)
                # The batch RETURNED, so its rows are genuinely attempted. A row the model simply
                # did not answer for is still attempted (we asked); only a HALTED batch's rows stay
                # pending. This is the done-marker a resume keys off -- never "are the attributes
                # blank", which cannot tell not-asked from asked-and-got-null.
                attempted.update(r["excel_row"] for r in batch)
                done += len(batch)
                if progress_cb:
                    progress_cb(min(done, total), total)
                # SR-1 CHECKPOINT: hand this batch's rows to the caller to persist, so the work
                # survives a later halt. Same injection shape as progress_cb; the service layer
                # performs no DB write of its own.
                if checkpoint_cb:
                    checkpoint_cb(
                        [_row_result(r, ai_out.get(r["excel_row"])) for r in batch],
                        sorted(attempted),
                    )
    except ExtractionHalted as halt:
        # Stop cleanly and KEEP everything extracted so far. Falls through to the same assembly the
        # complete path uses -- which already tolerates a partial ai_out.
        halt_reason = halt.reason
        # Carry the provider's OWN words out with it. Handling a halt gracefully must not make the
        # underlying cause unknowable: the pricer gets `halt_reason`, the operator needs this.
        halt_detail = halt.detail
        halt_terminal = halt.terminal

    results = [_row_result(r, ai_out.get(r["excel_row"])) for r in rows]
    if halt_reason is not None:
        # Only the rows actually attempted are reported; the rest stay pending for the resume.
        attempted_results = [row for row in results if row["excel_row"] in attempted]
        env = _envelope("ran", attempted_results, complete=False,
                        halt_reason=halt_reason, attempted=attempted)
        env["halt_detail"] = halt_detail
        env["halt_terminal"] = halt_terminal
        return env
    return _envelope("ran", results, complete=True, attempted=attempted)

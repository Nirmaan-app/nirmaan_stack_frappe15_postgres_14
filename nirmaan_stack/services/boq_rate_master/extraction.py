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
# SR-2: the reply ceiling. 8000 was INHERITED from the classifier voter (CL-1a, 2026-07-06), where
# a reply is one small object per row; RM-3 copied it into a workload whose reply is ~7x heavier and
# nothing revisited it. It only started BINDING on 2026-07-31, when the EA-4 series made 14-attribute
# categories live and the measured reply grew 6.5x (169 -> 1,098 chars/row on the same sheet, same
# category), landing a 20-row batch astride the ceiling. 32000 -- NOT the configured 100000: this
# call is NON-STREAMING with a 300s timeout, and that region is untested. See the SR-2 recon.
_AI_MAX_TOKENS = 32000
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


class ReplyCeilingExceeded(Exception):
    """SR-2: the provider CUT the reply short because it hit `max_tokens`. The reply is incomplete
    by construction, not malformed by accident.

    Before SR-2 this surfaced ONLY as the downstream
    `ValueError('truncated (unbalanced) JSON array in AI response')` from `_extract_json_array`,
    which is indistinguishable from a genuinely garbled reply. That ambiguity is what made the
    2026-08-02 failures a night of diagnosis instead of a glance at a log line -- and the two cases
    need OPPOSITE responses: a garbled reply is a per-call artifact worth retrying (the SR-1
    default-to-retry rule), while a ceiling cut is DETERMINISTIC for a given batch and will cut at
    the same place on every attempt. Retrying it is guaranteed waste; the only thing that helps is
    asking for less at a time (`_extract_with_ceiling_split`).

    Mirrors the existing precedent in `boq_ai_assist._safe_text`, which already raises on an
    unexpected `stop_reason` -- the pattern existed in this codebase and simply had not been
    applied here.
    """

    def __init__(self, size, max_tokens):
        super().__init__(
            f"The AI reply hit the {max_tokens}-token ceiling on a {size}-row batch and was cut "
            f"off mid-answer."
        )
        self.size = size
        self.max_tokens = max_tokens


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


# ── Extraction capture: prompt + raw response + per-attribute mapping ───────────────
# PERMANENT instrumentation. It SUPERSEDES the temporary EA-7 payload dump, which is RETIRED --
# EA-7's record (the per-row payload item) is a strict SUBSET of the batch record below, so
# nothing was lost by removing it.
#
# WHY IT EXISTS: `_coerce_value` returns None for EVERY failure and discards the raw value, so a
# value the model RETURNED and we then dropped is byte-identical, in storage, to a value the model
# never returned. That made three defect classes indistinguishable: (i) a readable description was
# sent and nothing came back, (ii) the row text was genuinely ambiguous, (iii) a value came back
# and we dropped / coerced / defaulted it away. This records the assembled prompt, the raw reply
# and the per-attribute raw->coerced mapping, so a drop is visible AS a drop rather than as an
# absence.
#
# ALWAYS-ON, deliberately (standing owner rule 2026-08-11: no dev-only gates -- anything built
# works as-is in production). There is NO flag, and that is load-bearing rather than incidental:
# EA-7 was gated by a module-level constant, and a long-lived RQ worker imports this module ONCE
# at process start and never hot-reloads, so a constant flipped afterwards was silently ignored --
# the pass ran, completed, and produced no dump at all (standing finding #171). Nothing to flip
# means nothing can be stale. Measured cost is ~1.5-3 MB per full audit sweep.
#
# ⚠️ KNOWN LIMIT -- do NOT try to solve it here: this is a SERVER capture. The frontend
# `rateMasterStructure.coerceForMatch` turns a stored value into a catalog match key, and a
# mismatch silently matches NOTHING. So this proves a value reached STORAGE; it cannot see a
# client-side match failure. A row that captures cleanly and still does not price is a frontend
# question, not a contradiction.
CAPTURE_FILENAME = "boq_rate_extraction_capture.jsonl"
CAPTURE_MAX_BYTES = 8 * 1024 * 1024   # roll at 8 MB (~3 full audit sweeps)
CAPTURE_KEEP = 5                      # ... keeping 5 rolled generations, so ~48 MB ceiling
CAPTURE_VERSION = 1                   # record-shape version, so a later reader can branch on it

# The coercion outcome vocabulary. Returned by _coerce_value_ex alongside the value so the capture
# can say WHY a value was dropped without re-deriving the checks at the call site (duplicating
# coercion logic is the exact drift this codebase has been bitten by three times).
COERCE_OK = "ok"
COERCE_OK_SYNONYM = "ok_synonym"          # a variant was mapped to its canonical, then accepted
COERCE_OK_NONE = "ok_none_sentinel"       # the "None" positive-absence sentinel, preserved
COERCE_ABSENT = "absent"                  # the model returned null -- NOT a failure
COERCE_NOT_A_NUMBER = "not_a_number"
COERCE_OUTSIDE_DOMAIN = "outside_numeric_domain"
COERCE_NOT_ALLOWED = "not_an_allowed_choice"

# The POSITIVE-ABSENCE sentinel, as a named constant. The literal already appears in `_coerce_value_ex`
# and in the allow_none prompt block; the slot-paired default scrub is the third reader, and three
# copies of a bare "None" is how a sentinel quietly becomes two different sentinels. Value-identical
# to the frontend's `NONE_SENTINEL` (ratePipelineInterpreter.ts) -- a deliberate cross-language pair.
_NONE_SENTINEL = "None"


def _capture_path():
    """The bench logs directory -- resolved, never hardcoded -- alongside the existing boq_*.log
    family. Returns None if it cannot be resolved or is not writable, so capture can never break a
    run by failing to find somewhere to write."""
    try:
        logs = os.path.join(frappe.utils.get_bench_path(), "logs")
        if os.path.isdir(logs) and os.access(logs, os.W_OK):
            return os.path.join(logs, CAPTURE_FILENAME)
    except Exception:
        pass
    return None


def _capture_roll(path):
    """Size-based rotation, hand-rolled on purpose. Frappe's own RotatingFileHandler belongs to the
    `logging` module and does not apply to a plain append like this one -- the EA-7 writer had no
    rotation at all, which was tolerable only because it was temporary and off. Capture is
    always-on, so it MUST bound itself."""
    try:
        if os.path.getsize(path) < CAPTURE_MAX_BYTES:
            return
    except OSError:
        return  # missing / unstatable -> nothing to roll
    try:
        oldest = "%s.%d" % (path, CAPTURE_KEEP)
        if os.path.exists(oldest):
            os.remove(oldest)
        for i in range(CAPTURE_KEEP - 1, 0, -1):
            src, dst = "%s.%d" % (path, i), "%s.%d" % (path, i + 1)
            if os.path.exists(src):
                os.replace(src, dst)
        os.replace(path, path + ".1")
    except OSError:
        pass  # a failed roll must not stop the write, and must not fail the run


def _capture_write(record):
    """Append one JSON line. Wrapped so a capture failure can NEVER fail a run -- instrumentation
    that can break the thing it observes is worse than none. `default=str` guards the raw model
    reply: it is arbitrary model output, and a value that will not serialise must degrade to its
    repr rather than raise."""
    path = _capture_path()
    if not path:
        return None
    try:
        _capture_roll(path)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        return path
    except Exception:
        return None


def _usage_of(resp):
    """Token usage off the response object, defensively. Currently DISCARDED by the pipeline --
    recording it here is what retires the inferred-call-count problem."""
    u = getattr(resp, "usage", None)
    if u is None:
        return None
    out = {}
    for k in ("input_tokens", "output_tokens",
              "cache_read_input_tokens", "cache_creation_input_tokens"):
        v = getattr(u, k, None)
        if v is not None:
            out[k] = v
    return out or None


def _capture_common(capture_ctx, rows_batch, kind):
    """The join key back to the suggestion output. `boq` is NOT on the row dict -- it lives only in
    run_extraction's scope and is threaded in through capture_ctx."""
    first = rows_batch[0] if rows_batch else {}
    ctx = capture_ctx or {}
    return {
        "kind": kind,
        "capture_version": CAPTURE_VERSION,
        "ts": frappe.utils.now(),
        "boq": ctx.get("boq"),
        "sheet_name": first.get("sheet_name"),   # VERBATIM, trailing space and all
        "committed_version": first.get("committed_version"),
        "category_id": first.get("category_id"),
        "discipline": first.get("discipline"),
        "excel_rows": [r.get("excel_row") for r in rows_batch],
    }


def _capture_run_header(boq, sheet_name, committed_version, model, row_count, categories,
                        ai_enabled):
    """THE ANTI-SILENCE DEVICE. Written once per run, UNCONDITIONALLY -- including for a run that
    extracts nothing (AI disabled, no key, no eligible rows).

    The failure mode this exists to kill is the worst kind: with the old dump, absence of output
    was indistinguishable from absence of the phenomenon. A header makes "the code never ran" a
    different observation from "the code ran and nothing happened".

    NOTE: `run_id` is deliberately absent -- it is minted by the API layer (`_suggest_worker`), and
    threading it down would mean editing that module. Join on (boq, sheet_name, committed_version,
    ts) instead.
    """
    return _capture_write({
        "kind": "run_header",
        "capture_version": CAPTURE_VERSION,
        "ts": frappe.utils.now(),
        "boq": boq,
        "sheet_name": sheet_name,
        "committed_version": committed_version,
        "model": model,
        "row_count": row_count,
        "categories": sorted(categories),
        "ai_enabled": bool(ai_enabled),
        "capture": "always-on",   # there is no flag; this states it in the artefact itself
    })


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


# ══════════════════════════════════════════════════════════════════════════════════════════
# READ-TIME COLUMN PROJECTION -- the mechanism that makes a `BoQ Rate Master Item` COLUMN
# behave like an ATTRIBUTE. Owner-chosen option (C), 2026-09-03.
# ══════════════════════════════════════════════════════════════════════════════════════════
#
# ⚠️ THE OTHER HALF OF THIS MECHANISM LIVES IN `api/boq/rate_master.py`, in
#    `get_rate_master_items`. There are exactly TWO projection sites and no others. Each names
#    the other. If you are changing one, read both.
#
# WHAT THIS DOES
#   A rate-master item stores `brand` (and `unit`, `kind`, ...) as a top-level COLUMN, while
#   `description`, `material`, `core` and every other specification live inside the `attributes`
#   JSON map. This copies each listed COLUMN into the `attributes` map AT READ TIME.
#   ⚠️ NOTHING IS STORED. No write, no migration, no backfill, no asset mint. The database is
#   byte-untouched; the projection is recomputed on every read and therefore self-heals.
#
# WHY
#   Everything downstream indexes `attributes` and CANNOT reach a column. Two disjoint bodies of
#   code, and naming both is the point -- the reach is wider than it looks:
#     * the DROPDOWN readers -- `catalog_values`, `values_from_catalog` and `attributes_by_item`
#       below (which also carries `build_slot_spec`'s three composite catalogues), plus the two
#       frontend readers `pricingSheetHelper.attributeOptions` and
#       `RateMasterDerivation.valuesFromOptions`;
#     * the MATCHERS -- 13 sites in `frontend/src/pages/pricing/rate-master/
#       ratePipelineInterpreter.ts` (`component_ref`, `catalog_fit`, `buildModuleLadder`, the
#       conditional-component `when`, `band_on`, the `lookup` step). Measured 2026-09-03: that
#       file contains ZERO references to `brand`.
#   Projecting at these two chokepoints reaches ALL of them, because every frontend reader AND
#   every frontend matcher consumes the one `items` array `get_rate_master_items` returns.
#
# TO ADD ANOTHER COLUMN
#   Add its name to `PROJECTED_ITEM_COLUMNS` below. That is the whole change.
#   NO config edit, NO migration, NO backfill, NO asset mint, NO second list to keep in step --
#   `api/boq/rate_master.py` reads THIS tuple, so there is exactly one definition. (That endpoint
#   already selects every item column, so its `fields` list needs nothing either; only a
#   brand-new database column would have to be added there as well.)
#   Then declare it on the category that wants it as an ordinary attribute definition with
#   `values_from: {"kind": "<its kind>", "attr": "<the column>"}` -- the same config line
#   `wire1_thickness_sqmm` and `conduit size_mm` already carry.
#
# TO UNDO
#   Delete `project_item_columns` and its two call sites (`_row_attributes` here, and the loop in
#   `get_rate_master_items`). Storage was NEVER touched, so nothing else needs reverting -- no
#   data to clean up, no rows to rewrite.
#
# ⚠️ THE INVARIANT THAT KEEPS THIS HONEST
#   NOTHING MAY READ A PROJECTED ITEM AND WRITE ITS `attributes` BACK. A write-back would PERSIST
#   the projection and recreate exactly the duplication option (A) was rejected for. Verified
#   2026-09-03 that no path does: `update_rate_master_item` re-reads `doc.attributes` from the
#   document, and `RateMasterDataViewer`'s add form builds `attributes` from `attrDefs`, which
#   excludes brand. Guarded by
#   `test_rate_master.TestBrandColumnProjection.test_bp_07_a_write_path_never_persists_the_projection`.
#
# ⚠️ WHAT WAS REJECTED, AND WHY -- recorded so neither is re-proposed by a reader who cannot see
#   the measurements (recon_brand_attribute_2026-09-03.md):
#     (A) WRITE brand into the stored `attributes` at upload time. REJECTED: it BREAKS THE CSV
#         ROUND TRIP. `csv_exporter._keys_for` derives attribute columns from the keys OBSERVED
#         in the items while `LEAD_COLUMNS` already contains `brand`, so one such item yields TWO
#         `brand` headers and `csv_importer.classify_columns` then refuses the whole file
#         ("Column 'brand' appears more than once") -- for the WHOLE discipline, because Mode B is
#         one file over all categories. It also reaches only NEWLY uploaded rows (0 of 1,367 live
#         rows carry `attributes.brand`), and it rests on a convention no code enforces
#         (`loader._validate_items` checks only that `attributes` is a dict).
#     (B) WIDEN the dropdown readers to a column whitelist. REJECTED as HALF-EXTENSIBLE: the
#         readers and the matchers are disjoint code (3 readers vs 13 matcher sites, not one
#         shared line), so it would ship a picker selecting a value no pipeline can match on --
#         worse than the status quo, which at least does not offer a control that lies.
#
# PRECEDENT -- why a DERIVED key is legitimate in a map whose other keys are stored:
#   `commit_pipeline._derive_attached_notes` ("DERIVED, not carried", owner-locked) does the same
#   thing for a node's `attached_notes`. A value recomputed from source on every read is exactly
#   what makes a historical row self-heal instead of needing a backfill.
# ══════════════════════════════════════════════════════════════════════════════════════════

# ⚠️ A WHITELIST, DELIBERATELY -- never widen this to "every column". `rate`, `item_uid`,
# `import_batch` and `source_row` are provenance and identity, NOT specifications; a config able
# to match on them could ask a question the catalogue has no business answering.
PROJECTED_ITEM_COLUMNS = ("brand",)


def project_item_columns(attributes, row):
    """PURE. Return a COPY of `attributes` with each `PROJECTED_ITEM_COLUMNS` value from `row`
    merged in. Two rules, both load-bearing:

      * A STORED attribute ALWAYS WINS -- a key already present is never overwritten. Nothing
        stores one today, but if anything ever does, the stored value is the authority and the
        projection must stay silent rather than mask it.
      * An ABSENT or BLANK column contributes NO KEY -- not `None`, not `""`. An item with no
        brand must be indistinguishable from one the projection never touched, or every reader's
        `v not in (None, "")` test would have to be duplicated at each call site.
    """
    out = dict(attributes)
    for col in PROJECTED_ITEM_COLUMNS:
        if col in out:
            continue  # STORED WINS
        value = row.get(col)
        if isinstance(value, str):
            value = value.strip()
        if value in (None, ""):
            continue  # no value -> no key
        out[col] = value
    return out


def _item_read_fields(*base):
    """The `fields` a master-item read needs: the caller's own, plus every projected column.
    Resolved at CALL time from `PROJECTED_ITEM_COLUMNS`, so adding a name to that tuple is
    genuinely the only edit -- no `fields` list anywhere needs touching."""
    return list(base) + [c for c in PROJECTED_ITEM_COLUMNS if c not in base]


def _row_attributes(row):
    """A master-item row's attributes, parsed, with the projected columns merged in. The ONE
    parse used by all three readers below -- see the projection block above."""
    a = row["attributes"] if isinstance(row["attributes"], dict) else json.loads(row["attributes"] or "{}")
    return project_item_columns(a, row)


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
        fields=_item_read_fields("attributes"),
    )
    out = []
    seen = set()
    for r in rows:
        a = _row_attributes(r)
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
        fields=_item_read_fields("attributes"),
    )
    out, seen = [], set()
    for r in rows:
        a = _row_attributes(r)
        if not all(a.get(k) == v for k, v in where.items()):
            continue
        v = a.get(attr)
        if isinstance(v, str):
            v = v.strip()
        if v not in (None, "") and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def attributes_by_item(discipline, spec):
    """{item_name: attributes} for the `kind` rows matching `where` -- the `values_from_catalog`
    read, keeping the WHOLE attribute bag instead of one attribute's distinct values.

    Added for the TPN post-match pole correction, which needs a pick's `device` / `pole` /
    `amp_a` / `curve` in order to find its four-pole sibling. Same live-read shape, same honest
    empty on a malformed spec. A duplicate item name keeps the FIRST row, which matches
    `component_ref`'s own requirement that a ref resolve UNIQUELY -- a name that is not unique is
    not a usable key, and the correction's own sibling test refuses a non-unique answer anyway."""
    if not discipline or not isinstance(spec, dict):
        return {}
    kind = spec.get("kind")
    if not kind:
        return {}
    where = spec.get("where") or {}
    rows = frappe.get_all(
        _MASTER_ITEM,
        filters={"discipline": discipline, "kind": kind, "active": 1},
        fields=_item_read_fields("attributes"),
    )
    out = {}
    for r in rows:
        a = _row_attributes(r)
        if not all(a.get(k) == v for k, v in where.items()):
            continue
        name = a.get("item")
        if isinstance(name, str):
            name = name.strip()
        if name and name not in out:
            out[name] = a
    return out


def breaker_catalog_for(cfg, discipline):
    """The composite's REPEATABLE slot catalogue, with full attributes -- the rows the TPN pole
    correction may re-select within.

    Read from `cfg.composite_slots.repeatable.values_from`, never hardcoded, so no category id or
    catalog kind appears in this module's correction path. A config with no repeatable slot group
    yields {}, and the correction is then inert by construction."""
    cs = (cfg or {}).get("composite_slots")
    if not isinstance(cs, dict):
        return {}
    rep = cs.get("repeatable")
    if not isinstance(rep, dict):
        return {}
    return attributes_by_item(discipline, rep.get("values_from") or {})


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
        # SLICE 5 (B1, owner-authorised option b) -- THREE FLAGS, THREE DISTINCT MEANINGS. Do not
        # collapse them; each hides the attribute from a DIFFERENT surface, and the reason one field
        # needed a third flag is that the other two each moved a surface it must not move:
        #   `extract: false`  -> not asked of the MODEL. Still on the pricing panel, still on the
        #                        Rate Master Derivation configurator.
        #   `selector: false` -> not asked of the model AND removed from the DERIVATION configurator
        #                        (RateMasterDerivation filters `d.selector !== false`). Brand carries it.
        #   `panel: false`    -> hidden from the PRICING PANEL only; still extracted, still derivable.
        # `blank_qty` is the first `extract: false`: the pipeline ARBITRATES it against the plate's
        # computed spare, so asking the model for it produced quantities for blankers no row ever
        # named -- but it must stay visible and editable on both screens, which rules `selector` out.
        if d.get("extract") is False:
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
# ── EA-7: the tiered, labelled payload ──────────────────────────────────────────────
# The FULL tier reaches self (distance 0), the immediate parent (1) and the grandparent (2).
# The great-grandparent (3) and everything above it is LEAN. Owner-locked 2026-08-04; this
# SUPERSEDES the earlier banked note that put the boundary after the immediate parent.
_FULL_TIER_MAX_DISTANCE = 2

# distance -> the human-legible relation label. Beyond the named ones the numeric `distance`
# carries the provenance, so nothing is lost by falling back to a generic label.
_RELATION_BY_DISTANCE = {0: "self", 1: "parent", 2: "grandparent", 3: "great_grandparent"}


def _as_list(raw):
    """A raw JSON note field -> a flat list of non-empty strings. Mirrors the shapes
    context_builder._notes_text tolerates (list | dict | str | already-parsed), but keeps the
    values SEPARATE instead of joining them."""
    if not raw:
        return []
    v = raw
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            s = v.strip()
            return [s] if s else []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, dict):
        out = []
        for val in v.values():
            if isinstance(val, list):
                out += [str(x).strip() for x in val if str(x).strip()]
            elif str(val).strip():
                out.append(str(val).strip())
        return out
    s = str(v).strip()
    return [s] if s else []


def _as_labelled_map(raw):
    """append_notes_raw is {column-header: value}. Keeping it as a MAP preserves which COLUMN each
    appended note came from -- free extra provenance, and exactly the machine-legible labelling
    EA-7 is for. Non-dict shapes degrade to a list under a generic key."""
    if not raw:
        return {}
    v = raw
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            s = v.strip()
            return {"note": s} if s else {}
    if isinstance(v, dict):
        return {str(k): str(x).strip() for k, x in v.items() if str(x).strip()}
    vals = _as_list(v)
    return {"note": " | ".join(vals)} if vals else {}


def _note_block(own_raw, attached_raw, appended_raw, tier):
    """The labelled note block for one node, honouring the tier.

    FULL -> own + appended + attached. LEAN -> appended ONLY.

    The flat `notes` field rides the FULL tier with `attached`: it is node-borne body text of the
    same class, not a per-column append, and the owner's lean-tier wording is "description +
    appended notes ONLY" -- which excludes everything it does not name. Measured inert on the whole
    cert corpus (0 of 1,714 nodes across the five sheets carry a flat note; 337 of 35,734 DB-wide),
    so the reading is cheap to revisit if the owner rules otherwise.

    An EMPTY kind is OMITTED rather than sent as an empty container: absence is then unambiguous
    and the payload does not pay for silence.
    """
    block = {}
    appended = _as_labelled_map(appended_raw)
    if appended:
        block["appended"] = appended
    if tier == "full":
        own = _as_list(own_raw)
        if own:
            block["own"] = own
        attached = _as_list(attached_raw)
        if attached:
            block["attached"] = attached
    return block


def _ai_item(row):
    """One extraction payload item: {id, description, notes, ancestor_chain} -- the SAME four keys
    as before, with LABELLED values.

    `notes` is no longer one pipe-joined string. It is a map keyed by NOTE KIND (own / attached /
    appended), so the model -- and a later weighting slice -- can tell which text is the row's own
    body, which was attached to it, and which column an appended note came from. `appended` stays a
    {column-header: value} map so the column itself is part of the provenance.

    `ancestor_chain` is no longer a flat list of description strings. Each entry is a labelled
    object carrying `relation` + `distance` + `tier` alongside its description and its own note
    block, so every text fragment in the payload says WHOSE it is and WHAT KIND it is. Root-first,
    unchanged. The sheet name stays the outermost entry (it is a label, not a node: no distance,
    no tier, no notes).

    PER-ROW, NEVER DEDUPED (owner-locked after measurement): a shared ancestor's text is repeated
    in full on every row beneath it. 86-94% of ancestor text on real sheets is repetition and that
    cost is accepted in exchange for each row being independently readable inline.
    """
    anc = row.get("ancestors") or []
    n = len(anc)
    chain = [{"relation": "sheet", "description": str(row.get("sheet_name") or "")}]
    for i, a in enumerate(anc):  # root-first
        distance = n - i  # 1 == the immediate parent
        tier = "full" if distance <= _FULL_TIER_MAX_DISTANCE else "lean"
        entry = {
            "relation": _RELATION_BY_DISTANCE.get(distance, "ancestor"),
            "distance": distance,
            "tier": tier,
            "node_type": a.get("node_type") or "",
            "description": a.get("description") or "",
        }
        block = _note_block(a.get("own_notes_raw"), a.get("attached_notes"),
                            a.get("append_notes_raw"), tier)
        if block:
            entry["notes"] = block
        chain.append(entry)

    item = {
        "id": row["excel_row"],
        "description": row.get("description") or "",
        "ancestor_chain": chain,
    }
    self_block = _note_block(row.get("own_notes_raw"), row.get("attached_notes"),
                             row.get("append_notes_raw"), "full")
    if self_block:
        item["notes"] = self_block
    return item


# The one paragraph that tells the model how to read the labels. It lives HERE, in the wrapper,
# following the established convention in _extract_batch (SYNONYMS / DEFAULTS / ESTIMATOR_RULES /
# SLOT_SPEC are all appended the same way) -- the .md prompt ASSETS stay untouched.
_ROW_CONTEXT_SHAPE_GUIDANCE = (
    "\n\nROW_CONTEXT_SHAPE: each row in ROWS carries labelled provenance. `description` is the "
    "row's own text. `notes` (when present) is keyed by note KIND: `own` = the row's own note "
    "body, `attached` = notes attached to that row, `appended` = a {column-header: value} map of "
    "per-column appended notes. `ancestor_chain` runs OUTERMOST FIRST and each entry carries "
    "`relation` (sheet / great_grandparent / grandparent / parent), `distance` (1 = the immediate "
    "parent), `tier`, `description` and its own `notes` block in the same kind-keyed shape. "
    "Entries with tier `full` (distance 1-2) carry every note kind; entries with tier `lean` "
    "(distance 3 and above) deliberately carry appended notes only, so absent `own`/`attached` "
    "there means NOT SUPPLIED, not absent in the source. A nearer ancestor's text describes this "
    "row more specifically than a farther one's.\n"
)


# ── PIECE 4: the POINT TYPE matcher (deterministic code, never the model) ───────────────────────
# Owner: "if the line item mentions only Primary/ first or any synonym then length will be 15 mts.
# if it mentions only secondary/looping/ second/ third etc points then length will be 5 mts" --
# "that formula is valid if the line item does not mention the type of points or includes both type
# of points", and "in case of confusion default to the formula".
#
# TWO MECHANISMS, AND NEITHER IS SUFFICIENT ALONE:
#
#  (a) THE PREPOSITION GUARD. The type a row IS sits bare at the head of the phrase ("Secondary
#      Light / Fan Point ..."); the type it merely REFERS TO follows a linking verb ("looped TO
#      Primary Point", "controlled FROM DB"). Without it, the owner's decisive row -- "Secondary ...
#      Looped to Primary Point", which he ruled IS a secondary point -- reads as naming both types
#      and falls to the formula. Measured on the live payload corpus: 78 referential rows, 78
#      resolved SECONDARY, 0 read as primary.
#      ⚠️ HONEST LIMIT: the verb list is drawn FROM this corpus. A BoQ using a verb outside it slips
#      through and is read as the wrong type. The owner allowed a close match; the residual error is
#      bounded by the verb list, not by the grammar.
#
#  (b) NEAREST WINS. Only the SHALLOWEST distance carrying any type token votes. The same decisive
#      row carries "Secondary" at distance 1 and, at distance 2, a note naming BOTH types ("Switch
#      board to Primary & Secondary Point wiring shall be ..."). A flat scan over the whole chain
#      reads BOTH and falls to the formula; nearest-wins gives 5 m, as ruled.
#
# ⚠️ IT READS THE SAME PAYLOAD `_ai_item` BUILDS -- never raw node text and never a chain assembled
# here. A match against a reconstruction measures the reconstruction; that error was made and caught
# on 2026-08-23.
#
# Returns "Primary" | "Secondary" | None. None means BOTH types, NEITHER type, or confusion -- and
# the config's map_attribute skips on it, leaving the existing formula standing untouched.
# The attributes CODE supplies rather than the model. A config declaring one of these gets it
# filled deterministically after the model returns; a config that does not is untouched.
_CODE_SUPPLIED_ATTRS = {"point_type"}
# ⚠️ `\bfirst\s+(?:\w+\s+){0,1}point` TOLERATES ONE INTERVENING WORD BY OWNER RULING (2026-09-04).
# The bare `\bfirst\s+point` missed `first switch point` over that single word, and that near-miss is
# HALF of the Olympia defect: the preamble sentence names BOTH `first switch point` (primary) and
# `looping` (secondary), so it should have fallen to the formula -- but only the secondary token
# matched, so the row read Secondary and took 5 m.
# ⚠️ THE BOUND IS {0,1} AND IT IS MEASURED, NOT GUESSED: across 30,184 line items / 711 committed
# sheets / 178 BoQs, `{0,1}` and `{0,2}` produce the IDENTICAL 208 new matches -- no row anywhere has
# two intervening words. `{0,2}` therefore widens the blast radius for nothing. Do not loosen it
# without re-measuring.
_PT_PRIMARY = [r"\bprimary\b", r"\bfirst\s+(?:\w+\s+){0,1}point", r"first\s+light\s+point",
               r"\b1st\s+point"]
# ⚠️ RATIONALE CORRECTED 2026-09-04 -- THE LIST IS UNCHANGED, THE REASONING WAS WRONG.
# This comment used to argue that the one-word form does not carry the meaning ("the two-word form
# carries the meaning; the one-word form does not"), and it argued it using two `looping` sentences
# -- while `\blooping\b` sat in the list below, matching both of its own counter-examples. The
# rationale contradicted the code it was explaining, and a reader trusting it would have concluded
# `looping` was excluded when it is not.
#
# THE OWNER'S RULING IS THE OPPOSITE AND IT GOVERNS: "looping point is secondary point" (2026-09-04,
# restating 2026-09-01's "loop point is secondary point"). `looping` / `looped` / `loop point` /
# `loop in` are all SECONDARY tokens and stay in the list.
#
# What the two prose examples ("the wiring shall be done in complete looping in system", "only
# looping is allowed in terminal blocks") actually show is a DIFFERENT problem: a METHOD sentence
# describing HOW the wiring is run can be read as WHAT KIND of point the row is. That is real -- it
# is precisely the Olympia defect, where an ancestor note's "...and then looping between the points"
# decided the type of five line items that named no type at all. But the answer is NOT to weaken this
# list. It is the ROW-SHAPE RULES in `point_type_of`: a row whose own description carries the
# point-set structure settles its own type and never consults the ancestor. See the two shape
# patterns below.
#
# ⚠️ `_PT_SECONDARY` IS NOT EDITABLE. Bare `loop` remains deliberately ABSENT (a genuinely weaker
# signal than `looping`), and nothing here may be added or removed without an owner ruling.
_PT_SECONDARY = [r"\bsecondary\b", r"\blooping\b", r"\blooped\b", r"\bsecond\s+point",
                 r"\bthird\b", r"\b3rd\b", r"loop\s+in", r"\bloop\s+point"]
_PT_REFERENTIAL = re.compile(
    r"(looped|loop(?:ing)?|controlled|extended|tapped|connected|drawn|fed)"
    r"\s+(?:to|from|with|off)\s+(?:the\s+)?(primary|first|1st)", re.I)

# ── THE ROW-SHAPE RULES (owner ruling 2026-09-04) ───────────────────────────────────────────────
# THE UNIFYING IDEA, and it is what makes these one rule rather than two special cases:
# COUNT THE POINTS THE ROW COVERS AND PRICE EACH BY ITS TYPE. A row covering n points names one
# primary (the first) and n-1 secondaries looped off it -- which is exactly `15 + (n-1) * 5`. The
# formula was never a special case; it IS the both-types answer. So a row whose own description
# carries a point-set structure has BOTH types by construction and must resolve to None, letting the
# config's `derive_attribute` compute the formula.
#
# Owner: "the structure ofthe actual line items x no of ligh/fan/anything else points controlled by
# Y type switch has both primary and secondary and should be treated as such" and "X no of y type
# points. Y canbe many things and not just lights."
#
# ⚠️ STRUCTURAL, NEVER A FIXTURE LIST. Neither pattern names light, fan, sensor, AC or any other
# fixture -- they key on a COUNT, the word `point(s)`, and (for the first) the verb `controlled`.
# A fixture list would go stale on the first BoQ using a word nobody thought of, and the owner ruled
# the structure explicitly. `test_shape_patterns_name_no_fixture` fails if a fixture word appears.
# ⚠️ THE CORPUS CANNOT PROVE THE CROSS-FIXTURE PROPERTY: measured over 30,184 line items, the word
# before `point(s)` in this shape is `light` (143) and `1light` (2) and NOTHING ELSE. The
# two-fixture-family limit is a fact about the data, not about the pattern; the requirement to
# demonstrate ten fixture types was WITHDRAWN by the owner as unsatisfiable.

# (1) THE SWITCH-CLAUSE SHAPE: a COUNT of points CONTROLLED BY a switch.
#     Reaches 23 of the 30 known-affected rows, including both `BOQ-26-00019` production ladders and
#     all five Olympia rows. Measured: moves 0 of the 244 self-determined rows and 0 of the 309
#     already-correct formula rows.
_PT_SHAPE_SWITCH = re.compile(r"\d[^.]{0,30}?\bpoints?\b[^.]{0,40}?\bcontrolled\b", re.I)

# (2) THE COUNT-ONLY SHAPE: a count of points with NO switch clause ("Upto 10 Light Points").
#     Owner: "this shape is also both primary and secondary and should be evaluated by the formula".
#     ⚠️ THE WHOLE-DESCRIPTION ANCHOR IS WHAT MAKES THIS SAFE, AND IT WAS MEASURED, NOT ARGUED.
#     This pattern is far broader than (1) and the corpus was asked three questions before it was
#     written: unanchored (`\d+\s+(?:\w+\s+){0,2}points?` anywhere in the line) changes 20 rows and
#     leaks into switch-clause rows that (1) already owns; restricting to the PLURAL alone still
#     changes 16; anchoring to the WHOLE description changes exactly 3 -- the three target rows,
#     with zero collateral. Requiring the literal lead-in `upto` was rejected for the same reason a
#     fixture list is: it enumerates a word, so the lead-in is OPTIONAL here.
_PT_SHAPE_COUNT_ONLY = re.compile(
    r"^\W*(?:up\s*to\s+|upto\s+|max(?:imum)?\s+)?"
    r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)"
    r"\s+(?:\w+\s+){0,2}points?\W*$", re.I)


def _pt_row_shape_is_both_types(description):
    """True when the row's OWN description carries a point-set structure -- a count of points, with
    or without a switch clause -- and therefore covers a primary AND its secondaries."""
    text = description or ""
    return bool(_PT_SHAPE_SWITCH.search(text) or _PT_SHAPE_COUNT_ONLY.search(text))


# ── THE POINT COUNT (owner ruling 2026-09-05) ───────────────────────────────────────────────────
# ⚠️ THE UNIT GUARD IS THE WHOLE DESIGN OF THIS EXTRACTOR, AND IT WAS MEASURED INTO EXISTENCE.
# The obvious pattern -- a number within a couple of words of `point` -- reads "One 16 Amps point
# per circuit" as SIXTEEN POINTS. It is an AMPERAGE. That false parse is not hypothetical: it is
# what the first census reported, and it made a rule look like it had a population when it did not.
# So a unit word may never sit between the number and `point`; every word in the gap must be a
# non-unit word. Measured over 30,184 line items: the guard rejects both amperage rows and keeps
# every genuine one (`3 light point` -> 3, `Upto 10 Light Points` -> 10, `Three (3) ...` -> 3).
_PT_COUNT_UNITS = (r"amp|amps|a|w|watt|watts|sqmm|sq|mm|dia|core|cores|r|c|x|kw|va|kva|no|nos|"
                   r"pole|way")
_PT_COUNT_WORDS = {w: i + 1 for i, w in enumerate(
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty".split())}
_PT_COUNT_WORDS["thirty"] = 30
_PT_COUNT_DIGIT = re.compile(
    r"(\d+)\s+(?:(?!(?:" + _PT_COUNT_UNITS + r")\b)\w+\s+){0,2}?points?\b", re.I)
_PT_COUNT_WORD = re.compile(
    r"\b(" + "|".join(_PT_COUNT_WORDS) + r")\b\s*(?:\([^)]*\))?\s*"
    r"(?:(?!(?:" + _PT_COUNT_UNITS + r")\b)\w+\s+){0,2}?points?\b", re.I)


def _stated(row_out, attr):
    """True when `row_out` already carries a real value for `attr` -- i.e. the model answered it.
    A code-supplied derivation must never overwrite one."""
    cell = row_out.get(attr)
    return isinstance(cell, dict) and cell.get("value") not in (None, "")


def point_count_of(description):
    """How many points the row's OWN description says it covers, or None. Digits first, then number
    words -- a sheet writes either ("12 light point", "Three (3) light points")."""
    text = description or ""
    m = _PT_COUNT_DIGIT.search(text)
    if m:
        return int(m.group(1))
    m = _PT_COUNT_WORD.search(text)
    return _PT_COUNT_WORDS.get(m.group(1).lower()) if m else None


def secondary_length_m(item):
    """THE n x 5 MECHANISM (owner ruling 2026-09-05: "ok. still buid the mechanism").

    A row that names ONLY secondary points in its OWN text and states a count of n covers n
    secondaries, so its circuit length is n x 5 -- not the flat 5 every secondary row takes today.
    Returns the length, or None when the rule does not apply and the flat 5 stands.

    ⚠️ ITS POPULATION IS CURRENTLY ZERO AND THAT IS REPORTED, NOT HIDDEN. Measured over 30,184 line
    items: no point_wiring row matches. The two rows an earlier census offered were the amperage
    false-parses the unit guard now rejects. It is built because the owner ruled it built -- so the
    next such row is right the first time -- and it is pinned by a SYNTHETIC test precisely because
    the corpus does not exercise it.
    """
    n = point_count_of(item.get("description"))
    if n is None or n <= 1:
        return None
    return n * 5 if _pt_own_types(item) == {"S"} else None


def _pt_own_types(item):
    """The type letters the row's OWN text (distance 0) names -- {"P"}, {"S"}, both, or empty."""
    for distance, text in _pt_layers(item):
        if distance != 0 or not text:
            continue
        got = set()
        for rx in _PT_PRIMARY:
            for m in re.finditer(rx, text, re.I):
                seg = text[max(0, m.start() - 90):m.end() + 90]
                if not _PT_REFERENTIAL.search(seg):
                    got.add("P")
        for rx in _PT_SECONDARY:
            if re.search(rx, text, re.I):
                got.add("S")
        return got
    return set()


def _pt_note_text(block):
    """Every note kind of one payload note block, flattened. Mirrors `_note_block`'s shapes."""
    if not isinstance(block, dict):
        return ""
    out = []
    for kind in ("own", "attached"):
        v = block.get(kind)
        if isinstance(v, list):
            out.extend(str(x) for x in v)
        elif v:
            out.append(str(v))
    ap = block.get("appended")
    if isinstance(ap, dict):
        out.extend(str(x) for x in ap.values())
    elif ap:
        out.append(str(ap))
    return " ".join(out)


def _pt_layers(item):
    """(distance, text) for one payload item. distance 0 = the row itself; the sheet label is NOT a
    node and never votes."""
    layers = [(0, (item.get("description") or "") + " " + _pt_note_text(item.get("notes")))]
    for e in item.get("ancestor_chain") or []:
        if e.get("relation") == "sheet":
            continue
        layers.append((e.get("distance"),
                       (e.get("description") or "") + " " + _pt_note_text(e.get("notes"))))
    return layers


def point_type_of(item):
    """The point type this row IS, read from the payload item. See the block comment above."""
    by_distance = {}
    for distance, text in _pt_layers(item):
        if not text or not text.strip() or distance is None:
            continue
        for rx in _PT_PRIMARY:
            for m in re.finditer(rx, text, re.I):
                seg = text[max(0, m.start() - 90):m.end() + 90]
                # THE GUARD: a primary token reached through a linking verb is a REFERENCE to another
                # point, not this row's own type. It does not vote.
                if _PT_REFERENTIAL.search(seg):
                    continue
                by_distance.setdefault(distance, set()).add("P")
        for rx in _PT_SECONDARY:
            if re.search(rx, text, re.I):
                by_distance.setdefault(distance, set()).add("S")
    # ⚠️ THE ROW-SHAPE RULES SIT EXACTLY HERE, AND THE POSITION IS THE WHOLE DESIGN.
    #
    # AFTER the scan, so `0 in by_distance` is available and means "the row's own text named a type".
    # BEFORE nearest-wins, so the row's own STRUCTURE outranks any ancestor -- which is the point:
    # Olympia's five line items name no type, and an ancestor note's "looping" was deciding for them.
    #
    # `0 not in by_distance` is the PRECEDENCE GUARD and it is a STRUCTURAL guarantee, not a measured
    # one: the 244 self-determined rows are BY DEFINITION the rows with a token at distance 0, so
    # this branch cannot reach them. A row saying "Secondary light points (loop points after
    # primary)" stays Secondary. Rows that already reach the formula with no token anywhere are
    # value-unchanged -- they returned None below and return None here.
    if 0 not in by_distance and _pt_row_shape_is_both_types(item.get("description")):
        return None                      # BOTH types by structure -> the formula stands
    # ⚠️ THE COUNT OUTRANKS THE TOKEN (owner ruling 2026-09-05). THIS IS NOT A WORKAROUND.
    # A row covering n > 1 points genuinely HAS one primary and n-1 secondaries -- that is exactly
    # what `15 + (n-1) * 5` computes. So a stated count of more than one is a FACT ABOUT THE ROW
    # that contradicts any single-type reading of it, and it wins. It is the same idea as the two
    # shape rules above: the row's own structure outranks a token.
    #
    # ⚠️ IT DELIBERATELY REACHES ROWS THAT NAME THEIR OWN TYPE -- unlike the shape rules, which are
    # fenced out by `0 not in by_distance`. That fence is what protected the self-determined rows,
    # and it is also what left 57 of them wrong: "12 light point controlled by MCB ... Point wiring
    # will start from First Light point" read as ONE primary at a flat 15 m, because a sentence
    # saying WHERE THE WIRING STARTS was taken for the row's type. The count is the evidence that
    # settles it.
    #
    # ⚠️ THE ORDERING WITH THE n x 5 MECHANISM IS LOAD-BEARING:
    #     count > 1 AND the row's own text names ONLY secondary -> stays Secondary, and
    #         `secondary_length_m` gives it n x 5. This branch must NOT swallow that population.
    #     count > 1 AND primary, or both, or neither -> None -> the formula.
    _count = point_count_of(item.get("description"))
    if _count is not None and _count > 1:
        if _pt_own_types(item) == {"S"}:
            return "Secondary"           # the n x 5 population -- left to `secondary_length_m`
        return None                      # one primary + (n-1) secondaries -> the formula
    if not by_distance:
        return None                      # NEITHER type named -> the formula stands
    votes = by_distance[min(by_distance)]  # NEAREST WINS
    if votes == {"P"}:
        return "Primary"
    if votes == {"S"}:
        return "Secondary"
    return None                          # BOTH types at the nearest level -> the formula stands


def _coerce_value(defn, raw, synonyms_for_attr=None):
    """The VALUE-ONLY contract, UNCHANGED. Every pre-capture caller keeps calling this and gets
    exactly what it got before.

    It is a thin delegation to `_coerce_value_ex`, which holds the one and only implementation --
    so "the value" and "the value plus why" can never drift apart. That structure is the point:
    the alternative (re-deriving the checks at the capture site to explain a None) is precisely the
    duplication this codebase has been bitten by three times, per the coercion-twin warnings.
    """
    return _coerce_value_ex(defn, raw, synonyms_for_attr)[0]


def _coerce_value_ex(defn, raw, synonyms_for_attr=None):
    """Coerce/validate one extracted value against its definition, returning `(value, reason)`.

    `reason` is one of the COERCE_* constants and is what makes a DROP visible as a drop: a raw
    non-null arriving with a coerced null is a value we discarded, and the reason says which of the
    checks discarded it. `COERCE_ABSENT` is NOT a failure -- it means the model returned null.

    The coercion rules themselves are byte-unchanged from the value-only version:
    choice -> must be an allowed
    value (else None; for an identity attribute the allowed values ARE the catalog); number -> a
    float/int (else None); number_choice -> a float/int that must also be a member of its NUMERIC
    domain (else None); null stays None.

    ⚠️ THIS IS ONE OF TWO PLACES AN ATTRIBUTE VALUE IS COERCED. The other is the frontend match
    coercion (`rateMasterStructure.coerceForMatch`), which turns a value into a catalog match key. A
    NEW ATTRIBUTE TYPE MUST BE TAUGHT TO BOTH: CP2 added `number_choice`, taught the frontend and the
    config validator, and missed this function -- so every core and thickness the model returned was
    nulled here and no point_wiring row could price. Both sites compare numerically for
    `number_choice`; neither may compare it by string.

    EA-DIFF: `synonyms_for_attr` ({variant: canonical}) maps a returned variant to its canonical BEFORE
    the choice check -- defence in depth, so a model that echoes the row's variant (e.g. GI) still
    lands on the canonical (MS) even though the .md prompt was told to map it. Price-interchangeable
    per business rule."""
    if raw is None:
        return None, COERCE_ABSENT
    # EA-4a-r: the "None" sentinel is POSITIVE ABSENCE -- preserve it verbatim for an allow_none def (a
    # number one included, where float("None") would raise and drop the signal). Distinct from null/blank.
    if defn.get("allow_none") and str(raw) == "None":
        return "None", COERCE_OK_NONE
    # NUMERIC types: `number` (a free numeric input) and `number_choice` (a DROPDOWN that produces a
    # NUMBER -- CP2). Both store a number; only number_choice carries a domain to check.
    if defn["type"] in ("number", "number_choice"):
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return None, COERCE_NOT_A_NUMBER
        v = int(v) if v == int(v) else v
        if defn["type"] == "number_choice":
            # ⚠️ MEMBERSHIP MUST COMPARE LIKE WITH LIKE. The domain is resolved from the catalog, so
            # its members are FLOATS, while the model may answer 1, "1", 1.0 or "1.0" -- all the same
            # value. Comparing `str(raw)` against floats (the pre-fix choice-branch path) NEVER
            # matched, so every correct answer was discarded and no point_wiring row could price.
            # Compare numerically on BOTH sides; a value genuinely outside the domain is still
            # REJECTED -- this is like-for-like comparison, not abandoning the check.
            allowed = defn.get("values")
            if allowed:
                domain = []
                for a in allowed:
                    try:
                        domain.append(float(a))
                    except (TypeError, ValueError):
                        continue  # a non-numeric member (e.g. a "None" entry) never matches a number
                if domain and float(v) not in domain:
                    return None, COERCE_OUTSIDE_DOMAIN
        return v, COERCE_OK
    # choice (incl. the identity catalog)
    sval = str(raw)
    synonym_applied = False
    if synonyms_for_attr and sval in synonyms_for_attr:
        sval = str(synonyms_for_attr[sval])  # variant -> canonical, before the allowed-values check
        synonym_applied = True
    allowed = defn.get("values")
    if allowed and sval not in allowed:
        # NOTE: a "synonym miss" is NOT a separate branch in this function -- an unmapped variant
        # simply reaches the allowed-values check and fails it here. Whether a synonym WAS applied
        # is reported through COERCE_OK_SYNONYM on the success path.
        return None, COERCE_NOT_ALLOWED
    return sval, (COERCE_OK_SYNONYM if synonym_applied else COERCE_OK)


def scrub_unpaired_slot_defaults(row_out, defaults):
    """SLICE 5 (B2 / R-B) -- drop a quantity whose paired item slot came back positively absent.

    PURE apart from mutating the `row_out` it is handed (the same dict `_extract_batch` is
    assembling). Returns the list of attribute ids scrubbed, so the caller can record them.

    ⚠️ THE PROMPT SENTENCE IS GUIDANCE; THIS IS THE ENFORCEMENT. The phantom quantities it removes
    were produced by a model following default guidance, so a second instruction to the same model
    would be another thing to hope for rather than a guarantee. Measured: 84 across the live corpus,
    every one of them the value 1.

    ⚠️ IT KEYS ON THE "None" SENTINEL, NOT ON "not named", AND THE DIFFERENCE IS LOAD-BEARING.
    "None" is POSITIVE ABSENCE -- the row carries no such component. BLANK is "unknown, the pipeline
    will work it out". Scrubbing blanks too would clear `plate_qty` on every row whose plate the
    LADDER computes -- 94 of 122 live rows -- and a null qty makes `component_ref` refuse the WHOLE
    pipeline, so those rows would stop pricing altogether. Absent slot => no component => no
    quantity; unknown slot => leave the default alone.

    It drops the value whatever its provenance, not only a `defaulted: true` one: a quantity for a
    component the row says is not there is meaningless however it arose, and that is the same
    statement `disables_when_none` already makes on the panel.
    """
    scrubbed = []
    if not defaults:
        return scrubbed
    for aid, spec in defaults.items():
        if not isinstance(spec, dict):
            continue
        pair = spec.get("requires_named")
        if not pair or aid not in row_out:
            continue
        if (row_out.get(pair) or {}).get("value") != _NONE_SENTINEL:
            continue
        if row_out[aid].get("value") is None:
            continue
        row_out[aid]["value"] = None
        row_out[aid].pop("defaulted", None)
        scrubbed.append(aid)
    return scrubbed


def force_absent_dependents(row_out, absent_rules):
    """PW-CIRCUIT-STRETCH -- a component the row declares ABSENT has an absent SPECIFICATION.

    PURE apart from mutating the `row_out` it is handed, and it returns the ids it filled so the
    caller can record them -- the same shape as `scrub_unpaired_slot_defaults` directly above.

    ⚠️ THE PROMPT SENTENCE IS GUIDANCE; THIS IS THE ENFORCEMENT. `extraction_none_guidance` already
    tells the model that a component the bill does not carry is "None", and the model obeys it on
    most rows and not on all: measured on the 251-row point_wiring corpus, 137 rows answered
    `circuit_wire_included = No` AND returned "None" for the six spec fields, while 22 answered
    "No" and left the spec BLANK. A blank panel-visible field refuses the whole row, so those 22
    stopped pricing for no substantive reason -- the row had already said there is no such wire.
    The owner's field shape is explicit (`No` / `None` x6 / `0`); this makes it true by construction.

    ⚠️ IT FILLS BLANKS ONLY, AND NEVER OVERWRITES A STATED VALUE. A row answering "No" while also
    naming a real gauge is CONTRADICTING itself, and discarding the gauge would destroy the evidence
    of that. Leaving it costs nothing: the pipeline zeroes the quantity from the same controller, so
    such a row is not charged either way -- but the contradiction stays visible on the panel.

    ⚠️ CONFIG-DRIVEN, NAMING NO CATEGORY (the HV-10 lesson). A definition opts in by declaring
    `absent_when_value` + `absent_dependents`; a config that declares neither yields no rules and
    this function is inert -- which is every category but point_wiring today.
    """
    forced = []
    if not absent_rules:
        return forced
    for controller, (absent_value, dependents) in absent_rules.items():
        cell = row_out.get(controller) or {}
        if cell.get("value") != absent_value:
            continue
        for dep in dependents:
            cur = (row_out.get(dep) or {}).get("value")
            if cur is not None and cur != "":
                continue                      # STATED -- never overwritten, see above
            row_out[dep] = {"value": _NONE_SENTINEL, "confidence": cell.get("confidence")}
            forced.append(dep)
    return forced


def absent_dependent_rules(cfg):
    """{controller_id: (absent_value, [dependent ids])} for a config, or {} when it declares none."""
    out = {}
    for d in (cfg or {}).get("attribute_definitions") or []:
        val, deps = d.get("absent_when_value"), d.get("absent_dependents")
        if val is None or not isinstance(deps, list) or not deps:
            continue
        out[d["id"]] = (val, [x for x in deps if isinstance(x, str) and x])
    return out


# -- THE CONDUCTOR FLOOR (slice: SLICE B v4) --------------------------------------------
#
# ⚠️ THE PROMPT SENTENCE IS GUIDANCE; THIS IS THE ENFORCEMENT -- and here that doctrine is a
# CORRECTION, not a new idea. The standing rule on this project is that the MODEL READS FACTS and
# every substitution, ladder and conversion lives in deterministic code or config. The conductor
# floor is a SUBSTITUTION. It was written as prose inside R9 and should never have been.
#
# THE COST OF HAVING IT IN THE PROMPT, MEASURED TWICE IN TWO DAYS. Every `rules` entry is injected
# into ONE `ESTIMATOR_RULES` block, so a phrase in one rule is visible to every other question the
# payload asks:
#   * rewriting R12's conduit example flipped R13's circuit verdict on two rows (2026-09-03);
#   * extending R9's floor to NAME the circuit wires -- the only way prose could reach them --
#     moved R13's `circuit_wire_included` on BOQ-26-00200 r11 (Yes -> Yes -> No across three runs).
# Arithmetic in a shared prompt block is the cause, not the symptom. Moving it here removes the
# pressure entirely: R9 goes back to teaching how to READ a wire spec, and says nothing about totals.
#
# THE RULE (owner, 2026-09-03), applied to each declared GROUP independently:
#   conductors = core x runs, summed across the wires that EXIST
#   >= 3            -> TAKE WHAT THE DOCUMENT STATES. Nothing is ever reduced. A FLOOR, not a cap.
#   single-core     -> raise THAT WIRE'S RUNS to three. NEVER add a second wire.
#   two single-core -> raise the BIGGER wire's runs.
#   multi-core      -> keep its cores and runs; ADD a second wire, 1 core, SAME thickness.
#
# ⚠️ `3 core, 1 run` IS ALREADY THREE CONDUCTORS AND MUST NOT MOVE. That was the defect in the first
# formulation of this rule, which counted RUNS: on the 31 corpus rows reading `3 core, 1 run` it
# would have bought NINE conductors, and on 5 rows the document states as three-phase it would have
# HALVED the copper.
#
# ⚠️ A WIRE WHOSE THICKNESS IS "None" DOES NOT EXIST AND CONTRIBUTES NOTHING. This is the trap in
# this data: an absent wire still carries the MIRRORED DEFAULT `runs = 1`, so a naive sum reports
# 3 + 1 = 4 for a row that is already three conductors on one wire. Existence is the THICKNESS.
#
# ⚠️ CONFIG-DRIVEN, NAMING NO CATEGORY (the HV-10 lesson). A wire opts in by declaring
# `conductor_floor` on its THICKNESS definition -- the thickness IS the existence marker, so the
# block lives where the fact it depends on lives. A config declaring none yields no groups and this
# function is inert, which is every category but point_wiring today.
#
# ⚠️ IT SITS ON THE ATTRIBUTE DEFINITION, NEVER AT THE CONFIG'S TOP LEVEL. Top-level keys are
# allowlisted by `_KNOWN_CONFIG_KEYS` in `api/boq/rate_master.py`; attribute definitions are
# documented in that same validator as having NO key allowlist. So this ships with no backend change.

# The floor. Named rather than inlined so the three places that read it cannot drift apart.
_CONDUCTOR_FLOOR = 3


def _cf_num(cell, default=None):
    """The numeric value of a row_out cell, or `default`. "None" is the ABSENCE sentinel, not a number."""
    if not isinstance(cell, dict):
        return default
    v = cell.get("value")
    if v is None or v == "" or v == _NONE_SENTINEL:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f


def conductor_floor_groups(cfg):
    """{group_name: [(thickness_attr, core_attr, runs_attr), ...]} in DEFINITION ORDER, or {}.

    Definition order is load-bearing twice over: it decides which wire is "wire 1" when a second one
    has to be added, and it keeps the walk deterministic.
    """
    out = {}
    for d in (cfg or {}).get("attribute_definitions") or []:
        spec = d.get("conductor_floor")
        if not isinstance(spec, dict):
            continue
        group = spec.get("group")
        core, runs = spec.get("core_attr"), spec.get("runs_attr")
        if not (isinstance(group, str) and group
                and isinstance(core, str) and core
                and isinstance(runs, str) and runs):
            continue
        out.setdefault(group, []).append((d["id"], core, runs))
    return out


def apply_conductor_floor(row_out, groups):
    """Raise each declared group to `_CONDUCTOR_FLOOR` conductors. PURE apart from mutating the
    `row_out` it is handed; returns one record per group changed, the same shape as the correctors
    above.

    ⚠️ IT ONLY EVER RAISES. There is no branch that lowers a count, which is what makes the
    "nothing is ever reduced" ruling structural rather than a thing to remember.
    """
    changed = []
    if not row_out or not groups:
        return changed

    for group, wires in groups.items():
        present = []          # [(idx, thickness_attr, core_attr, runs_attr, thickness, core, runs)]
        for idx, (t_attr, c_attr, r_attr) in enumerate(wires):
            thickness = _cf_num(row_out.get(t_attr))
            if thickness is None:
                continue      # the wire DOES NOT EXIST -- its runs default is not a conductor
            present.append((idx, t_attr, c_attr, r_attr, thickness,
                            _cf_num(row_out.get(c_attr), 1) or 1,
                            _cf_num(row_out.get(r_attr), 1) or 1))
        if not present:
            continue          # no wire on this axis at all -- never invent one

        total = sum(c * r for (_i, _t, _c, _r, _th, c, r) in present)
        if total >= _CONDUCTOR_FLOOR:
            continue          # THE FLOOR. At or above, the document wins untouched.
        need = _CONDUCTOR_FLOOR - total

        # Prefer raising the RUNS of a SINGLE-CORE wire: its conductors move in steps of one, so it
        # can land exactly on three. The BIGGER one when there is a choice (owner's ruling); ties
        # fall to definition order, which is deterministic.
        singles = [w for w in present if w[5] == 1]
        if singles:
            target = max(singles, key=lambda w: (w[4], -w[0]))
            _i, _t, _c, r_attr, _th, _core, runs = target
            new_runs = runs + need
            row_out[r_attr] = {"value": new_runs,
                               "confidence": (row_out.get(r_attr) or {}).get("confidence")}
            changed.append({"group": group, "action": "runs", "attr": r_attr,
                            "from": runs, "to": new_runs, "conductors_before": total})
            continue

        # Every existing wire is MULTI-CORE, so no run count can land on three (a 2-core wire steps
        # 2, 4, 6...). Add a wire of ONE core at the SAME thickness, carrying exactly the shortfall.
        free = [w for w in wires if w[0] not in {p[1] for p in present}]
        if not free:
            continue          # both slots taken by multi-core wires -- leave it; the row is honest
        t_attr, c_attr, r_attr = free[0]
        donor = present[0]
        conf = (row_out.get(donor[1]) or {}).get("confidence")
        row_out[t_attr] = {"value": donor[4], "confidence": conf}
        row_out[c_attr] = {"value": 1, "confidence": conf}
        row_out[r_attr] = {"value": need, "confidence": conf}
        changed.append({"group": group, "action": "added_wire", "attr": t_attr,
                        "thickness": donor[4], "core": 1, "runs": need,
                        "conductors_before": total})
    return changed


# -- TPN post-match pole correction (slice: TPN POST-MATCH) -----------------------------
#
# THE DEFECT. The decomposition prompt's POLE line tells the model that TPN (and TP+N / TP+NL /
# TP+2N / TP+2NL) means FOUR pole. It is obeyed for the four compound tokens and NOT for the bare
# token "TPN", which the model resolves as the WORDS "Triple Pole and Neutral" -> three pole.
# Measured stable across five observations, and rewording was judged futile.
#
# THE PROMPT SENTENCE IS GUIDANCE; THIS IS THE ENFORCEMENT -- the same doctrine, and the same
# shape, as `scrub_unpaired_slot_defaults` directly above. A second instruction to the same model
# would be another thing to hope for.
#
# THE GUARD IS THE PICK, NOT A PARSE OF THE TEXT'S INTENT. The correction fires only when the
# model's chosen catalog row is itself a THREE-POLE MCB. That is what bounds it: measured on the
# live catalog, `MCB` is the ONLY device carrying both a TP row and an FP row (MCCB is FP-only;
# RCCB and RCBO are DP/FP only; DB shells and Enclosure Boxes carry no `device` at all), so this
# function is STRUCTURALLY unable to alter anything but the 8 TP-MCB rows. It can never touch a
# shell, an enclosure, or a residual-current device, whatever the row text says.
#
# SCOPE (owner ruling, 2026-08-23): POLE ON MCBs ONLY. A larger unchecked class exists and is
# measured -- `component_ref` constrains a slot on kind + item name + family alone, so `device`,
# `amp_a` and `curve` are stored on every catalog row and checked by nothing. The owner ruled
# "later if the team starts noticing higher error rates we will make th elarger fix". Do NOT
# generalise this mechanism to those attributes.

# The adjacency window, in INTERVENING WORDS, between a four-pole token and the device word.
# DERIVED FROM THE REAL CORPUS, not chosen a priori: the three genuinely mis-routed rows sit at
# gaps 0, 0 and 2; the nearest constructible false positive ("12 Way TPN DB ... with 32A TP MCB
# outgoings") sits at 6. Every value in 2..5 separates them; 3 is the midpoint, leaving one word
# of headroom above the widest real hit and three below the nearest miss.
_FOUR_POLE_ADJACENCY_WORDS = 3

# A word that turns an "MCB" mention into a BOARD NAME rather than a breaker: "TPN MCB DB" is a
# kind of distribution board, and its TPN is the BOARD's phase type, never a breaker's pole. Such
# an MCB is not a device anchor. Without this, a board named that way sits at gap 0 and NO window
# can separate it. Failing this test means NOT firing, which is the safe direction.
_BOARD_WORDS_AFTER_DEVICE = frozenset({"DB", "DBS", "DB'S", "MCBDB", "BOARD", "BOARDS", "DISTRIBUTION"})

_WORD_RE = re.compile(r"[A-Za-z0-9+']+")


def four_pole_tokens():
    """The four-pole vocabulary, READ from the shipped POLE line of the decomposition prompt --
    never duplicated here.

    READING IT IS THE POINT. The prompt tells the MODEL which spellings mean four pole; this
    function corrects the model when it disobeys. If the two lists could drift, a token added to
    the prompt would be silently uncorrected here -- precisely the failure this slice exists to
    fix, reintroduced one level down. The prompt line is the single source of truth and is NOT
    edited by this slice.

    Returns the tokens that map to FP, in the prompt's own longest-token-first order.
    """
    line = next(
        (ln for ln in _read_prompt(_DECOMPOSITION_PROMPT_PATH).splitlines()
         if ln.lstrip().startswith("- POLE")),
        None,
    )
    if not line or "In order:" not in line:
        return []
    out, seen = [], set()
    for clause in line.split("In order:", 1)[1].split(";"):
        if "-> FP" not in clause:
            continue
        for tok in re.findall(r'"([^"]+)"', clause.split("->")[0]):
            if tok not in seen:
                seen.add(tok)
                out.append(tok)
    return out


def _four_pole_re(tokens):
    """One alternation over the vocabulary. Whitespace in a token is elastic ("Four Pole" also
    matches "Four  Pole") and "+" tolerates spaces around it ("TP+N" also matches "TP + N"),
    because BoQ text spaces these inconsistently. The prompt's longest-token-first order is
    preserved, so "TP+2NL" can never be truncated to "TP+2N"."""
    if not tokens:
        return None
    parts = []
    for t in tokens:
        body = re.escape(t).replace(r"\+", r"\s*\+\s*").replace(r"\ ", r"\s+")
        parts.append("(?:%s)" % body)
    return re.compile("|".join(parts), re.I)


def _four_pole_near_device(fragment, four_pole_re, device, window):
    """True when `fragment` carries a four-pole token within `window` INTERVENING WORDS of a
    standalone `device` word that is not part of a board name.

    Tested PER FRAGMENT and never across a join: a row's description and each of its note lines
    are separate texts, and concatenating them would manufacture an adjacency the sheet never
    wrote (a description ending "...12 Way TPN DB" beside a note beginning "MCB 32A TP..." would
    read as "TPN DB MCB", gap 1)."""
    if four_pole_re is None or not fragment:
        return False
    words = [(m.group(0), m.start(), m.end()) for m in _WORD_RE.finditer(fragment)]
    anchors = []
    for i, (w, _s, _e) in enumerate(words):
        if w.upper() != device:
            continue
        nxt = words[i + 1][0].upper() if i + 1 < len(words) else ""
        if nxt in _BOARD_WORDS_AFTER_DEVICE:
            continue  # "MCB DB" names a board, not a breaker
        anchors.append(i)
    if not anchors:
        return False
    for m in four_pole_re.finditer(fragment):
        span = [i for i, (_w, ws, we) in enumerate(words) if ws < m.end() and we > m.start()]
        if not span:
            continue
        lo, hi = min(span), max(span)
        for d in anchors:
            if lo <= d <= hi:
                continue  # the device word lies inside the token itself
            gap = (d - hi - 1) if d > hi else (lo - d - 1)
            if gap <= window:
                return True
    return False


def row_own_text_fragments(row):
    """The row's OWN text, as SEPARATE fragments: its description, then each note line (own,
    attached, appended).

    THE ANCESTOR CHAIN IS DELIBERATELY EXCLUDED. An ancestor of a DB row is its board header, and
    a board header is exactly where "TPN" means the BOARD's phase type rather than a breaker's
    pole. Reading it here would turn the one context that must not fire into the one most likely
    to. All three measured mis-routed rows carry their four-pole token in the row's OWN text."""
    frags = []
    desc = row.get("description")
    if desc:
        frags.append(str(desc))
    frags.extend(_as_list(row.get("own_notes_raw")))
    frags.extend(_as_list(row.get("attached_notes")))
    frags.extend(_as_labelled_map(row.get("append_notes_raw")).values())
    return [f for f in frags if f]


def correct_four_pole_mcb_picks(row_out, row, pole_catalog, tokens=None):
    """Re-select a THREE-POLE MCB pick as its FOUR-POLE sibling when the row text says four pole.

    PURE apart from mutating the `row_out` it is handed (the same dict `_extract_batch` is
    assembling) -- the `scrub_unpaired_slot_defaults` shape. Returns a list of records
    {attr, from, to} for the caller to log, or the reason nothing was done.

    `pole_catalog` is {item_name: attributes} for the composite's breaker kind, supplied by the
    caller (the `values_from_catalog` shape) so this stays free of DB access and of any category
    id.

    SWAP, NEVER BLANK (decided). A blanked slot makes `component_ref` match zero rows, which
    refuses the WHOLE pipeline -- turning a slightly-low price into a dead row. A swap between two
    existing catalog rows always yields a priceable row.

    NO FP SIBLING AT THAT amp AND curve -> THE PICK IS LEFT EXACTLY ALONE and the reason is
    recorded. Never swap to a different amp, never to a different curve, never invent a row: a
    four-pole breaker the catalog does not stock is an honest gap for a human, not something to
    approximate.
    """
    changed = []
    if not row_out or not pole_catalog:
        return changed
    four_pole_re = _four_pole_re(four_pole_tokens() if tokens is None else tokens)
    if four_pole_re is None:
        return changed
    fragments = None
    for aid in sorted(row_out):
        cell = row_out.get(aid) or {}
        picked = cell.get("value")
        if not isinstance(picked, str):
            continue
        attrs = pole_catalog.get(picked)
        if not attrs:
            continue
        device = attrs.get("device")
        if not device or attrs.get("pole") != "TP":
            continue  # only a three-pole pick can be mis-routed; everything else is out of reach
        if fragments is None:
            fragments = row_own_text_fragments(row)
        if not any(_four_pole_near_device(f, four_pole_re, str(device).upper(),
                                          _FOUR_POLE_ADJACENCY_WORDS) for f in fragments):
            continue
        siblings = [
            name for name, a in pole_catalog.items()
            if a.get("device") == device and a.get("pole") == "FP"
            and a.get("amp_a") == attrs.get("amp_a") and a.get("curve") == attrs.get("curve")
        ]
        if len(siblings) != 1:
            # 0 -> the catalog stocks no four-pole equivalent. >1 -> the catalog is ambiguous and
            # picking one would be a guess. Either way: leave the pick, record why.
            changed.append({"attr": aid, "from": picked, "to": None,
                            "reason": "no_unique_fp_sibling", "candidates": len(siblings)})
            continue
        cell["value"] = siblings[0]
        changed.append({"attr": aid, "from": picked, "to": siblings[0]})
    return changed


def _extract_batch(client, model, prompt_text, attr_defs, rows_batch, synonyms=None, defaults=None, none_guidance=None, slot_spec=None, resolution_rules=None, rules=None, pole_catalog=None, code_attrs=None, absent_rules=None, conductor_groups=None, *, capture_ctx=None):
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
        # EA-7: how to read the labelled row context. Unconditional -- the shape always carries
        # labels now, so the explanation must always be present.
        + _ROW_CONTEXT_SHAPE_GUIDANCE
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
        # SLICE 5 (B2 / R-B). A default carrying `requires_named` belongs to a COMPONENT SLOT: it is
        # the quantity of the item named in the attribute it points at. Returning a quantity for a
        # slot the row positively does NOT carry is not a default, it is a phantom component -- 84 of
        # them across the live corpus, every one the value 1. The scrub below enforces this
        # server-side; this sentence is what stops the model producing them in the first place.
        if any(isinstance(v, dict) and v.get("requires_named") for v in defaults.values()):
            content += (
                "\n\nSLOT-PAIRED DEFAULTS: where an attribute above carries \"requires_named\", it is "
                "the QUANTITY of the component named by that other attribute. Withhold its default in "
                "EXACTLY ONE CASE: when that named attribute is \"None\" -- the row carries no such "
                "component -- return null for the quantity, never the default and never 0, because "
                "there is nothing to count. In EVERY other case return the default as usual, "
                "INCLUDING when the named attribute is blank because you could not read it: blank "
                "means the component may well be there and something downstream will work it out, so "
                "the quantity is still wanted. Note that withholding a quantity is simply the "
                "arithmetic consequence of \"None\", not a penalty for choosing it: \"None\" remains "
                "the expected, correct answer for any component the row does not carry, and must "
                "never be downgraded to blank in order to keep a quantity alive. Blank means only "
                "one thing -- that you could not tell.\n"
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
    # TPN POST-MATCH: the SOURCE row behind each id, so a post-match correction can read the row's
    # own text. `payload_items` above is the model-facing projection; this is the row itself.
    rows_by_id = {r["excel_row"]: r for r in rows_batch}
    defs_by_id = {d["id"]: d for d in attr_defs}
    last = None
    for attempt in range(1, _RETRIES + 1):
        # `text` is per-attempt and is overwritten on a retry, so it is initialised here: the
        # failed-attempt capture below needs whatever this attempt managed to produce, and a
        # capture placed only after a SUCCESSFUL join would record nothing about the attempts that
        # failed -- which are usually the interesting ones.
        text = None
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=_AI_MAX_TOKENS,
                messages=[{"role": "user", "content": content}],
                timeout=_AI_TIMEOUT,
            )
            # SR-2 (1): diagnose a ceiling cut HERE, BEFORE the text is parsed, so it can never
            # degrade into the generic truncated-JSON ValueError below. Deliberately NARROW: only
            # `max_tokens` is special-cased, so every other stop_reason -- a refusal, an empty
            # reply, anything unforeseen -- keeps its pre-SR-2 behaviour byte-identical and still
            # falls through to the parse and the existing retry classification.
            if getattr(resp, "stop_reason", None) == "max_tokens":
                # CAPTURE (ceiling cut). This path RAISES BEFORE any text exists, so without a
                # record here a cut batch is indistinguishable from a batch that never ran.
                _capture_write(dict(
                    _capture_common(capture_ctx, rows_batch, "ceiling_cut"),
                    model=model, attempt=attempt, prompt=content,
                    stop_reason="max_tokens", usage=_usage_of(resp),
                    max_tokens=_AI_MAX_TOKENS, batch_size=len(rows_batch),
                ))
                raise ReplyCeilingExceeded(len(rows_batch), _AI_MAX_TOKENS)
            text = "".join(getattr(b, "text", "") for b in resp.content)
            out = {}
            # ── capture accumulators. OBSERVATION ONLY: `out` below is built exactly as before,
            # and nothing in this bookkeeping feeds back into it. ──
            cap_map = {}
            drops = {
                "ids_not_in_batch": [],
                "unknown_container_rows": [],
                "attributes_absent": {},
                "coercion_failures": {},
                "confidence_unparseable": {},
                "surplus_attributes": {},
                "defaulted_lost_to_coercion": {},
                # SLICE 5 (B2): {excel_row: [qty_attr, ...]} -- quantities removed because their
                # paired item slot came back "None". Observation only, like every sibling here.
                "slot_paired_defaults_scrubbed": {},
                # PW-CIRCUIT-STRETCH: {excel_row: [attr, ...]} -- spec fields filled with the "None"
                # sentinel because their controller declared the component absent. Observation
                # only, like every sibling here.
                "absent_dependents_filled": {},
                # TPN POST-MATCH: {excel_row: [{attr, from, to}, ...]} -- three-pole MCB picks
                # re-selected as their four-pole sibling, and the ones left alone for want of a
                # unique sibling. Observation only, like every sibling here.
                "four_pole_mcb_corrections": {},
                # ⚠️ CONDUCTOR FLOOR: {excel_row: [{attr, action}, ...]}. THIS KEY WAS MISSING AND
                # THE OMISSION WAS A CRASH, not a lost observation -- its write site uses
                # `.setdefault(...)`, which READS the key first, so the moment
                # `apply_conductor_floor` recorded anything the whole batch died with
                # `KeyError('conductor_floor_applied')`. Shipped with the conductor-floor work
                # (2026-09-03); it took out every point_wiring batch where the floor actually
                # applied. `BOQ-26-00016` `Bill 18-_W&C` could not be priced at all because of it.
                # ⚠️ AND IT LIED ABOUT ITS CAUSE: the except-clause below treats any exception as a
                # failed AI attempt, so the user was told "An AI request kept failing after 3
                # attempts" -- see the halt message at the end of this function.
                # `test_drops_keys_are_all_initialised` now fails for ANY key written here but
                # missing from this literal, so the next one cannot repeat it.
                "conductor_floor_applied": {},
            }
            for el in _extract_json_array(text):
                rid = int(el["id"])
                if rid not in batch_ids:
                    drops["ids_not_in_batch"].append(rid)
                    continue  # ignore any id the model echoed that is not in THIS batch
                # EA-4d: the composite-decomposition prompt returns the filled slots under "slots"; the
                # identity/attribute prompts use "attributes". Accept EITHER -- the per-attr shape
                # ({value, confidence}) and the downstream coercion are identical for both.
                attrs = el.get("attributes")
                if attrs is None:
                    attrs = el.get("slots")
                if attrs is None:
                    # Neither key: EVERY attribute of this row goes blank, silently. Record what the
                    # model actually sent so a renamed container is diagnosable.
                    drops["unknown_container_rows"].append(
                        {"excel_row": rid, "keys_returned": sorted(str(k) for k in el.keys())})
                attrs = attrs or {}
                row_out = {}
                row_map = {}
                absent, coerce_fail, conf_bad, defaulted_lost = [], {}, [], []
                for aid, defn in defs_by_id.items():
                    cell = attrs.get(aid) or {}
                    if aid not in attrs:
                        absent.append(aid)
                    raw = cell.get("value")
                    value, reason = _coerce_value_ex(defn, raw, (synonyms or {}).get(aid))
                    conf_raw = cell.get("confidence")
                    try:
                        conf = float(conf_raw)
                    except (TypeError, ValueError):
                        conf = 0.0
                        # An ABSENT confidence also lands here; only flag a value the model
                        # actually sent that could not be read (absence is covered by `absent`).
                        if conf_raw is not None:
                            conf_bad.append(aid)
                    row_out[aid] = {"value": value, "confidence": max(0.0, min(1.0, conf))}
                    # EA-4a: keep the model's per-attribute `defaulted` flag (only when the value
                    # survived coercion -- a defaulted value is one of the allowed values, so this
                    # simply marks WHY it is present). Absent/false -> flag omitted (byte-compat).
                    claimed_default = bool(cell.get("defaulted"))
                    if defaults and value is not None and claimed_default:
                        row_out[aid]["defaulted"] = True
                    if raw is not None and value is None:
                        coerce_fail[aid] = reason
                        # ⚠️ The flag rides on the value surviving, so a DEFAULTED value that fails
                        # coercion loses the value AND the evidence it was ever a default. That is
                        # the one case where the stored row cannot be told apart from a row the
                        # model never answered -- so it gets its own drop class.
                        if claimed_default:
                            defaulted_lost.append(aid)
                    row_map[aid] = {
                        "raw": raw,
                        "coerced": value,
                        "reason": reason,
                        "confidence_raw": conf_raw,
                        "confidence": row_out[aid]["confidence"],
                        "defaulted_claimed": claimed_default,
                        "defaulted_kept": bool(row_out[aid].get("defaulted")),
                    }
                # SLICE 5 (B2 / R-B) -- THE SLOT-PAIRED DEFAULT SCRUB, server-side.
                #
                # ⚠️ THE PROMPT SENTENCE ABOVE IS NOT THE ENFORCEMENT, THIS IS. The phantom quantities
                # this removes were themselves produced by a model following default guidance, so a
                # second instruction to the same model is guidance, not a guarantee.
                #
                # ⚠️ IT KEYS ON THE "None" SENTINEL, NOT ON "not named", AND THE DIFFERENCE IS
                # LOAD-BEARING. "None" is POSITIVE ABSENCE (the row carries no such component); BLANK
                # is "unknown, the pipeline will work it out". Scrubbing on blankness too would clear
                # `plate_qty` on every row whose plate the LADDER computes -- 94 of 122 live rows --
                # and a null qty makes `component_ref` refuse the WHOLE pipeline, so those rows would
                # stop pricing entirely. Absent slot => no component => no quantity; unknown slot =>
                # leave the default alone.
                #
                # It drops the value whatever its provenance, not only a `defaulted: true` one: a
                # quantity for a component the row says is not there is meaningless however it arose,
                # and this is the same statement `disables_when_none` already makes on the panel.
                for _aid in scrub_unpaired_slot_defaults(row_out, defaults):
                    drops["slot_paired_defaults_scrubbed"].setdefault(str(rid), []).append(_aid)
                    if _aid in row_map:
                        row_map[_aid]["scrubbed_unpaired"] = True

                # PW-CIRCUIT-STRETCH -- a component declared ABSENT has an absent SPECIFICATION.
                # Placed beside the scrub above because it is the same kind of thing: a pure,
                # deterministic correction of model output, applied to the row dict this loop is
                # assembling, BEFORE the result is stored. It is the MIRROR of that scrub -- the
                # scrub REMOVES a quantity for a component the row says is not there; this FILLS the
                # spec of one, so the row can price instead of refusing on a field it already
                # answered. Inert for every config declaring no `absent_dependents`.
                for _aid in force_absent_dependents(row_out, absent_rules):
                    drops["absent_dependents_filled"].setdefault(str(rid), []).append(_aid)
                    if _aid in row_map:
                        row_map[_aid]["forced_absent"] = True

                # THE CONDUCTOR FLOOR -- the arithmetic that used to live in R9's prose.
                #
                # Placed AFTER `force_absent_dependents` deliberately: that corrector writes the
                # "None" sentinel into the spec of a component the row declares absent, and this one
                # reads exactly that sentinel to decide a wire DOES NOT EXIST. Run in the other
                # order, an absent circuit wire would still look like a real one carrying the
                # mirrored default `runs = 1`, and the floor would top up a run that is not there.
                #
                # Inert for every config declaring no `conductor_floor` -- which is every category
                # but point_wiring today.
                for _rec in apply_conductor_floor(row_out, conductor_groups):
                    drops["conductor_floor_applied"].setdefault(str(rid), []).append(_rec)
                    _a = _rec.get("attr")
                    if _a in row_map:
                        row_map[_a]["conductor_floor"] = _rec.get("action")

                # TPN POST-MATCH -- THE FOUR-POLE MCB CORRECTION, server-side.
                #
                # THE PROMPT'S POLE LINE IS NOT THE ENFORCEMENT, THIS IS. It is obeyed for TP+N /
                # TP+NL / TP+2N / TP+2NL and measurably NOT for the bare token "TPN", which the
                # model reads as the words "Triple Pole and Neutral". Rewording was judged futile.
                #
                # Placed directly after the scrub because both are the same kind of thing: a pure,
                # deterministic correction of model output, applied to the row dict this loop is
                # assembling, BEFORE the result is stored. `pole_catalog` is absent for every
                # non-composite category, so this is inert -- and byte-identical -- for them.
                _row_src = rows_by_id.get(rid)
                if pole_catalog and _row_src is not None:
                    for _rec in correct_four_pole_mcb_picks(row_out, _row_src, pole_catalog):
                        drops["four_pole_mcb_corrections"].setdefault(str(rid), []).append(_rec)
                        _a = _rec.get("attr")
                        if _a in row_map:
                            row_map[_a]["four_pole_corrected"] = _rec.get("to")
                # PIECE 4 -- THE POINT TYPE, a DETERMINISTIC CODE MATCH over the payload.
                #
                # Placed beside the two corrections above because it is the same kind of thing: pure,
                # deterministic, applied to the row dict this loop is assembling, BEFORE the result is
                # stored. It differs in one way worth naming -- the model is never asked for
                # `point_type` at all (`extract: false`), so this does not CORRECT a model answer, it
                # SUPPLIES the attribute. `point_type_of` reads `_ai_item(row)`: the SAME payload the
                # model was shown, never raw node text and never a chain assembled here.
                #
                # None means both types, neither, or confusion -- the config's map_attribute skips on
                # it and the 15 + (points-1)*5 formula stands, exactly as the owner ruled.
                #
                # INERT for every other category: nothing else declares `point_type`.
                if _row_src is not None and "point_type" in (code_attrs or ()):
                    _item_pt = _ai_item(_row_src)
                    _pt = point_type_of(_item_pt)
                    if _pt is not None:
                        row_out["point_type"] = {"value": _pt, "confidence": 1.0}
                        row_map["point_type"] = {"raw": None, "coerced": _pt,
                                                 "reason": "matched from payload (code)",
                                                 "confidence_raw": None, "confidence": 1.0,
                                                 "defaulted_claimed": False, "defaulted_kept": False}
                    # THE n x 5 MECHANISM. Supplied here rather than in the config because the
                    # config's table is a fixed {Primary: 15, Secondary: 5} map and cannot express
                    # "n times five" -- and this slice ships no asset. The interpreter's step 0
                    # carries `prefer_attr: circuit_length_m`, whose STATED-WINS branch adopts this
                    # value and stops the table substituting the flat 5; step 1's formula then
                    # yields to it for the same reason.
                    # ⚠️ ONLY when the model stated no length of its own -- a pricer's or the
                    # model's explicit number always outranks a derived one.
                    if "circuit_length_m" in defs_by_id and not _stated(row_out, "circuit_length_m"):
                        _n5 = secondary_length_m(_item_pt)
                        if _n5 is not None:
                            row_out["circuit_length_m"] = {"value": _n5, "confidence": 1.0}
                            row_map["circuit_length_m"] = {
                                "raw": None, "coerced": _n5,
                                "reason": "n x 5, secondary points counted (code)",
                                "confidence_raw": None, "confidence": 1.0,
                                "defaulted_claimed": False, "defaulted_kept": False}
                # Attributes the model returned that are NOT declared. Currently read by nothing and
                # dropped with no else-branch -- the compound-row surplus.
                surplus = sorted(str(k) for k in set(attrs) - set(defs_by_id))
                if surplus:
                    drops["surplus_attributes"][str(rid)] = surplus
                if absent:
                    drops["attributes_absent"][str(rid)] = absent
                if coerce_fail:
                    drops["coercion_failures"][str(rid)] = coerce_fail
                if conf_bad:
                    drops["confidence_unparseable"][str(rid)] = conf_bad
                if defaulted_lost:
                    drops["defaulted_lost_to_coercion"][str(rid)] = defaulted_lost
                cap_map[str(rid)] = row_map
                out[rid] = row_out
            # Rows we asked about and the model never mentioned. `_row_result` will fill these with
            # all-None attributes, which is indistinguishable from all-nulls returned.
            drops["rows_omitted"] = sorted(batch_ids - set(out))
            # CAPTURE (the primary point): prompt + raw reply + the whole mapping, one record per
            # batch, written immediately before the return.
            _capture_write(dict(
                _capture_common(capture_ctx, rows_batch, "batch"),
                model=model, attempt=attempt, prompt=content,
                response_text=text, stop_reason=getattr(resp, "stop_reason", None),
                usage=_usage_of(resp),
                payload_items=payload_items,
                defaults_configured=bool(defaults),
                declared_attributes=sorted(defs_by_id),
                mapping=cap_map, drops=drops,
            ))
            return out
        except ReplyCeilingExceeded:
            # SR-2: NOT retried on purpose. The cut is deterministic for this batch -- an identical
            # request produces an identical cut -- so the three attempts below would burn three
            # guaranteed-failed calls. Propagate immediately and let the caller SPLIT instead.
            raise
        except Exception as exc:
            last = exc
            # CAPTURE (failed attempt). The reply that could not be parsed is the evidence, and it
            # is otherwise discarded when the next attempt overwrites `text`. Records whatever this
            # attempt produced -- `response_text` is None when the call itself failed.
            _capture_write(dict(
                _capture_common(capture_ctx, rows_batch, "attempt_failed"),
                model=model, attempt=attempt, prompt=content,
                response_text=text, error=repr(exc),
                transient=bool(_is_transient(exc)),
            ))
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
    #
    # ⚠️ THE MESSAGE NAMES THE ACTUAL ERROR, AND THAT IS THE POINT OF THIS WORDING.
    # It used to assert "An AI request kept failing after 3 attempts" unconditionally. That claim is
    # only sometimes true: the `try` above wraps the WHOLE batch -- the API call AND every bit of
    # local post-processing (coercion, the correctors, the `drops` bookkeeping) -- and the
    # `except Exception` below catches all of it. `_is_transient` then defaults an unrecognised
    # error to retryable (deliberately, and documented at its definition), so a plain local bug is
    # retried three times and reported as an AI failure.
    #
    # That is exactly what happened with `KeyError('conductor_floor_applied')`: a missing dict key
    # was reported to the user as an AI problem, and an investigation went looking for one that did
    # not exist. The real cause was already in `detail`, but nothing surfaced it. A crash that lies
    # about its cause is worse than a crash.
    #
    # ⚠️ NARROWING THE `try` TO THE API CALL ALONE IS THE REAL FIX AND IS DELIBERATELY NOT DONE HERE:
    # it would restructure the retry/capture/split control flow, which is far more than this slice
    # authorises. Naming the error is the contained half -- it makes the next such bug legible
    # immediately instead of costing an investigation.
    raise ExtractionHalted(
        f"The batch failed on all {_RETRIES} attempts, so the run stopped early. "
        f"Last error: {type(last).__name__}: {last}",
        terminal=False,
        detail=repr(last),
    )


# ── SR-2 (3): split-on-truncation ──────────────────────────────────────────────────
# 20 -> 10 -> 5. A 5-row batch that STILL cuts is not a size problem any more, so it halts with
# the run's work preserved rather than splitting to single rows and burning a call per row.
_MAX_SPLIT_DEPTH = 2


def _extract_with_ceiling_split(call_batch, batch, depth=0):
    """Yield `(sub_batch, batch_out)` for `batch`, halving it whenever the reply hits the ceiling.

    Yields exactly ONE pair when the batch fits -- the overwhelming majority, and byte-identical
    to the pre-SR-2 single call. After a cut it yields one pair per surviving half instead.

    The caller treats every yielded pair exactly as it treated a batch that returned, which is
    what makes this compose with SR-1 unchanged: `attempted` advances per HALF, each half is
    checkpointed as it lands, and a halt part-way through a split KEEPS the halves already done.

    This is the DURABLE half of the fix. Raising the ceiling moves the wall; splitting removes the
    CLASS of failure -- a future category with more attributes per row, or a sheet with unusually
    long values, adapts automatically instead of needing another constant bump.

    Triggers ONLY on ReplyCeilingExceeded. A transient error and a genuinely garbled reply never
    reach here: they are still handled by `_extract_batch`'s own retry/backoff, byte-identical.
    """
    try:
        out = call_batch(batch)
    except ReplyCeilingExceeded as cut:
        if depth >= _MAX_SPLIT_DEPTH or len(batch) < 2:
            raise ExtractionHalted(
                f"The AI reply kept hitting the {cut.max_tokens}-token ceiling even after "
                f"splitting the batch down to {len(batch)} row(s), so the run stopped early.",
                terminal=False,
                detail=repr(cut),
            ) from cut
        mid = len(batch) // 2
        for half in (batch[:mid], batch[mid:]):
            yield from _extract_with_ceiling_split(call_batch, half, depth + 1)
        return
    yield batch, out


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
def run_extraction(boq, sheet_name, client=None, progress_cb=None, checkpoint_cb=None, skip_rows=None,
                   only_rows=None):
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

    SELECTED-ROW addition (`only_rows`, also ADDITIVE -- absent => byte-identical):
      * only_rows: the POSITIVE processing scope. When given, ONLY these excel_rows are extracted;
        everything else is left for the caller to carry forward from the run it supersedes.
        ⚠️ THIS SCOPES THE PROCESSING, NEVER THE POPULATION. `population_rows` below is always
        computed from the FULL sheet, because it is the completeness yardstick the caller tests
        `population - attempted` against. Narrowing the population instead is the DESTRUCTIVE
        implementation: `complete` would then be reachable with only the selected rows present,
        the run would flip active=1, and every unselected row would silently lose its extraction.
        assemble_population's own definition is untouched by this parameter.
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
    # `only` is None (whole sheet) or the positive scope. An EMPTY only_rows is treated as ABSENT,
    # so an empty selection can never mean "process nothing" by accident.
    only = {int(x) for x in only_rows} if only_rows else None
    # ⚠️ ALWAYS the full sheet -- the completeness yardstick, unaffected by either filter.
    population_rows = [r["excel_row"] for r in all_rows]
    rows = [
        r for r in all_rows
        if r["excel_row"] not in skip and (only is None or r["excel_row"] in only)
    ]

    # THE ANTI-SILENCE HEADER, written before every early return below so that a run which
    # extracts nothing still leaves a trace. Placed here, after the population and settings are
    # known, so it can state what the run was ABOUT to do.
    _capture_run_header(
        boq, sheet_name, cv, model, len(rows),
        {r.get("category_id") for r in rows if r.get("category_id")},
        settings.get("enabled"),
    )

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
            # TPN POST-MATCH: the repeatable slot's catalogue WITH attributes, so the post-match
            # four-pole correction can read a pick's device/pole/amp/curve and find its sibling.
            # Composite-only and resolved ONCE per group, exactly like `slot_spec` beside it; None
            # for every other mode, which leaves those categories byte-identical.
            "pole_catalog": breaker_catalog_for(cfg, disc) if is_composite else None,
            "conductor_groups": conductor_floor_groups(cfg),
            # PIECE 4: the attribute ids this config declares that CODE supplies rather than the
            # model. Derived FROM THE CONFIG (never a hardcoded category name -- the HV-10 lesson):
            # a config that does not declare `point_type` yields an empty set and the matcher is
            # inert for it, which is every category but point_wiring today.
            "code_attrs": {d["id"] for d in (cfg.get("attribute_definitions") or [])
                           if d.get("id") in _CODE_SUPPLIED_ATTRS},
            # EA-4 ext-a: owner-authored estimator rules. DELIBERATELY UNGATED -- unlike slot_spec /
            # resolution_rules (composite-only), these must reach EVERY category, composite or not
            # (R7 lands on cabletray_raceway, an ordinary attribute category). Absent => None =>
            # the prompt is byte-identical to before.
            "rules": cfg.get("rules"),
            # PW-CIRCUIT-STRETCH: {controller: (absent_value, [dependents])} read FROM THE CONFIG --
            # a category declaring none yields {} and the corrector is inert for it.
            "absent_rules": absent_dependent_rules(cfg),
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

                def _call(rows_, _gc=gc):
                    # `boq` is NOT on the row dict -- it lives only in this enclosing scope, so the
                    # capture's join key is threaded in from here.
                    return _extract_batch(client, model, _gc["prompt"], _gc["defs"], rows_, _gc["synonyms"], _gc["defaults"], _gc["none_guidance"], _gc["slot_spec"], _gc["resolution_rules"], _gc["rules"], _gc["pole_catalog"], _gc["code_attrs"], _gc["absent_rules"], _gc["conductor_groups"],
                                          capture_ctx={"boq": boq})

                # SR-2 (3): ONE iteration when the batch fits (byte-identical to the pre-SR-2 single
                # call); one per surviving half after a ceiling cut. Everything below is unchanged
                # and simply operates on `sub_batch` -- so a split advances `attempted` and
                # checkpoints per HALF, and the halves already done survive a later halt.
                for sub_batch, batch_out in _extract_with_ceiling_split(_call, batch):
                    ai_out.update(batch_out)
                    # The batch RETURNED, so its rows are genuinely attempted. A row the model simply
                    # did not answer for is still attempted (we asked); only a HALTED batch's rows stay
                    # pending. This is the done-marker a resume keys off -- never "are the attributes
                    # blank", which cannot tell not-asked from asked-and-got-null.
                    attempted.update(r["excel_row"] for r in sub_batch)
                    done += len(sub_batch)
                    if progress_cb:
                        progress_cb(min(done, total), total)
                    # SR-1 CHECKPOINT: hand this batch's rows to the caller to persist, so the work
                    # survives a later halt. Same injection shape as progress_cb; the service layer
                    # performs no DB write of its own.
                    if checkpoint_cb:
                        checkpoint_cb(
                            [_row_result(r, ai_out.get(r["excel_row"])) for r in sub_batch],
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

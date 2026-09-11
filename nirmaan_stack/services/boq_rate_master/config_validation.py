# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-master category-config STRUCTURAL VALIDATION -- the one predicate, in the service layer.

RELOCATED from `api/boq/rate_master.py` (the RM-4b editor's `update_rate_config` gate) on 2026-09-10
so that the IMPORT LOADER (`services/boq_rate_master/loader.py`) can run it too. It had to move DOWN:
the loader lives in `services/`, a service importing `api/` breaks the import-direction law, and no
placement inside `api/` avoids that -- the precedent is `services/boq_bcs/readiness.py` and the
`boq_category.persist` relocations. `api/boq/rate_master.py` re-imports every name below, so
`rate_master._validate_config`, `rate_master._KNOWN_DEF_KEYS`, `rate_master._KNOWN_STEP_TYPES` and
`rate_master._STEP_DIVISOR_SUFFIX` still resolve for the editor endpoint and the test suite.

NOTHING HERE MAY IMPORT FROM `nirmaan_stack.api` OR READ REQUEST CONTEXT. `frappe.throw` is the
only frappe surface used, and a ValidationError raised from here writes nothing.

Two callers, one predicate, deliberately: the editor validates BEFORE `doc.save`, the loader
validates BEFORE `_deactivate_scope` -- the same object in both places (discipline stamped,
per-category goldens merged), so a config that saves here cannot be refused there, and a config
the import refuses could never have been saved by hand either.
"""

import re

import frappe

# ── RM-4b: rate-master STRUCTURE EDITING (admin-only) ─────────────────────────────────────────────
# ONE whole-config replace endpoint: update_rate_config(name, config). This LIFTS the RM-4a
# "PARAM VALUES ONLY" boundary -- creating/deleting params, steps, conditions, and attribute
# definitions is now in scope. The submitted config is STRUCTURALLY VALIDATED server-side BEFORE any
# write (admin gate first): known step types only (the interpreter vocabulary); params dicts of finite
# numbers; conditions + component_band bands well-formed; attribute_definitions well-formed; a
# REFERENCE GUARD rejects removing a definition any pipeline references; no unknown top-level keys.
# The interpreter's EXECUTION semantics are OUT OF SCOPE and untouched -- validation accepts exactly the
# shapes the pure interpreter (ratePipelineInterpreter.ts) executes: a condition `when` is
# {attribute: scalar} EXACT-match (the only stored + executable shape -- range/in predicate OBJECTS are
# rejected, since the interpreter would silently never match them), and component_band bands are
# comparator strings ('<35' / '>=35'). Valid -> the audited doc.save recipe (Version diff). Invalid ->
# a named validation error, NO write. GOLDENS live in the config as a "goldens" array (attrs + expected
# finals per pipeline); the frontend preview gate computes them against a draft before save.
_KNOWN_STEP_TYPES = {
    "match_master_row", "apply_effective_multiplier", "scale", "roundup",
    "component", "component_ref", "component_band", "sum_components", "install_as_ratio",
    # EA-4a: the assembly engine's conduit-sizing step (component_ref is EXTENDED in place, so it stays
    # the same step type -- only circuit_fit is a new type).
    "circuit_fit",
    # EA-4c: the DB build-up install -- the sheet's exact IFERROR three-way (shell absent -> supply ratio;
    # shell in the install table -> table rate x mult; else fallback to the supply ratio). PASS-THROUGH:
    # no deep structural validation (the pure interpreter's Option-C degrades a malformed shape to the
    # honest `unsupported`); its @attr (db_shell_item) is already reference-guarded via the component_ref
    # supply steps that bind it.
    "lookup_or_ratio",
    # SLICE 2: computes a module count from a PARAMETERISED weighted sum over stated quantities and
    # resolves it against ladders derived FROM THE CATALOG (exact size, else the next higher one).
    # FULLY validated below -- every attribute id it names is reference-guarded, because an unguarded
    # typo would silently no-compute every row of the category rather than failing at save.
    "module_fit",
    # CIRCUIT LENGTH part 1: computes an ATTRIBUTE value (formula + source attrs + target attr all from
    # CONFIG) into the SELECTION, which is where circuit_fit's length_attr and a component's
    # {from_attr} quantity read -- ctx, where every other step writes, is invisible to both. FULLY
    # validated below, and BOTH its source attrs AND its result_attr are reference-guarded: a typo in
    # the target would silently never find a stated value to defer to, which is the quietest possible
    # way to get a wrong price.
    "derive_attribute",
    # SLICE 2b: resolves ONE string attribute -- a stated value if there is one, else a config
    # conversion table, else a config default. A CONVERSION (pin count -> pole, SWG -> mm) is
    # deterministic code under the owner's standing principle, never a prompt sentence. PASS-THROUGH:
    # no deep structural validation -- the pure interpreter's Option-C degrades a malformed shape to
    # the honest `unsupported`, and its attribute ids are ordinary selection reads rather than the
    # kind of silent-typo hazard module_fit's ladder binds carry.
    "map_attribute",
    # SLICE 2b: fits a stated NUMBER onto a ladder derived FROM THE CATALOG and binds the chosen
    # row's label -- module_fit's ladder half, generalised so slice 3's tray width and F-10's
    # converted thickness ride the same step. PASS-THROUGH for the same reason as map_attribute.
    "catalog_fit",
}
# TWO WAYS (2026-09-10): every key an attribute definition may carry. Measured against the 12 live
# configs and every asset on disk (16 keys in use) plus the frontend `AttributeDefinition` interface;
# `extract_as` is the seventeenth. A key absent from this set is REJECTED by `_validate_config` -- the
# guard that stops a misspelled `extract_as` shipping the closed-list behaviour silently.
_KNOWN_DEF_KEYS = {
    "id", "label", "type", "values", "values_from", "default", "note", "selector", "panel", "extract",
    "allow_none", "disables_when_none", "group_label", "conductor_floor", "absent_when_value",
    "absent_dependents",
    "extract_as",
    # CONDUIT TRADE SIZE (v63): the inch -> trade-size table the extraction corrector applies in code.
    "inch_trade_mm",
}

_KNOWN_CONFIG_KEYS = {
    "discipline", "category_id", "category_display", "pairing_rule",
    "attribute_definitions", "pipelines", "bcs_surfacing", "normalization_rule", "goldens",
    "item_kinds",  # EA-1c: the category's master-item kinds (Data-tab scoping); pass-through, not validated
    # EA-2 pass-through keys (stored VERBATIM, NOT structurally validated -- exactly like item_kinds).
    # An item-identity config carries identity_attribute_id + matching_mode + notes, and the helper
    # reads pipeline_labels; the RM-4b editor resubmits the WHOLE config, so these must be accepted or
    # editing/authoring an EA-2 config would be rejected as an unknown key.
    "identity_attribute_id", "matching_mode", "notes", "pipeline_labels",
    # EA-DIFF: synonyms = {attr_id: {variant: canonical}} (e.g. conduit_type GI->MS). Pass-through;
    # consumed by the extraction injection + coercion, never structurally validated here.
    "synonyms",
    # EA-4a: extraction_defaults = {attr_id: default | {default, text_overrides}}. Pass-through; consumed
    # by the extraction prompt injection (defaults + the raceway text-override), never validated here.
    "extraction_defaults",
    # EA-4a-r: extraction_none_guidance = optional per-config wording for the "None" (positive-absence)
    # prompt line. Pass-through; consumed by the extraction injection, never structurally validated here.
    "extraction_none_guidance",
    # EA-4d: composite_slots ({shell, repeatable {prefix,count,...}, fixed[]}) + decomposition_rules
    # ({curve, amp, partial_pricing}) drive the composite-decomposition extraction mode. Pass-through;
    # consumed by extraction.build_slot_spec + the decomposition prompt injection, never structurally
    # validated here (so a composite config round-trips through the RM-4b whole-config editor).
    "composite_slots", "decomposition_rules",
    # EA-4 ext-a: rules = [{id, label, applies_to, guidance}] -- owner-authored estimator guidance
    # injected into the extraction prompt for EVERY category (never gated on matching_mode) and
    # rendered read-only on the Derivation tab. Pass-through, exactly like item_kinds: stored
    # VERBATIM and never structurally validated here.
    #
    # THIS ENTRY IS LOAD-BEARING, not decorative. _validate_config REJECTS any unknown top-level
    # key, and RM-4b resubmits the WHOLE config -- so without "rules" here, adding the key would
    # make every subsequent whole-config save of that category fail. Since 2026-09-10 the LOADER runs
    # this validator too (`loader._validate_loaded_config`), so an unregistered key is now refused AT
    # IMPORT, by name -- before, it imported cleanly and only broke later, at the editor. Same trap the
    # EA-2 pass-through keys document; the fix is still "register the key here", just earlier.
    "rules",
}
_BAND_WHEN_RE = re.compile(r"^(<=|>=|<|>)\s*-?\d+(\.\d+)?$")


def _is_finite_number(v):
    """True only for a real finite int/float (rejects bool, None, NaN, +/-Inf, strings)."""
    if isinstance(v, bool) or v is None or not isinstance(v, (int, float)):
        return False
    return v == v and v not in (float("inf"), float("-inf"))


def _vthrow(msg):
    frappe.throw(msg, title="Invalid config")


_FROM_ATTR_SUFFIX = "_from_attr"
# RULING 2 (owner 2026-08-09): the `scale`-param half of the step function. Mirrors the interpreter's
# STEP_DIVISOR_SUFFIX -- keep the two strings identical or a config saves here and does nothing there.
_STEP_DIVISOR_SUFFIX = "_step_divisor"
# SLICE 5: the addition primitive's `scale`-param suffix. Mirrors the interpreter's CTX_PARAM_SUFFIX
# -- keep the two strings identical, for the same reason the line above says it: a config that saves
# here and does nothing there is the worst of both.
_FROM_CTX_SUFFIX = "_from_ctx"


def _validate_params(params, where):
    """EA-4 ext-a: two narrowly-scoped relaxations, both making this validator agree with what the
    interpreter is EXPLICITLY built to execute (ratePipelineInterpreter.ts `s.params ?? {}`) and with
    what the shipped asset already contains. Discovered because cabletray_raceway / popup_boxes could
    not be saved through RM-4b AT ALL.

    (1) params is OPTIONAL. A conditional `component` carries its params PER CONDITION, so it has no
        top-level block at all -- that is the whole point of the shape, not an omission.
    (2) a `*_from_attr` param binds an ATTRIBUTE ID, so it is necessarily a string (EA-1's
        value-from-attribute shape, e.g. popup_boxes `module_count_from_attr: "module_count"`).
        The exemption is scoped to that SUFFIX ONLY -- any other param carrying a string is still an
        error, so a genuine typo is still caught.
    """
    if params is None:
        return
    if not isinstance(params, dict):
        _vthrow(f"{where}: params must be an object.")
    for k, v in params.items():
        if isinstance(k, str) and k.endswith(_FROM_ATTR_SUFFIX):
            if not isinstance(v, str) or not v.strip():
                _vthrow(
                    f"{where}: parameter '{k}' must be a non-empty attribute id (a string)."
                )
            continue
        # SLICE 5, and the SAME relaxation as (2) above for the same reason: a `*_from_ctx` param
        # binds a COMPUTED (`ctx`) key -- the addition primitive -- so it is necessarily a string.
        # Without this the validator rejects a step the interpreter is explicitly built to execute,
        # which is precisely the failure mode the docstring above records for `*_from_attr`: the
        # popup config could not be saved or validated AT ALL. Scoped to the SUFFIX only, so any
        # other string-valued param is still an error.
        if isinstance(k, str) and k.endswith(_FROM_CTX_SUFFIX):
            if not isinstance(v, str) or not v.strip():
                _vthrow(
                    f"{where}: parameter '{k}' must be a non-empty computed-value key (a string)."
                )
            continue
        # RULING 2: `<ident>_step_divisor` pairs with `<ident>_from_attr` and turns that binding into
        # the STEP FUNCTION (ceil(raw / divisor)). It is a NUMBER, so the generic rule below would
        # already accept it -- but only a POSITIVE one does anything: the interpreter treats zero or
        # negative as "no divisor" and binds the raw value, so a typo would silently ship a linear
        # multiplier wearing a stepped config. Both halves are checked here.
        if isinstance(k, str) and k.endswith(_STEP_DIVISOR_SUFFIX):
            if not _is_finite_number(v) or v <= 0:
                _vthrow(f"{where}: parameter '{k}' must be a positive finite number (a step divisor).")
            partner = f"{k[: -len(_STEP_DIVISOR_SUFFIX)]}{_FROM_ATTR_SUFFIX}"
            if partner not in params:
                _vthrow(
                    f"{where}: parameter '{k}' needs its '{partner}' partner; on its own it does nothing."
                )
            continue
        if not _is_finite_number(v):
            _vthrow(f"{where}: parameter '{k}' must be a finite number.")


def _validate_config(cfg):
    """Full structural validation of a whole category config. Returns the map of attribute id ->
    referencing-locations (for the reference guard). Raises a named frappe.ValidationError on the first
    problem; the caller writes NOTHING on a raise."""
    if not isinstance(cfg, dict):
        _vthrow("config must be an object.")
    unknown = set(cfg.keys()) - _KNOWN_CONFIG_KEYS
    if unknown:
        _vthrow(f"Unknown top-level config key(s): {', '.join(sorted(unknown))}.")

    # attribute_definitions ------------------------------------------------------------------
    defs = cfg.get("attribute_definitions")
    if not isinstance(defs, list):
        _vthrow("attribute_definitions must be a list.")
    def_ids = set()
    for i, d in enumerate(defs):
        if not isinstance(d, dict):
            _vthrow(f"attribute_definitions[{i}] must be an object.")
        did = d.get("id")
        if not isinstance(did, str) or not did.strip():
            _vthrow(f"attribute_definitions[{i}] needs a non-empty string id.")
        if did in def_ids:
            _vthrow(f"Duplicate attribute definition id '{did}'.")
        def_ids.add(did)
        if not isinstance(d.get("label"), str) or not d.get("label"):
            _vthrow(f"attribute definition '{did}' needs a label.")
        # TWO WAYS (owner 2026-09-10) -- THE DEF-LEVEL KEY ALLOWLIST. Until now attribute definitions had
        # no allowlist (the config's top level has `_KNOWN_CONFIG_KEYS`; defs had none), so a misspelled
        # key was silently ignored. That is exactly the failure `extract_as` cannot afford: a typo would
        # ship the old behaviour -- the model handed a closed list -- with no signal, which is how a live
        # tender row priced an 80 mm tray as 50. Unknown keys are now rejected BY NAME.
        unknown_def_keys = set(d.keys()) - _KNOWN_DEF_KEYS
        if unknown_def_keys:
            _vthrow(
                f"attribute definition '{did}' carries unknown key(s): "
                f"{', '.join(sorted(unknown_def_keys))}. Known: {', '.join(sorted(_KNOWN_DEF_KEYS))}."
            )
        # `extract_as: "number"` -- show the list ON SCREEN, ask the MODEL for a free number. Only the
        # literal "number" is meaningful, and only on a `number_choice` (a `choice` list is a catalogue
        # pick and must stay closed; a `number` is already free).
        if "extract_as" in d:
            if d.get("extract_as") != "number":
                _vthrow(f"attribute '{did}' extract_as must be the literal \"number\" (got {d.get('extract_as')!r}).")
            if d.get("type") != "number_choice":
                _vthrow(f"attribute '{did}' extract_as is only meaningful on a number_choice (type is {d.get('type')!r}).")
        # CONDUIT TRADE SIZE (v63): `inch_trade_mm` is the inch -> TRADE-size table the extraction corrector
        # applies IN CODE (never `x 25.4`). Its shape is guarded because a typo here is silent: a malformed
        # key would leave every inch-stated size at the model's arithmetic and the ladder would buy the
        # wrong rung. It rides only on a def the model reads as a free number (`extract_as: "number"`) --
        # on a closed list the coercer would null the free value before the corrector ever saw it.
        if "inch_trade_mm" in d:
            table = d.get("inch_trade_mm")
            if not isinstance(table, dict) or not table:
                _vthrow(f"attribute '{did}' inch_trade_mm must be a non-empty object of inch text -> millimetres.")
            if d.get("extract_as") != "number":
                _vthrow(f"attribute '{did}' inch_trade_mm requires extract_as \"number\" on the same definition.")
            for k, v in table.items():
                if not isinstance(k, str) or not re.fullmatch(r"\d+(?: \d+/\d+)?|\d+/\d+", k.strip()):
                    _vthrow(f"attribute '{did}' inch_trade_mm key {k!r} must be an inch fraction such as \"3/4\", \"1\" or \"1 1/2\".")
                if not _is_finite_number(v) or v <= 0:
                    _vthrow(f"attribute '{did}' inch_trade_mm[{k!r}] must be a positive number of millimetres.")
        # CP2: `number_choice` is the THIRD type -- a DROPDOWN that produces a NUMBER. It exists
        # because item matching is strict identity, so a dropdown over a numeric catalog column
        # (cable cores, thickness) must not emit the string "3" against a stored 3.
        if d.get("type") not in ("choice", "number", "number_choice"):
            _vthrow(
                f"attribute definition '{did}' type must be 'choice', 'number' or 'number_choice'."
            )
        # EA-4a: a choice may declare `values_from` (allowed values resolved from the live master at
        # extraction time) INSTEAD of a static `values` list -- point_wiring's switch/socket/plate selects.
        # CP2: a number_choice is a dropdown too, so it carries the SAME requirement -- a picker with
        # neither a values list nor a values_from source would render empty and price nothing.
        if (
            d.get("type") in ("choice", "number_choice")
            and not d.get("values_from")
            and (not isinstance(d.get("values"), list) or not d.get("values"))
        ):
            _vthrow(
                f"{d.get('type')} attribute '{did}' needs a non-empty values list (or values_from)."
            )
        # EA-4a-r: allow_none (bool) marks a POSITIVELY-ABSENT-capable component; disables_when_none is the
        # list of dependent attr ids greyed/cleared when it is set to "None" (pass-through, shape-checked).
        if "allow_none" in d and not isinstance(d.get("allow_none"), bool):
            _vthrow(f"attribute '{did}' allow_none must be true/false.")
        # SLICE 2d: `panel: false` hides an attribute from the PRICING PANEL only -- it is NOT
        # `selector`, which also removes it from the AI prompt. Shape-checked exactly like
        # allow_none.
        #
        # NOTE for the next reader: attribute definitions have NO key allowlist here (unlike the
        # config's top-level `_KNOWN_CONFIG_KEYS`), so an unregistered key was never rejected and
        # `panel` did not strictly need a change to be saveable. It gets this guard anyway, because a
        # flag whose TYPE is unchecked fails silently: a string "false" is truthy in the frontend, so
        # the attribute would keep rendering with nothing to say why.
        if "panel" in d and not isinstance(d.get("panel"), bool):
            _vthrow(f"attribute '{did}' panel must be true/false.")
        dwn = d.get("disables_when_none")
        if dwn is not None and (not isinstance(dwn, list) or not all(isinstance(x, str) and x for x in dwn)):
            _vthrow(f"attribute '{did}' disables_when_none must be a list of attribute ids.")

    # pipelines ------------------------------------------------------------------------------
    # EA-2: an EMPTY pipelines dict is ACCEPTED -- a DATA-ONLY config (definitions + items, no
    # derivation yet), the owner's in-system authoring path (e.g. lighting_mgmt_system). A NON-empty
    # pipelines object is still validated fully, pipeline by pipeline, below.
    pipelines = cfg.get("pipelines")
    if not isinstance(pipelines, dict):
        _vthrow("pipelines must be an object.")
    referenced = {}  # attr id -> [locations] (for the reference guard's named error)

    def _ref(attr, loc):
        referenced.setdefault(attr, []).append(loc)

    # THE MAP-TARGET CARVE-OUT (catalog_fit, v63; widened to every attribute-id read on 2026-09-10).
    # A name a `map_attribute` step CREATES (`params.result_attr`, written into the selection at run
    # time) is a legal read for anything that reads the selection -- a catalog_fit `where` "@" ref
    # (industrial_sockets' `@mcb_pole`), a component_ref `qty.from_attr` / `qty.if_attr` key
    # (wiring_cabling's `conduit_included` is BOTH a def and a map target), a circuit_fit
    # `absent_when.attr`. Such a name needs no definition; every other name must be one. Computed
    # ONCE, over every pipeline, so the two kinds of reader can never disagree about what is legal.
    map_targets = {
        (mst.get("params") or {}).get("result_attr")
        for mpl in pipelines.values() if isinstance(mpl, dict)
        for mst in (mpl.get("steps") or []) if isinstance(mst, dict) and mst.get("step") == "map_attribute"
    }

    def _ref_or_map(attr, loc):
        if attr not in map_targets:
            _ref(attr, loc)

    for pid, p in pipelines.items():
        if not isinstance(p, dict):
            _vthrow(f"pipeline '{pid}' must be an object.")
        if not isinstance(p.get("output"), list) or not all(isinstance(o, str) for o in p["output"]):
            _vthrow(f"pipeline '{pid}': output must be a list of strings.")
        steps = p.get("steps")
        if not isinstance(steps, list) or not steps:
            _vthrow(f"pipeline '{pid}': steps must be a non-empty list.")
        # DECLARED CTX BINDS, in step order (2026-09-10). A component_ref `qty.from_fit` reads a
        # COMPUTED value out of the run scope (`ctx[key]`), never the selection -- the point_wiring
        # conduit count (`conduit_qty`, a circuit_fit `binds` entry) and the blank-plate count
        # (`blank_count`, a module_fit `blanks.bind`). So it is checked against the binds DECLARED by
        # an EARLIER step of the SAME pipeline, the way `module_fit blanks.from_ladder` is checked
        # against the ladders declared in its own step -- NOT against the attribute definitions,
        # where a plain `_ref` would refuse every one of the nine shipped uses. A bind declared by a
        # LATER step is refused too: the interpreter reads ctx in step order, so it would be
        # undefined at the read and the row would refuse with "quantity not provided".
        ctx_binds = set()
        for si, s in enumerate(steps):
            where = f"pipeline '{pid}' step {si}"
            if not isinstance(s, dict):
                _vthrow(f"{where}: must be an object.")
            st = s.get("step")
            if st not in _KNOWN_STEP_TYPES:
                _vthrow(f"{where}: unknown step type '{st}'.")
            if st == "match_master_row":
                params = s.get("params")
                if not isinstance(params, dict) or not isinstance(params.get("kind"), str) or not params.get("kind"):
                    _vthrow(f"{where}: match_master_row needs params.kind (a string).")
            elif st == "apply_effective_multiplier":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: apply_effective_multiplier needs a string '{key}'.")
                ctx_binds.add(s["result"])
                conds = s.get("conditions")
                if not isinstance(conds, list) or not conds:
                    _vthrow(f"{where}: needs a non-empty conditions list.")
                for ci, c in enumerate(conds):
                    if not isinstance(c, dict):
                        _vthrow(f"{where} condition {ci}: must be an object.")
                    when = c.get("when")
                    if not isinstance(when, dict) or not when:
                        _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                    for wk, wv in when.items():
                        if isinstance(wv, (dict, list)):
                            _vthrow(
                                f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                "(attribute = value); range/in predicates are not executable."
                            )
                        _ref(wk, f"{where} condition {ci}")
                    _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "scale":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: scale needs a string '{key}'.")
                _validate_params(s.get("params"), where)
                ctx_binds.add(s["result"])
            elif st == "roundup":
                if not isinstance(s.get("target"), str) or not s.get("target"):
                    _vthrow(f"{where}: roundup needs a string 'target'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("digits")):
                    _vthrow(f"{where}: roundup needs params.digits (a finite number).")
            elif st == "component":
                # EA-4 ext-a: `target` is OPTIONAL -- a conditional component whose formula is
                # param-only reads no price off the matched row (e.g. the tray's ceiling_accessories,
                # formula "accessories_per_mtr"). The interpreter already treats it as optional
                # (`if (s.target !== undefined)`); this validator was stricter than its own executor.
                # Present-but-blank is still an error, so a real typo is still caught.
                for key in ("name", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component needs a string '{key}'.")
                if "target" in s and (not isinstance(s.get("target"), str) or not s.get("target")):
                    _vthrow(f"{where}: component 'target', when present, must be a non-empty string.")
                _validate_params(s.get("params"), where)
                # THE COMPONENT'S OWN CONDITIONS (2026-09-10). The interpreter EXECUTES a `component`
                # step's `conditions` exactly as it executes component_ref's (find the first `when`
                # that exact-matches the selection, bind its `params`, else "no matching condition");
                # cabletray_raceway's cover / accessories / refilling / cutting components run on it
                # today. Until now this block was validated NOWHERE -- no `_ref` on the `when` keys,
                # no exact-value check, no `_validate_params` on `cond.params` -- so a typo'd key
                # would silently never match and a range predicate would silently never fire.
                # Validated the way component_ref's block already is.
                conds = s.get("conditions")
                if conds is not None:
                    if not isinstance(conds, list):
                        _vthrow(f"{where}: component conditions must be a list.")
                    for ci, c in enumerate(conds):
                        if not isinstance(c, dict):
                            _vthrow(f"{where} condition {ci}: must be an object.")
                        when = c.get("when")
                        if not isinstance(when, dict) or not when:
                            _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                        for wk, wv in when.items():
                            if isinstance(wv, (dict, list)):
                                _vthrow(
                                    f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                    "(attribute = value); range/in predicates are not executable."
                                )
                            _ref(wk, f"{where} condition {ci}")
                        _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "component_ref":
                # EA-2c legacy: base from a referenced row (ref.kind + optional ref.attributes) priced by
                # `formula`. EA-4a assembly: ref attrs INLINE (values literal | "@attr" | "@fitted_size"),
                # priced by rate_stages x qty (no formula). name + target always required; formula required
                # ONLY for the legacy shape.
                is_assembly = s.get("rate_stages") is not None or s.get("qty") is not None
                required = ("name", "target") if is_assembly else ("name", "target", "formula")
                for key in required:
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_ref needs a string '{key}'.")
                # REJECT WHAT CANNOT RUN (2026-09-10). The interpreter's component_ref branch splits on
                # shape: the ASSEMBLY shape (rate_stages / qty) prices `stageRate x qty` and `continue`s
                # BEFORE the legacy code that reads `conditions`, `params` and `formula`; the LEGACY
                # shape (ref.attributes + formula) never reads `none_skips`, which only the assembly
                # branch tests. Each was accepted here -- the conditions block below landed one day
                # BEFORE the assembly shape and was never re-scoped -- so a key could sit in a config
                # looking live while doing nothing at all. Measured before refusing: 79 assembly steps
                # live and NOT ONE, in any asset back to v12, has ever carried any of the three; the
                # only two legacy steps (earthing's bus-bar adder) carry `conditions` and EXECUTE it;
                # no legacy step has ever carried `none_skips`. The RM-4b editor cannot author any of
                # them. Refused by name rather than implemented: the legacy semantics bind
                # `cond.params` into a `formula`, and the assembly shape has neither, so there is no
                # meaning to execute -- that would be a new feature wearing a repair's name.
                if is_assembly:
                    for dead in ("conditions", "params", "formula"):
                        if dead in s:
                            _vthrow(
                                f"{where}: an assembly-shape component_ref (rate_stages / qty) carries "
                                f"'{dead}', which the interpreter never reads on this shape -- it would "
                                f"validate and silently do nothing. Remove it, or drop rate_stages/qty "
                                f"to make this a formula-priced (legacy) step."
                            )
                elif "none_skips" in s:
                    _vthrow(
                        f"{where}: a formula-priced (legacy) component_ref carries 'none_skips', which "
                        f"the interpreter reads only on the assembly shape (rate_stages / qty) -- it "
                        f"would validate and silently do nothing. Remove it."
                    )
                if is_assembly:
                    rs = s.get("rate_stages")
                    if rs is not None:
                        if not isinstance(rs, list):
                            _vthrow(f"{where}: component_ref rate_stages must be a list.")
                        for ri, stage in enumerate(rs):
                            if not isinstance(stage, dict) or not _is_finite_number(stage.get("mult")):
                                _vthrow(f"{where}: rate_stages[{ri}] needs a finite 'mult'.")
                            if stage.get("round") is not None and stage.get("round") not in ("up0", "up-1"):
                                _vthrow(f"{where}: rate_stages[{ri}].round must be 'up0' or 'up-1'.")
                            # point_wiring RUNS: an OPTIONAL attribute-bound factor folded in before this
                            # stage's rounding. REFERENCE-GUARDED so a typo'd id cannot pass silently
                            # (absent means 1 at runtime, so an unguarded typo would read as "no runs").
                            mfa = stage.get("mult_from_attr")
                            if mfa is not None:
                                if not isinstance(mfa, str) or not mfa:
                                    _vthrow(f"{where}: rate_stages[{ri}].mult_from_attr must be an attribute id.")
                                _ref(mfa, f"{where} (rate_stages[{ri}].mult_from_attr)")
                            # RULING 2 (owner 2026-08-09): THE STEP FUNCTION. The mult_from_attr factor
                            # becomes ceil(raw / divisor) -- wire install steps in threes while supply
                            # and BCS stay linear. It names a NUMBER (no attribute to _ref); its partner
                            # mult_from_attr is guarded just above. A non-positive divisor is REJECTED:
                            # the interpreter reads it as "no divisor" and multiplies linearly, so
                            # accepting it would ship a stage that looks stepped and is not.
                            msd = stage.get("mult_step_divisor")
                            if msd is not None:
                                if not _is_finite_number(msd) or msd <= 0:
                                    _vthrow(
                                        f"{where}: rate_stages[{ri}].mult_step_divisor must be a positive finite number."
                                    )
                                if mfa is None:
                                    # A divisor with nothing to divide is inert -- absentMeansOne makes the
                                    # factor 1 and ceil(1/d) is 1. Catch the orphan at save, not at runtime.
                                    _vthrow(
                                        f"{where}: rate_stages[{ri}].mult_step_divisor needs a "
                                        "'mult_from_attr' to step; on its own it does nothing."
                                    )
                    q = s.get("qty")
                    if q is not None and not (
                        _is_finite_number(q)
                        or (isinstance(q, dict) and ("from_attr" in q or "from_fit" in q or "if_attr" in q))
                    ):
                        _vthrow(f"{where}: component_ref qty must be a number or a from_attr/from_fit/if_attr object.")
                    # GUARD WHAT IS READ (2026-09-10). Until now the three qty sources were shape-checked
                    # (the key exists) and never RESOLVED, so a typo passed at save and failed at run time
                    # -- and not all failures are loud:
                    #   * `from_attr`: `Number(selected[x])` is NaN -> "quantity not provided", honest no_match;
                    #   * `if_attr`: `selected[k] === val` is simply FALSE -> the `else` branch, which is 0 in
                    #     every shipped use -> THE ROW PRICES WITHOUT THE COMPONENT, SILENTLY. Not a refusal,
                    #     not a warning: a total that looks finished and is short. This is the one that
                    #     matters most, and the reason the whole family is closed at save rather than run;
                    #   * `from_fit`: `ctx[x]` undefined -> "quantity not provided". It names a COMPUTED bind,
                    #     never an attribute (see `ctx_binds` above) -- a plain `_ref` here would refuse all
                    #     nine shipped uses, so it is checked against the binds declared earlier in this
                    #     pipeline instead.
                    if isinstance(q, dict):
                        if "from_attr" in q:
                            if not isinstance(q["from_attr"], str) or not q["from_attr"]:
                                _vthrow(f"{where}: component_ref qty.from_attr must be an attribute id.")
                            _ref_or_map(q["from_attr"], f"{where} (qty.from_attr)")
                        if "if_attr" in q:
                            ia = q["if_attr"]
                            if not isinstance(ia, dict) or not ia:
                                _vthrow(f"{where}: component_ref qty.if_attr must be a non-empty object of attribute = value.")
                            for ik, iv in ia.items():
                                if isinstance(iv, (dict, list)):
                                    _vthrow(
                                        f"{where}: component_ref qty.if_attr['{ik}'] must be an exact value "
                                        "(attribute = value); range/in predicates are not executable."
                                    )
                                _ref_or_map(ik, f"{where} (qty.if_attr)")
                            for branch in ("then", "else"):
                                if not _is_finite_number(q.get(branch)):
                                    _vthrow(f"{where}: component_ref qty.if_attr needs a finite '{branch}' quantity.")
                        if "from_fit" in q:
                            ff_key = q["from_fit"]
                            if not isinstance(ff_key, str) or not ff_key:
                                _vthrow(f"{where}: component_ref qty.from_fit must name a computed bind.")
                            if ff_key not in ctx_binds:
                                _vthrow(
                                    f"{where}: component_ref qty.from_fit '{ff_key}' names no computed bind "
                                    f"declared by an earlier step of this pipeline (declared so far: "
                                    f"{', '.join(sorted(ctx_binds)) or 'none'}) -- the quantity would read as "
                                    f"'not provided' on every row."
                                )
                    # EA-4a-r: none_skips (bool) -> a ref @attr resolving to "None" makes this an explicit zero.
                    if "none_skips" in s and not isinstance(s.get("none_skips"), bool):
                        _vthrow(f"{where}: component_ref none_skips must be true/false.")
                ref = s.get("ref")
                if not isinstance(ref, dict) or not isinstance(ref.get("kind"), str) or not ref.get("kind"):
                    _vthrow(f"{where}: component_ref needs ref.kind (a string).")
                ref_attrs = ref.get("attributes")
                if ref_attrs is not None:
                    if not isinstance(ref_attrs, dict):
                        _vthrow(f"{where}: component_ref ref.attributes must be an object of attribute = value.")
                    for ak, av in ref_attrs.items():
                        if isinstance(av, (dict, list)):
                            _vthrow(f"{where}: component_ref ref.attributes['{ak}'] must be an exact value.")
                if s.get("params") is not None:
                    _validate_params(s.get("params"), where)
                conds = s.get("conditions")
                if conds is not None:
                    if not isinstance(conds, list):
                        _vthrow(f"{where}: component_ref conditions must be a list.")
                    for ci, c in enumerate(conds):
                        if not isinstance(c, dict):
                            _vthrow(f"{where} condition {ci}: must be an object.")
                        when = c.get("when")
                        if not isinstance(when, dict) or not when:
                            _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                        for wk, wv in when.items():
                            if isinstance(wv, (dict, list)):
                                _vthrow(
                                    f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                    "(attribute = value); range/in predicates are not executable."
                                )
                            _ref(wk, f"{where} condition {ci}")
                        _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "component_band":
                for key in ("name", "band_on", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_band needs a string '{key}'.")
                _ref(s["band_on"], f"{where} (band_on)")
                bands = s.get("bands")
                if not isinstance(bands, list) or not bands:
                    _vthrow(f"{where}: component_band needs a non-empty bands list.")
                for bi, b in enumerate(bands):
                    if not isinstance(b, dict):
                        _vthrow(f"{where} band {bi}: must be an object.")
                    if not isinstance(b.get("when"), str) or not _BAND_WHEN_RE.match(b["when"].strip()):
                        _vthrow(f"{where} band {bi}: 'when' must be a comparator like '<35' or '>=35'.")
                    if not isinstance(b.get("target"), str) or not b.get("target"):
                        _vthrow(f"{where} band {bi}: needs a string 'target'.")
                _validate_params(s.get("params"), where)
            elif st == "sum_components":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: sum_components needs a string 'result'.")
                ctx_binds.add(s["result"])
            elif st == "install_as_ratio":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: install_as_ratio needs a string 'result'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("ratio")):
                    _vthrow(f"{where}: install_as_ratio needs params.ratio (a finite number).")
                ctx_binds.add(s["result"])
            elif st == "circuit_fit":
                # EA-4a: sizes the conduit + counts circuits. params.wire_specs reference attribute ids
                # (each a [core_attr, thickness_attr] pair) -> the reference guard covers them; length_attr
                # + conduit_type_attr likewise. sizes/usable are finite-number tables (structure, not attrs).
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: circuit_fit needs a params object.")
                if not isinstance(p.get("sizes"), list) or not all(_is_finite_number(x) for x in p.get("sizes") or []):
                    _vthrow(f"{where}: circuit_fit params.sizes must be a list of finite numbers.")
                if not isinstance(p.get("usable"), dict):
                    _vthrow(f"{where}: circuit_fit params.usable must be an object of conduit_type -> fractions.")
                for ct, fracs in p["usable"].items():
                    if not isinstance(fracs, list) or not all(_is_finite_number(x) for x in fracs):
                        _vthrow(f"{where}: circuit_fit usable['{ct}'] must be a list of finite numbers.")
                specs = p.get("wire_specs")
                if not isinstance(specs, list) or not specs:
                    _vthrow(f"{where}: circuit_fit needs a non-empty wire_specs list.")
                for wi, pair in enumerate(specs):
                    # point_wiring RUNS: an OPTIONAL third element names a parallel-runs attribute
                    # (conduit sizing becomes cores x runs). 2 stays valid -- every pre-existing config
                    # uses it and absence means 1 at runtime.
                    if (
                        not isinstance(pair, list)
                        or len(pair) not in (2, 3)
                        or not all(isinstance(x, str) and x for x in pair)
                    ):
                        _vthrow(
                            f"{where}: circuit_fit wire_specs[{wi}] must be a "
                            f"[core_attr, thickness_attr] pair, optionally with a third runs_attr."
                        )
                    for el in pair:
                        _ref(el, f"{where} (wire_specs)")
                for key in ("length_attr", "conduit_type_attr"):
                    if not isinstance(p.get(key), str) or not p.get(key):
                        _vthrow(f"{where}: circuit_fit needs a string '{key}'.")
                    _ref(p[key], f"{where} ({key})")
                if not isinstance(s.get("binds"), list) or not all(isinstance(b, str) and b for b in s.get("binds") or []):
                    _vthrow(f"{where}: circuit_fit needs a 'binds' list of strings.")
                # The three computed values this step writes into the run scope, by the names it declares
                # (an absent list means the interpreter's defaults) -- what a later `qty.from_fit` may read.
                ctx_binds.update(s.get("binds") or ["fitted_size", "circuits", "conduit_qty"])
                # EA-4a-r: optional_wire_when_none names the thickness attr of an OPTIONAL wire (omitted from
                # the dia when it is "None"). Reference-guard it like the other attr keys.
                own = p.get("optional_wire_when_none")
                if own is not None:
                    if not isinstance(own, str) or not own:
                        _vthrow(f"{where}: circuit_fit optional_wire_when_none must be an attribute id.")
                    _ref(own, f"{where} (optional_wire_when_none)")
                # PW-CONDUIT-OPTIONAL `absent_when: {attr, equals}` -- positive absence for the WHOLE conduit
                # (every bind takes the "None" sentinel, the rest of the row still prices). The SAME shape as
                # catalog_fit's, which v63 reference-guarded; this one was not (2026-09-10). Unguarded, a
                # typo'd `attr` reads `selected[undefined] === equals` as FALSE on every row, so the absence
                # never fires and a row that said it has no conduit is sized and priced for one -- silently.
                aw = p.get("absent_when")
                if aw is not None:
                    if not isinstance(aw, dict) or not isinstance(aw.get("attr"), str) or not aw.get("attr") or "equals" not in aw:
                        _vthrow(f"{where}: circuit_fit absent_when must be {{attr, equals}}.")
                    _ref_or_map(aw["attr"], f"{where} (absent_when.attr)")
            elif st == "module_fit":
                # SLICE 2. params.terms is the PARAMETERISED weighted sum (one term per quantity slot;
                # weights AND attribute ids are config, so the same step serves switches_sockets' TWO
                # socket slots and point_wiring's one). params.ladders each name a CATALOG family --
                # there is deliberately no size list to validate, because the ladder is derived from
                # the master rows, never from params. Every attribute id is _ref-guarded.
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: module_fit needs a params object.")
                terms = p.get("terms")
                if not isinstance(terms, list) or not terms:
                    _vthrow(f"{where}: module_fit needs a non-empty params.terms list.")
                for ti, t in enumerate(terms):
                    if not isinstance(t, dict):
                        _vthrow(f"{where}: module_fit terms[{ti}] must be an object.")
                    tattr = t.get("attr")
                    if not isinstance(tattr, str) or not tattr:
                        _vthrow(f"{where}: module_fit terms[{ti}] needs an 'attr' (an attribute id).")
                    _ref(tattr, f"{where} (terms[{ti}].attr)")
                    if not _is_finite_number(t.get("weight")):
                        _vthrow(f"{where}: module_fit terms[{ti}] needs a finite 'weight'.")
                    nw = t.get("none_when")
                    if nw is not None:
                        if not isinstance(nw, str) or not nw:
                            _vthrow(f"{where}: module_fit terms[{ti}].none_when must be an attribute id.")
                        _ref(nw, f"{where} (terms[{ti}].none_when)")
                ladders = p.get("ladders")
                if not isinstance(ladders, list) or not ladders:
                    _vthrow(f"{where}: module_fit needs a non-empty params.ladders list.")
                binds = set()
                for li, lad in enumerate(ladders):
                    if not isinstance(lad, dict):
                        _vthrow(f"{where}: module_fit ladders[{li}] must be an object.")
                    for key in ("kind", "bind"):
                        if not isinstance(lad.get(key), str) or not lad.get(key):
                            _vthrow(f"{where}: module_fit ladders[{li}] needs a string '{key}'.")
                    if lad["bind"] in binds:
                        _vthrow(f"{where}: module_fit ladders[{li}] repeats the bind '{lad['bind']}'.")
                    binds.add(lad["bind"])
                    lw = lad.get("where")
                    if lw is not None:
                        if not isinstance(lw, dict):
                            _vthrow(f"{where}: module_fit ladders[{li}].where must be an object of attribute = value.")
                        for wk, wv in lw.items():
                            if isinstance(wv, (dict, list)):
                                _vthrow(f"{where}: module_fit ladders[{li}].where['{wk}'] must be an exact value.")
                    for key in ("label_attr", "bind_modules"):
                        if lad.get(key) is not None and (not isinstance(lad.get(key), str) or not lad.get(key)):
                            _vthrow(f"{where}: module_fit ladders[{li}].{key}, when present, must be a non-empty string.")
                    if lad.get("bind_modules"):
                        ctx_binds.add(lad["bind_modules"])  # a computed module count, written into the run scope
                    # SLICE 2 part 2: floor_from names an ATTRIBUTE (the stated value this ladder
                    # fills the silence around), so it is REFERENCE-GUARDED like every other
                    # attribute id -- a typo would silently read as "nothing stated" and let the
                    # computed size override a stated plate, which is the one thing the rule forbids.
                    ff = lad.get("floor_from")
                    if ff is not None:
                        if not isinstance(ff, str) or not ff:
                            _vthrow(f"{where}: module_fit ladders[{li}].floor_from must be an attribute id.")
                        _ref(ff, f"{where} (ladders[{li}].floor_from)")
                    on_none = lad.get("on_none")
                    if on_none is not None and on_none not in ("computed", "none"):
                        _vthrow(
                            f"{where}: module_fit ladders[{li}].on_none must be 'computed' or 'none'."
                        )
                    # RULING 1 (owner 2026-08-09): the module COUNT this ladder falls back to when the
                    # computed count is ZERO (the back box's 3). It names a NUMBER, never a catalog
                    # label -- the ladder stays catalog-derived -- so there is no attribute to _ref.
                    # A non-positive value is REJECTED rather than tolerated: the interpreter treats it
                    # as "no fallback declared", so accepting it here would let a typo look configured
                    # while doing nothing at all.
                    ozm = lad.get("on_zero_modules")
                    if ozm is not None and (not _is_finite_number(ozm) or ozm <= 0):
                        _vthrow(
                            f"{where}: module_fit ladders[{li}].on_zero_modules, when present, "
                            "must be a positive finite number (a module count)."
                        )
                    # F-25 SLICE 2 / SLICE 3 (2026-09-08): `on_zero_from` (the stated count on the
                    # zero path) and `pick_from` (the pricer's pick, read on BOTH paths) each NAME AN
                    # ATTRIBUTE, so both are reference-guarded exactly like `floor_from`. The gap this
                    # closes was on the register: an unguarded `on_zero_from` typo read silently as
                    # "nothing stated -> assumed 3M", and an unguarded `pick_from` typo would read as
                    # "nothing picked" and leave the dropdown inert with no error anywhere.
                    for akey in ("on_zero_from", "pick_from"):
                        aval = lad.get(akey)
                        if aval is not None:
                            if not isinstance(aval, str) or not aval:
                                _vthrow(f"{where}: module_fit ladders[{li}].{akey} must be an attribute id.")
                            _ref(aval, f"{where} (ladders[{li}].{akey})")
                blanks = p.get("blanks")
                if blanks is not None:
                    if not isinstance(blanks, dict):
                        _vthrow(f"{where}: module_fit blanks must be an object.")
                    for key in ("bind", "from_ladder"):
                        if not isinstance(blanks.get(key), str) or not blanks.get(key):
                            _vthrow(f"{where}: module_fit blanks needs a string '{key}'.")
                    # The arbitrated blank COUNT is written into the run scope under `blanks.bind`
                    # (point_wiring / switches_sockets / popup_boxes read it back as `qty.from_fit`).
                    ctx_binds.add(blanks["bind"])
                    if blanks["from_ladder"] not in binds:
                        # A blank count keyed to a ladder that does not exist would compute nothing --
                        # catch it here rather than as a silent runtime no-compute.
                        _vthrow(
                            f"{where}: module_fit blanks.from_ladder '{blanks['from_ladder']}' "
                            f"names no ladder (declared: {', '.join(sorted(binds))})."
                        )
                    sa = blanks.get("stated_attr")
                    if sa is not None:
                        if not isinstance(sa, str) or not sa:
                            _vthrow(f"{where}: module_fit blanks.stated_attr must be an attribute id.")
                        _ref(sa, f"{where} (blanks.stated_attr)")
                    # THE ARBITRATED QUANTITY. Names the attribute holding the blank count the row
                    # states; module_fit weighs it against the plate's spare capacity. It IS an
                    # attribute id, so it is _ref-guarded -- a typo here would silently stop the step
                    # ever finding a stated value to arbitrate on, which is quieter than a no-compute
                    # and worse (the same reasoning as derive_attribute's result_attr).
                    qa = blanks.get("qty_attr")
                    if qa is not None:
                        if not isinstance(qa, str) or not qa:
                            _vthrow(f"{where}: module_fit blanks.qty_attr must be an attribute id.")
                        _ref(qa, f"{where} (blanks.qty_attr)")
                    # THE ITEM BIND. `bind_item` is a fitLabels KEY, not an attribute id, so it is NOT
                    # _ref-guarded -- exactly like a ladder's `bind`, which names the scope a later
                    # component_ref reads with "@<key>". `item_when_positive` is a CATALOG ITEM NAME.
                    bi = blanks.get("bind_item")
                    iwp = blanks.get("item_when_positive")
                    for key, val in (("bind_item", bi), ("item_when_positive", iwp)):
                        if val is not None and (not isinstance(val, str) or not val):
                            _vthrow(
                                f"{where}: module_fit blanks.{key}, when present, "
                                f"must be a non-empty string."
                            )
                    # BOTH OR NEITHER. A bind_item with no item_when_positive has nothing to bind on a
                    # positive count (the interpreter refuses the row rather than silently pricing
                    # zero); an item_when_positive with no bind_item is dead config that reads as
                    # though it does something. Catch both here rather than at runtime.
                    if (bi is None) != (iwp is None):
                        _vthrow(
                            f"{where}: module_fit blanks needs 'bind_item' and 'item_when_positive' "
                            f"together -- one without the other binds nothing."
                        )
                # INCLUDES-MODULES GATE (owner rulings 2026-09-10). `include_when: {attr, equals}` names
                # the attribute that says whether the modules are in the price at all (popup_boxes'
                # `has_modules` / "Yes"). Three guards, each closing a SILENT failure:
                #   * `attr` is `_ref`-guarded like `floor_from` / `pick_from` -- a typo would otherwise
                #     read every row as "blank" and refuse the whole category with no error anywhere;
                #   * `equals` must be one of the attribute's declared `values` when it carries a list --
                #     an `equals: "yes"` typo would otherwise EXCLUDE every Yes row (the switch reads
                #     "not equal" as No), a wrong price that looks finished;
                #   * every term must carry `none_when` -- the gate excludes a term THROUGH its item bind,
                #     so a term without one could not be excluded and would price under No, silently.
                # NOTE: since 2026-09-10 the loader (`services/boq_rate_master/loader.py`) runs this
                # validator on every config it would write, so an asset typo here is refused AT IMPORT
                # (before that, only the api write path and test_92 caught it, after the fact).
                iw = p.get("include_when")
                if iw is not None:
                    if (
                        not isinstance(iw, dict)
                        or not isinstance(iw.get("attr"), str) or not iw.get("attr")
                        or not isinstance(iw.get("equals"), str) or not iw.get("equals")
                    ):
                        _vthrow(
                            f"{where}: module_fit include_when must be an object "
                            f"{{attr: <attribute id>, equals: <one of its values>}}."
                        )
                    _ref(iw["attr"], f"{where} (include_when.attr)")
                    gate_def = next((d for d in defs if isinstance(d, dict) and d.get("id") == iw["attr"]), None)
                    gate_values = gate_def.get("values") if isinstance(gate_def, dict) else None
                    if isinstance(gate_values, list) and gate_values and iw["equals"] not in gate_values:
                        _vthrow(
                            f"{where}: module_fit include_when.equals '{iw['equals']}' is not one of "
                            f"'{iw['attr']}' values ({', '.join(str(v) for v in gate_values)}) -- "
                            f"every row would read as excluded."
                        )
                    for ti, t in enumerate(terms):
                        if not t.get("none_when"):
                            _vthrow(
                                f"{where}: module_fit include_when needs every term to carry none_when -- "
                                f"terms[{ti}] ('{t.get('attr')}') has none, so the gate could not exclude it."
                            )
            elif st == "catalog_fit":
                # CONDUIT TRADE SIZE (v63): the step was PASS-THROUGH until a second category adopted it.
                # Every attribute id it names is now _ref-guarded: `bind` / `fit_into` / `fit_from.attr` /
                # `prefer_attr` / `absent_when.attr` and every "@" reference in `where`. An unguarded typo in
                # any of them reads silently as "nothing stated" and the ladder fits nothing -- the whole
                # category refuses with no signal. `size_from.attr` and `label_attr` name CATALOGUE columns,
                # not attributes, and are shape-checked only.
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: catalog_fit needs a params object.")
                for key in ("bind", "kind"):
                    if not isinstance(p.get(key), str) or not p.get(key):
                        _vthrow(f"{where}: catalog_fit needs a non-empty string '{key}'.")
                # `bind` is a LABEL SLOT (fitLabels), read back through "@bind" by a component_ref -- it need
                # not be an attribute (industrial_sockets binds `paired_mcb`), so it is shape-checked only.
                # A "@" reference may ALSO resolve to a `map_attribute` TARGET written into the selection
                # earlier in the pipeline (industrial_sockets' `@mcb_pole` / `@mcb_curve`), so a name that is
                # a map target in THIS config is legal without a definition; everything else must be one.
                # `_ref_or_map` (and its `map_targets`) is now defined ONCE above the pipelines loop
                # (2026-09-10) and shared with the component_ref qty and circuit_fit absent_when reads.
                ff = p.get("fit_from")
                if not isinstance(ff, dict) or not isinstance(ff.get("attr"), str) or not ff.get("attr"):
                    _vthrow(f"{where}: catalog_fit needs fit_from {{attr}} naming the attribute whose stated value is fitted.")
                _ref_or_map(ff["attr"], f"{where} (fit_from.attr)")
                for key in ("fit_into", "prefer_attr"):
                    if p.get(key) is not None:
                        if not isinstance(p.get(key), str) or not p.get(key):
                            _vthrow(f"{where}: catalog_fit {key}, when present, must be an attribute id.")
                        _ref_or_map(p[key], f"{where} ({key})")
                sf = p.get("size_from")
                if sf is not None and (not isinstance(sf, dict) or not isinstance(sf.get("attr"), str) or not sf.get("attr")):
                    _vthrow(f"{where}: catalog_fit size_from, when present, must be {{attr}} naming a catalogue column.")
                if p.get("label_attr") is not None and (not isinstance(p.get("label_attr"), str) or not p.get("label_attr")):
                    _vthrow(f"{where}: catalog_fit label_attr, when present, must be a non-empty string.")
                aw = p.get("absent_when")
                if aw is not None:
                    if not isinstance(aw, dict) or not isinstance(aw.get("attr"), str) or not aw.get("attr") or "equals" not in aw:
                        _vthrow(f"{where}: catalog_fit absent_when must be {{attr, equals}}.")
                    _ref_or_map(aw["attr"], f"{where} (absent_when.attr)")
                cw = p.get("where")
                if cw is not None:
                    if not isinstance(cw, dict):
                        _vthrow(f"{where}: catalog_fit where must be an object of catalogue column = value or \"@attribute\".")
                    for wk, wv in cw.items():
                        for member in (wv if isinstance(wv, list) else [wv]):
                            if isinstance(member, str) and member.startswith("@"):
                                if len(member) < 2:
                                    _vthrow(f"{where}: catalog_fit where['{wk}'] carries an empty \"@\" reference.")
                                _ref_or_map(member[1:], f"{where} (where['{wk}'])")
                if p.get("direction") is not None and p.get("direction") not in ("up", "down"):
                    _vthrow(f"{where}: catalog_fit direction must be 'up' or 'down'.")
                if p.get("on_miss") is not None and (not isinstance(p.get("on_miss"), str) or not p.get("on_miss")):
                    _vthrow(f"{where}: catalog_fit on_miss, when present, must be a non-empty string.")
            elif st == "derive_attribute":
                # CIRCUIT LENGTH part 1. params.terms binds formula identifiers to ATTRIBUTE ids and
                # params.constants holds the rule's fixed numbers -- so the formula, its inputs AND its
                # target are all config, never hardcoded (the module_fit terms precedent). EVERY
                # attribute id here is _ref-guarded, result_attr included: an unguarded typo in the
                # target would silently stop the step ever finding a stated value to defer to.
                p = s.get("params")
                if not isinstance(p, dict):
                    _vthrow(f"{where}: derive_attribute needs a params object.")
                ra = p.get("result_attr")
                if not isinstance(ra, str) or not ra:
                    _vthrow(f"{where}: derive_attribute needs a string 'result_attr' (an attribute id).")
                _ref(ra, f"{where} (result_attr)")
                if not isinstance(p.get("formula"), str) or not p.get("formula"):
                    _vthrow(f"{where}: derive_attribute needs a non-empty string 'formula'.")
                terms = p.get("terms")
                if not isinstance(terms, list) or not terms:
                    _vthrow(f"{where}: derive_attribute needs a non-empty params.terms list.")
                idents = set()
                for ti, t in enumerate(terms):
                    if not isinstance(t, dict):
                        _vthrow(f"{where}: derive_attribute terms[{ti}] must be an object.")
                    for key in ("ident", "attr"):
                        if not isinstance(t.get(key), str) or not t.get(key):
                            _vthrow(f"{where}: derive_attribute terms[{ti}] needs a string '{key}'.")
                    if t["ident"] in idents:
                        # Two terms binding the SAME identifier means one silently wins -- so the
                        # formula would read an input the author did not choose.
                        _vthrow(f"{where}: derive_attribute terms[{ti}] repeats the ident '{t['ident']}'.")
                    idents.add(t["ident"])
                    _ref(t["attr"], f"{where} (terms[{ti}].attr)")
                consts = p.get("constants")
                if consts is not None:
                    if not isinstance(consts, dict):
                        _vthrow(f"{where}: derive_attribute constants must be an object.")
                    for ck, cv in consts.items():
                        if ck in idents:
                            # A constant sharing a term's identifier makes the formula ambiguous.
                            _vthrow(
                                f"{where}: derive_attribute constant '{ck}' collides with a term ident."
                            )
                        if not _is_finite_number(cv):
                            _vthrow(f"{where}: derive_attribute constant '{ck}' must be a finite number.")
                unit = p.get("unit")
                if unit is not None and (not isinstance(unit, str) or not unit):
                    _vthrow(f"{where}: derive_attribute unit, when present, must be a non-empty string.")

    # REFERENCE GUARD: every attr a pipeline references must be defined (names where each is used) ----
    missing = {a: locs for a, locs in referenced.items() if a not in def_ids}
    if missing:
        parts = [f"'{a}' (referenced by {', '.join(locs)})" for a, locs in sorted(missing.items())]
        _vthrow(
            "These attributes are referenced by a pipeline but not defined: "
            + "; ".join(parts)
            + ". Add the definition, or remove the references first."
        )

    # goldens (optional) ---------------------------------------------------------------------
    goldens = cfg.get("goldens")
    if goldens is not None:
        if not isinstance(goldens, list):
            _vthrow("goldens must be a list.")
        for gi, g in enumerate(goldens):
            if not isinstance(g, dict):
                _vthrow(f"goldens[{gi}] must be an object.")
            if not isinstance(g.get("attrs"), dict) or not g.get("attrs"):
                _vthrow(f"goldens[{gi}] needs a non-empty attrs object.")
            expect = g.get("expect")
            if not isinstance(expect, dict) or not expect:
                _vthrow(f"goldens[{gi}] needs a non-empty expect object.")
            for epid, emap in expect.items():
                if epid not in pipelines:
                    _vthrow(f"goldens[{gi}] expects unknown pipeline '{epid}'.")
                if not isinstance(emap, dict) or not emap:
                    _vthrow(f"goldens[{gi}] expect['{epid}'] must be a non-empty object.")
                for ek, ev in emap.items():
                    if not _is_finite_number(ev):
                        _vthrow(f"goldens[{gi}] expect['{epid}']['{ek}'] must be a finite number.")

    return referenced

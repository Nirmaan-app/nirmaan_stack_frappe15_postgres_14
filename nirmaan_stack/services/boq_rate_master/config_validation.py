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
    # SLICE 12b(A): THE PRICING-INPUT READER. Loads one stored rate off a catalogue row into ctx WITHOUT
    # touching the `components` accumulator -- which is the whole reason it is not `component_ref`.
    # FULLY validated below: the three keys it needs are required, and the three it must never carry are
    # refused BY NAME, because each of them would silently change what the step means.
    "rate_ref",
}

# SLICE 12b(A): the step types that actually BIND a `<ident>_from_ctx` param. A `_from_ctx` on any other
# step type is refused by name -- the standing rule that the validator refuses a key the interpreter
# cannot run on that shape rather than implementing it. Keep this in step with the interpreter's arms.
_CTX_ARM_STEPS = {"scale", "component", "component_band", "install_as_ratio", "apply_effective_multiplier"}

# The keys `rate_ref` must never carry. An input is a SCALAR, not a component: a `qty` would multiply it,
# `rate_stages` would re-scale it, and `none_skips` would turn a missing input into a silent zero -- each
# one changes the meaning of the step while still looking like valid config.
_RATE_REF_FORBIDDEN = ("qty", "rate_stages", "none_skips", "formula", "conditions", "params")
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
    # SLICE 1c (2026-09-21, owner S-a..S-c): `attributes_from_spec: true` opts a category in to the SPEC
    # READER -- item_name + item_detail are the source of truth and every other attribute is READ from
    # them (services/boq_rate_master/spec_reader.py); the CSV omits the derived columns, the screen shows
    # them read-only, and the manual add/edit form runs the same reader. Pass-through here (allowlist
    # only, like item_kinds): the consumers branch on `spec_reader.spec_categories`, which reads the key
    # as `is True`, so a category WITHOUT it -- every Electrical category -- is byte-identical to before.
    "attributes_from_spec",
    # SLICE 2 (2026-09-22, owner P-a / P-b / P-c): a category with NOTHING TO PRICE declares its
    # message and its pending mark IN CONFIG, never in code (the HV-10 rule -- no category named
    # in code). `helper_message` is what the rate-helper panel and the calculator show instead of
    # the generic "coming soon" for a config that is not eligible for pricing; `pending_label` is
    # the mark shown on every empty / zero rate cell of a row in that category until a non-zero
    # rate is typed. Pass-through here (allowlist only, like item_kinds): the consumers are the
    # frontend `pricingSheetHelper.compute` and the pricing grid; a config WITHOUT them -- every
    # Electrical category, and HVAC ADP -- is byte-identical to before.
    "helper_message", "pending_label",
    # SLICE 3 (2026-09-22, owner Q-a / Q-b): `alias_of = {discipline, category_id}` -- this category's
    # rows RESOLVE to another discipline's config, items and catalogue at lookup time; NOTHING is ever
    # copied between disciplines (a copy would drift: production edits rates by CSV). Structurally
    # validated below (`_validate_alias_of`): an alias config holds NO pipelines and NO attribute
    # definitions of its own and may not point at itself. A chain (alias -> alias) cannot be seen
    # here (one config at a time) and is resolved ONE HOP ONLY by the consumers: the target's own
    # emptiness makes it ineligible, so the row shows the coming-soon card, never an error.
    "alias_of",
    # SLICE 4 (2026-09-23, owner W-a..W-e): `matching_mode: "item_list"` asks the model for a LIST of
    # items per row, each with its own attributes; `list_spec` declares the PER-ITEM attribute
    # definitions (types choice | number | text -- text keeps sizes and torques AS STATED, W-d), the
    # family attribute and the per-row-unit quantity attribute. Validated below (`_validate_list_spec`).
    # "None" on an allow_none item attribute means NOT MENTIONED (code applies the owner's default
    # later, W-c); an absent value means COULD NOT TELL (the row is not priced, W-b).
    "list_spec",
    # SLICE 12a (2026-09-26, owner I-2 / I-4 / I-6): `derived_rates` records, per (item_uid, rate_key),
    # that a cost comes from ANOTHER catalogue row -- GENERATED at mint from the config's own
    # `component_ref` steps (or, for a category with no pipelines, from the source workbook's own
    # formulas), FLATTENED to the ultimate base, and changed only by minting. `rate_composition`
    # declares how a category's stored cost PARTS make up its supply / install cost, so the rate
    # file's and the screen's row-level formula columns can show each step's own result. BOTH are
    # structurally validated below; ABSENT from a config means byte-identical to before slice 12a,
    # which is every Electrical category and every HVAC category but ADP and Insulation.
    "derived_rates", "rate_composition",
    # SLICE 12c FINISH (owner F5): `column_order` -- a category's own PRESENTATION order for the rate
    # file and the Rate Master screen. It exists because the only order lever before it was
    # `rate_composition`, which CARRIES PRICING MEANING (the formula renderer, `_composition_role` and, for
    # a pipeline-less category, the generated `derived_rates` all read it), so reordering columns
    # through it would reword the formula row -- the owner asked for the structure to vary per
    # category, and this is the lever that does only that. Validated by `_validate_column_order`.
    "column_order",
    # SLICE 12c FINISH (owner ruling on FA7, 2026-10-04): `calculator_only` -- a category whose
    # pricing rules are COMPLETE and PROVEN but which is deliberately not yet wired into BoQ rows may
    # be priced in the PRICING CALCULATOR TAB while staying out of the BoQ panel and out of the
    # extraction population. It is a TEMPORARY admission with a declared removal condition: the slice
    # that makes the category fully eligible REMOVES this key in the same change, so there is never a
    # second on/off switch. `_validate_calculator_only` refuses it on a config that is already
    # eligible, which is what makes that promise mechanical rather than remembered.
    "calculator_only",
}

_LIST_MODE = "item_list"
_LIST_DEF_TYPES = ("choice", "number", "text")
_LIST_DEF_KEYS = {"id", "label", "type", "values", "allow_none", "note", "values_by_family"}


def _validate_list_spec(cfg):
    """SLICE 4: the shape of `list_spec` and its coupling to the item_list mode. Absent key and a mode
    other than item_list => nothing to check (byte-identical to before)."""
    mode = cfg.get("matching_mode")
    if "list_spec" not in cfg and mode != _LIST_MODE:
        return
    if mode != _LIST_MODE:
        _vthrow("list_spec is only meaningful with matching_mode 'item_list'.")
    spec = cfg.get("list_spec")
    if not isinstance(spec, dict):
        _vthrow("matching_mode 'item_list' needs a list_spec object.")
    unknown = set(spec.keys()) - {"attribute_definitions", "family_attribute_id", "qty_attribute_id", "second_opinion", "pricing"}
    if unknown:
        _vthrow(f"list_spec: unknown key(s): {', '.join(sorted(unknown))}.")
    if "second_opinion" in spec and not isinstance(spec["second_opinion"], bool):
        _vthrow("list_spec.second_opinion must be true or false.")   # CHECK 2 switch (owner 2026-09-23)
    defs = spec.get("attribute_definitions")
    if not isinstance(defs, list) or not defs:
        _vthrow("list_spec.attribute_definitions must be a non-empty list.")
    by_id = {}
    for i, d in enumerate(defs):
        if not isinstance(d, dict):
            _vthrow(f"list_spec.attribute_definitions[{i}] must be an object.")
        did = d.get("id")
        if not isinstance(did, str) or not did.strip():
            _vthrow(f"list_spec.attribute_definitions[{i}] needs a non-empty string id.")
        if did in by_id:
            _vthrow(f"list_spec: duplicate item attribute id '{did}'.")
        unknown_def = set(d.keys()) - _LIST_DEF_KEYS
        if unknown_def:
            _vthrow(f"list_spec item attribute '{did}': unknown key(s) {', '.join(sorted(unknown_def))}.")
        if not isinstance(d.get("label"), str) or not d.get("label"):
            _vthrow(f"list_spec item attribute '{did}' needs a label.")
        if d.get("type") not in _LIST_DEF_TYPES:
            _vthrow(f"list_spec item attribute '{did}': type must be one of {', '.join(_LIST_DEF_TYPES)}.")
        if d["type"] == "choice":
            vals = d.get("values")
            if not isinstance(vals, list) or not vals or not all(isinstance(v, str) and v.strip() for v in vals):
                _vthrow(f"list_spec item attribute '{did}': a choice needs a non-empty list of string values.")
        elif "values" in d:
            _vthrow(f"list_spec item attribute '{did}': only a choice carries values.")
        if "allow_none" in d and not isinstance(d["allow_none"], bool):
            _vthrow(f"list_spec item attribute '{did}': allow_none must be true or false.")
        if "values_by_family" in d and d.get("type") != "choice":
            _vthrow(f"list_spec item attribute '{did}': only a choice carries values_by_family.")
        by_id[did] = d
    # the family reference is REQUIRED; the qty reference is OPTIONAL (owner ruling D, 2026-09-23: unit
    # rates -- code uses 1, the user changes it in the panel -- so a spec need not ask for a quantity)
    for key, want, required in (("family_attribute_id", "choice", True), ("qty_attribute_id", "number", False)):
        ref = spec.get(key)
        if ref is None and not required:
            continue
        if not isinstance(ref, str) or ref not in by_id:
            _vthrow(f"list_spec.{key} must name one of the item attribute definitions.")
        if by_id[ref]["type"] != want:
            _vthrow(f"list_spec.{key} must name a {want} attribute.")
    # values_by_family (owner design fix, 2026-09-23): a per-family CHOICE list -- every key names one of
    # the family attribute's values, every listed value is one of the def's own values (the union), so the
    # sheet's ladder distinction (fire damper with sleeve / without sleeve / motorised / UL) survives as a
    # closed pick and never as free text
    family_vals = set(by_id[spec["family_attribute_id"]].get("values") or [])
    for did, d in by_id.items():
        vbf = d.get("values_by_family")
        if vbf is None:
            continue
        if not isinstance(vbf, dict) or not vbf:
            _vthrow(f"list_spec item attribute '{did}': values_by_family must be a non-empty object.")
        for fam, vals in vbf.items():
            if fam not in family_vals:
                _vthrow(f"list_spec item attribute '{did}': values_by_family key '{fam}' is not a family value.")
            if not isinstance(vals, list) or not vals or not all(isinstance(v, str) and v in d["values"] for v in vals):
                _vthrow(f"list_spec item attribute '{did}': values_by_family['{fam}'] must list values from the attribute's own values.")
    # SLICE 5 (2026-09-24, owner R1-R21): the item-list PRICING block, validated in its own namespace below
    if "pricing" in spec:
        _validate_list_pricing(spec, by_id, family_vals, cfg)


# SLICE 5 -- the keys `list_spec.pricing` may carry. The block is DATA the frontend `itemListPricing` module
# executes; a misspelled key here would ship a silently inert rule, so the allowlists are closed (the
# `_KNOWN_DEF_KEYS` precedent).
_PRICING_KEYS = {"kind", "unit_class_attr", "unit_classes", "unit_words", "unit_factors", "family_alias",
                 "no_sku_families", "defaults",
                 "derive_when_none", "override_when", "numbers", "ladders", "match_attrs", "choice_attrs",
                 "reason_names", "families", "panel_controls", "second_key",
                 # SLICE 12c: the two blocks `ladderResolution.ts` reads. Each arrives WITH its shape
                 # check below -- a key this allowlist admits but nothing validates is the
                 # "validates but never executes" failure, and it is the whole reason this file exists.
                 "size_match", "compose", "label_attr", "number_defaults", "typed_cladding",
                 # SLICE 12c FINISH (owner FA8): one plain-English line per TYPED field saying what
                 # to enter. REQUIRED wherever `panel_controls` admits typing -- see
                 # `_validate_calculator_only`'s neighbour below.
                 "panel_notes"}
# SLICE 12c FINISH (owner F1: "missing thickness -> 9 mm default"). `defaults` cannot express this --
# it requires a CHOICE attribute carrying `allow_none`, and a thickness is a NUMBER read through
# `numbers`. A separate key rather than a widening of `defaults`, because the two differ in what they
# are FOR: `defaults` turns the model's "not mentioned" into a ruled value, while this fills a number
# the row never stated at all. ABSENT => nothing is defaulted and every category is unchanged.
_PRICING_NUMBER_DEFAULT_KEYS = {"value", "families", "rule"}
# SLICE 12c -- a stated value and a catalogue rung that are the SAME size written to different precision.
# `dp` is the rounding depths to try, in order. ABSENT => nothing resolves and the ladder decides, exactly
# as before. A depth that is not collision-free over a family's rungs is SKIPPED at run time, never
# resolved arbitrarily, so the config cannot make the match order-dependent.
_PRICING_SIZE_MATCH_KEYS = {"dp"}
# SLICE 12c (owner Q8) -- above the top rung, build the value out of TWO OR MORE rungs within `tolerance`.
# ⚠️ `max_layers` BELOW 2 IS REFUSED BY NAME. One layer is what the ordinary ladder already is, so a
# one-layer "composition" is that ladder wearing the tolerance as a disguise -- able to shave a stated
# value DOWN, which is exactly the 26 -> 25 exception the owner refused.
# SLICE 12c FINISH (owner C-R1, 2026-10-04): `cost_key` -- the rate key whose SUM breaks a tie
# that closeness could not: "lowest insulation material cost (cost_insulation of the layers
# summed)". Declared here so no rate name is written in frontend code; ABSENT leaves the
# deterministic fallback deciding, exactly as every composition did before the key existed.
_PRICING_COMPOSE_KEYS = {"attr", "tolerance", "max_layers", "outer_only", "cost_key"}
_PRICING_COMPOSE_REQUIRED = {"attr", "tolerance", "max_layers"}
_PRICING_OUTER_ONLY_KEYS = {"attr", "value"}
# SLICE 11 (owner ruling, 2026-09-25): a unit may BELONG to a class and still be a DIFFERENT unit of that
# class -- a square foot is an area, but the catalogue quotes per square metre. Such a unit is declared here,
# NEVER in `unit_classes`: a `unit_classes` spelling is a SYNONYM (factor 1, nothing is scaled), and a
# `unit_factors` spelling carries a CONVERSION FACTOR to the class's own unit. The factor converts the RATE,
# never the BoQ's quantity. ABSENT => every row is byte-identical to before this slice.
_PRICING_UNIT_FACTOR_KEYS = {"class", "factor", "word"}


def _norm_unit_spelling(s):
    """The SAME normalisation the frontend reader uses (`itemListPricing.normUnit`): trim, lower-case, strip
    ONE trailing dot, collapse whitespace. Duplicated across the language boundary on purpose -- the client
    reads units and the validator must refuse a spelling the client would resolve twice. ONE trailing dot,
    not every trailing dot, and in the client's own order -- trim, lower, drop the dot, collapse space."""
    return re.sub(r"\s+", " ", re.sub(r"\.$", "", str(s or "").strip().lower()))
# SLICE 6b (owner V1, V4, V5): the panel's control per attribute -- "dropdown" (options from the active SKUs / the
# definition) or "text" (a BoQ measurement). Declared in config, never in code; it sits inside `list_spec.pricing`,
# which the model-side projection (`extraction.build_items_spec`) never reads, so it can never reach the model.
# SLICE 12c FINISH (owner FA8, 2026-10-04): `dropdown_or_other` -- a live dropdown of the values the
# CATALOGUE stocks PLUS an "other" entry for the value the BoQ actually states. A size needs both:
# the options must come from the SKUs (so a new catalogue row is a new option with no code change),
# and an unstocked size must still be typeable, because the ladder, the rounding and the composition
# rules all exist to resolve exactly that. A plain `dropdown` on a size would silently remove the
# only way to say what the document says.
_PANEL_CONTROLS = {"dropdown", "text", "dropdown_or_other"}
# the controls that let a person TYPE: each one must declare what to type (`panel_notes`)
_TYPED_CONTROLS = {"text", "dropdown_or_other"}
# SLICE 9 (owner A-1): `component` -- this SKU attribute is ONE AXIS (1 width, 2 height, 3 depth) of a size the
# row writes as a SINGLE phrase, which CODE splits. ABSENT => the reader is byte-identical to before.
_PRICING_NUMBER_KEYS = {"from", "name", "unit", "square", "ratio", "reject_tokens", "reject_below", "range", "component"}
# SLICE 9 (owner A-4): `second_key` -- a second match key beside a family's primary one (a diffuser's OUTER size
# beside its neck). Closed, like every other block here: a misspelled key would ship a silently inert rule.
_PRICING_SECOND_KEY_KEYS = {"families", "primary", "key", "alt_key", "name", "primary_pick"}
_PRICING_PRIMARY_PICKS = {"largest"}
_PRICING_FAMILY_KEYS = {"needs", "units", "convert"}
_PRICING_UNIT_KEYS = {"needs", "pipelines"}
_PRICING_CONVERT_KEYS = {"to", "needs", "rule", "pipelines"}
# SLICE 6 (owner S6): `absent_as_none` -- an ABSENT answer is read as NOT MENTIONED, so the default fires on it too
# (declared per attribute; the owner ruled it for UL ONLY, and the config is where that stays).
_PRICING_DEFAULT_KEYS = {"value", "by_family", "rule", "absent_as_none"}
_PRICING_DERIVE_KEYS = {"attr", "families", "when", "then", "rule"}
# SLICE 8 (owner M-b): `override_when` -- a stated fact that DECIDES the pick whatever else the row said. Same
# five keys as `derive_when_none` on purpose; what differs is when it fires (that one fills a "None", this one
# REPLACES a stated value), so the shape check is deliberately shared and the SEMANTIC difference lives in the
# frontend module. Its `attr` need NOT be allow_none -- an override does not depend on the row saying nothing.
# SLICE 9 (owner A-6): `display` -- OPTIONAL, what the PANEL shows for the overridden field (the catalogue's
# own word for the thing the row now prices as). It never reaches the model and never reaches the matcher.
_PRICING_OVERRIDE_KEYS = {"attr", "families", "when", "then", "rule", "display"}
_PRICING_OVERRIDE_REQUIRED = {"attr", "families", "when", "then", "rule"}
# The interpreter steps an item-list pipeline may use. EXISTING vocabulary only -- no member here is a
# new step type; each is already implemented, tested and shipped on the config-level path.
#
# SLICE 12c widens it by TWO, and the widening is what makes an item-list category able to price from a
# PRICING INPUT at all:
#   * `rate_ref`  -- reads one stored input into ctx. Without it `list_spec.pricing` pipelines cannot see
#                    a Pricing Input, so Insulation could not read the aluminium / glass-cloth / GI
#                    numbers and every one of them would have had to stay a literal in the config -- the
#                    exact thing 12b(A) removed for Electrical.
#   * `component` -- a component whose `conditions` branch on the SELECTION. Insulation's cladding is one
#                    formula with a per-cladding parameter set (aluminium x overlap, glass cloth, the GI
#                    pair, a flat foil rate, zero); `component_ref` cannot express that because it reads
#                    ANOTHER ROW rather than branching on this one's answer.
#
# ⚠️ WIDENING A CLOSED ALLOWLIST IS ONLY SAFE BECAUSE THE TWO ARRIVE WITH THEIR SHAPE CHECKS, IN THIS
# SAME CHANGE (see `_validate_pricing_pipelines`). A member added here without its branch below would be
# accepted and never checked -- the "config key that validates but never executes" failure one level
# down, which is precisely what this file exists to prevent.
#
# ⚠️ MEASURED NO-OP FOR ADP, the only shipped item-list category: its `list_spec` pipelines use
# match_master_row (62), scale (124), roundup (64), component_ref (2) and sum_components (2) -- not one
# `rate_ref` and not one `component`. Widening the set cannot change what it already validates.
_PRICING_STEP_TYPES = {"match_master_row", "component_ref", "sum_components", "scale", "roundup",
                       "rate_ref", "component"}


def _validate_list_pricing(spec, by_id, family_vals, cfg):
    """SLICE 5: the shape of `list_spec.pricing` -- the ADP pricing rules as CONFIG. Every attribute a rule names
    is checked in the namespace it reads from: a SKU attribute (a `numbers` key, a `choice_attrs` entry or the
    projected `unit_class_attr`), a model text attribute (`numbers[*].from` must name a `text` item def), a family
    (a family-attribute value, or an alias target that is one), a unit class (a `unit_classes` key). Every pipeline
    step is one of the existing interpreter steps, with the same per-step shape checks the config-level pipelines
    get. A block that names nothing wrong but is absent is byte-identical to before (the key is optional)."""
    pr = spec.get("pricing")
    if not isinstance(pr, dict):
        _vthrow("list_spec.pricing must be an object.")
    unknown = set(pr.keys()) - _PRICING_KEYS
    if unknown:
        _vthrow(f"list_spec.pricing: unknown key(s): {', '.join(sorted(unknown))}.")
    for key in ("kind", "unit_class_attr"):
        if not isinstance(pr.get(key), str) or not pr.get(key).strip():
            _vthrow(f"list_spec.pricing.{key} must be a non-empty string.")
    kinds = cfg.get("item_kinds") or []
    if pr["kind"] not in kinds:
        _vthrow(f"list_spec.pricing.kind '{pr['kind']}' is not one of the config's item_kinds.")
    ucls = pr.get("unit_classes")
    if not isinstance(ucls, dict) or not ucls or not all(
        isinstance(k, str) and isinstance(v, list) and v and all(isinstance(x, str) and x.strip() for x in v) for k, v in ucls.items()
    ):
        _vthrow("list_spec.pricing.unit_classes must map each class to a non-empty list of unit spellings.")
    if pr["unit_class_attr"] in by_id:
        _vthrow(f"list_spec.pricing.unit_class_attr '{pr['unit_class_attr']}' collides with an item attribute definition.")
    uw = pr.get("unit_words")
    if uw is not None and (not isinstance(uw, dict) or set(uw) - set(ucls) or not all(isinstance(v, str) and v for v in uw.values())):
        _vthrow("list_spec.pricing.unit_words must name unit classes only, each with a word.")
    # SLICE 11: `unit_factors` -- a unit of a declared class quoted in a DIFFERENT unit of it. The factor
    # scales the RATE to that unit; `word` is how the note names it. A factor of 1 is a SYNONYM and belongs
    # in `unit_classes`, so it is refused here -- otherwise one unit could be declared twice, in two places,
    # and the reader would silently pick one.
    uf = pr.get("unit_factors")
    if uf is not None:
        if not isinstance(uf, dict) or not uf:
            _vthrow("list_spec.pricing.unit_factors must be a non-empty object of unit spelling -> {class, factor, word}.")
        known = set()
        for cls_spellings in ucls.values():
            known |= {_norm_unit_spelling(s) for s in cls_spellings}
        for spelling, d in uf.items():
            if not isinstance(spelling, str) or not spelling.strip():
                _vthrow("list_spec.pricing.unit_factors: every key must be a non-empty unit spelling.")
            if not isinstance(d, dict):
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}'] must be an object.")
            unk = set(d) - _PRICING_UNIT_FACTOR_KEYS
            if unk:
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}']: unknown key(s): {', '.join(sorted(unk))}.")
            if d.get("class") not in ucls:
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}'].class must name a unit_classes key.")
            f = d.get("factor")
            if not isinstance(f, (int, float)) or isinstance(f, bool) or not (f > 0):
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}'].factor must be a positive number.")
            if float(f) == 1.0:
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}'].factor 1 is a synonym -- declare it in unit_classes instead.")
            if not isinstance(d.get("word"), str) or not d["word"].strip():
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}'] needs a word naming the unit.")
            if _norm_unit_spelling(spelling) in known:
                _vthrow(f"list_spec.pricing.unit_factors['{spelling}'] is already a unit_classes spelling -- a unit is declared in one place only.")
    # numbers: SKU attribute <- the model's text attributes
    numbers = pr.get("numbers")
    if not isinstance(numbers, dict) or not numbers:
        _vthrow("list_spec.pricing.numbers must be a non-empty object.")
    text_ids = {i for i, d in by_id.items() if d.get("type") == "text"}
    for nid, rd in numbers.items():
        if not isinstance(rd, dict):
            _vthrow(f"list_spec.pricing.numbers['{nid}'] must be an object.")
        unk = set(rd) - _PRICING_NUMBER_KEYS
        if unk:
            _vthrow(f"list_spec.pricing.numbers['{nid}']: unknown key(s): {', '.join(sorted(unk))}.")
        frm = rd.get("from")
        if not isinstance(frm, list) or not frm or not all(isinstance(f, str) and f in text_ids for f in frm):
            _vthrow(f"list_spec.pricing.numbers['{nid}'].from must list text item attribute definitions.")
        if not isinstance(rd.get("name"), str) or not rd.get("name"):
            _vthrow(f"list_spec.pricing.numbers['{nid}'] needs a name.")
        for bkey in ("square", "ratio"):
            if bkey in rd and not isinstance(rd[bkey], bool):
                _vthrow(f"list_spec.pricing.numbers['{nid}'].{bkey} must be true or false.")
        if "reject_tokens" in rd and (not isinstance(rd["reject_tokens"], list) or not all(isinstance(t, str) and t for t in rd["reject_tokens"])):
            _vthrow(f"list_spec.pricing.numbers['{nid}'].reject_tokens must be a list of strings.")
        if "reject_below" in rd and not _is_finite_number(rd["reject_below"]):
            _vthrow(f"list_spec.pricing.numbers['{nid}'].reject_below must be a finite number.")
        if "range" in rd and rd["range"] != "max":
            _vthrow(f"list_spec.pricing.numbers['{nid}'].range must be 'max'.")
        # SLICE 9 (A-1): an axis index, 1..3. A `component` on a reader whose `from` names several attributes is
        # refused: the phrase must come from ONE field, or which field an axis came from would be ambiguous.
        if "component" in rd:
            if rd["component"] not in (1, 2, 3) or isinstance(rd["component"], bool):
                _vthrow(f"list_spec.pricing.numbers['{nid}'].component must be 1, 2 or 3 (width, height, depth).")
            if len(frm) != 1:
                _vthrow(f"list_spec.pricing.numbers['{nid}'].component needs exactly one `from` attribute.")
    choice_attrs = pr.get("choice_attrs")
    if not isinstance(choice_attrs, list) or not all(isinstance(c, str) and by_id.get(c, {}).get("type") == "choice" for c in choice_attrs):
        _vthrow("list_spec.pricing.choice_attrs must list choice item attribute definitions.")
    sku_attrs = set(numbers) | set(choice_attrs)
    if set(numbers) & set(choice_attrs):
        _vthrow("list_spec.pricing: an attribute cannot be both a number reader and a choice.")
    for key in ("ladders", "match_attrs"):
        lst = pr.get(key)
        if not isinstance(lst, list) or not all(isinstance(a, str) and a in sku_attrs for a in lst):
            _vthrow(f"list_spec.pricing.{key} must list SKU attributes (a numbers key or a choice_attrs entry).")
    # ---- SLICE 12c: the two resolution blocks ---------------------------------------------------
    # Placed AFTER the ladders, because both name a LADDER attribute and that is the namespace they
    # read from -- the rule that every name a step reads is checked where it reads it.
    sm = pr.get("size_match")
    if sm is not None:
        if not isinstance(sm, dict):
            _vthrow("list_spec.pricing.size_match must be an object.")
        unk = set(sm) - _PRICING_SIZE_MATCH_KEYS
        if unk:
            _vthrow(f"list_spec.pricing.size_match: unknown key(s): {', '.join(sorted(unk))}.")
        dps = sm.get("dp")
        if (not isinstance(dps, list) or not dps
                or not all(isinstance(d, int) and not isinstance(d, bool) and d >= 0 for d in dps)):
            _vthrow("list_spec.pricing.size_match.dp must be a non-empty list of rounding depths "
                    "(non-negative integers).")
        if len(set(dps)) != len(dps):
            _vthrow("list_spec.pricing.size_match.dp repeats a depth; each is tried once, in order.")
    cp = pr.get("compose")
    if cp is not None:
        if not isinstance(cp, dict):
            _vthrow("list_spec.pricing.compose must be an object.")
        unk = set(cp) - _PRICING_COMPOSE_KEYS
        if unk:
            _vthrow(f"list_spec.pricing.compose: unknown key(s): {', '.join(sorted(unk))}.")
        missing = _PRICING_COMPOSE_REQUIRED - set(cp)
        if missing:
            _vthrow(f"list_spec.pricing.compose needs {', '.join(sorted(missing))}.")
        # the axis that composes must be a LADDER: composition only has meaning above a top rung
        if cp["attr"] not in (pr.get("ladders") or []):
            _vthrow(f"list_spec.pricing.compose.attr '{cp['attr']}' is not one of the ladders; only a "
                    "laddered axis has a largest rung to compose above.")
        if not isinstance(cp["tolerance"], (int, float)) or isinstance(cp["tolerance"], bool) or cp["tolerance"] < 0:
            _vthrow("list_spec.pricing.compose.tolerance must be a non-negative number.")
        if (not isinstance(cp["max_layers"], int) or isinstance(cp["max_layers"], bool)
                or cp["max_layers"] < 2):
            # ⚠️ BY NAME, because one layer is what the ordinary ladder already is: a one-layer
            # "composition" is that ladder wearing the tolerance as a disguise, and it can shave a
            # stated value DOWN -- exactly the 26 -> 25 exception the owner refused.
            _vthrow("list_spec.pricing.compose.max_layers must be an integer of at least 2. One layer "
                    "is what the ladder already does; a composition is two or more.")
        ck = cp.get("cost_key")
        if ck is not None and (not isinstance(ck, str) or not ck.strip()):
            _vthrow("list_spec.pricing.compose.cost_key must be a non-empty rate key.")
        oo = cp.get("outer_only")
        if oo is not None:
            if not isinstance(oo, dict) or set(oo) != _PRICING_OUTER_ONLY_KEYS:
                _vthrow("list_spec.pricing.compose.outer_only needs exactly attr and value.")
            if oo["attr"] not in choice_attrs:
                _vthrow(f"list_spec.pricing.compose.outer_only.attr '{oo['attr']}' is not a choice SKU "
                        "attribute of this category.")
            if oo["value"] not in (by_id[oo["attr"]].get("values") or []):
                _vthrow(f"list_spec.pricing.compose.outer_only.value '{oo['value']}' is not one of "
                        f"'{oo['attr']}'s values; the inner layers would take a value no SKU carries.")
    # SLICE 12c: which SKU attribute labels a ladder rung. A row missing it is NOT A RUNG, so this is a
    # correctness key -- it must name an attribute the SKUs actually carry, or the ladder is empty and
    # every row refuses. Checked against the ITEM definitions, not `sku_attrs`: a label is not a
    # matching axis (ADP's `item_detail` is neither a `numbers` key nor a `choice_attrs` entry).
    la = pr.get("label_attr")
    if la is not None:
        if not isinstance(la, str) or not la.strip():
            _vthrow("list_spec.pricing.label_attr must be a non-empty string.")
        if la not in by_id and la != spec.get("family_attribute_id"):
            _vthrow(f"list_spec.pricing.label_attr '{la}' is not an item attribute of this category; "
                    "a ladder would skip every row and refuse everything.")
    # SLICE 12c FINISH (owner F4): the cladding values whose cost stays TYPED and editable. Every
    # other row shows the live computed figure, greyed. Must name values the category actually has.
    tc = pr.get("typed_cladding")
    if tc is not None:
        if not isinstance(tc, list) or not tc:
            _vthrow("list_spec.pricing.typed_cladding, when present, must be a non-empty list.")
        vocab = set()
        for a in choice_attrs:
            vocab |= set(by_id[a].get("values") or [])
        for v in tc:
            if v not in vocab:
                _vthrow(f"list_spec.pricing.typed_cladding names '{v}', which is not a value of any "
                        "choice attribute of this category.")
    nd = pr.get("number_defaults")
    if nd is not None:
        if not isinstance(nd, dict):
            _vthrow("list_spec.pricing.number_defaults must be an object.")
        for nid, spec_nd in nd.items():
            loc = f"list_spec.pricing.number_defaults['{nid}']"
            # the attribute must be a NUMBER this category reads -- a default for a number nothing
            # reads is the "validates but never executes" failure
            if nid not in numbers:
                _vthrow(f"{loc}: '{nid}' is not one of this category's numbers.")
            if not isinstance(spec_nd, dict):
                _vthrow(f"{loc} must be an object.")
            unk = set(spec_nd) - _PRICING_NUMBER_DEFAULT_KEYS
            if unk:
                _vthrow(f"{loc}: unknown key(s): {', '.join(sorted(unk))}.")
            v = spec_nd.get("value")
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                _vthrow(f"{loc}.value must be a number.")
            fams = spec_nd.get("families")
            if fams is not None:
                if not isinstance(fams, list) or not fams:
                    _vthrow(f"{loc}.families, when present, must be a non-empty list.")
                for f in fams:
                    if f not in (pr.get("families") or {}):
                        _vthrow(f"{loc}.families names '{f}', which is not a family of this category.")
            if not isinstance(spec_nd.get("rule"), str) or not spec_nd.get("rule").strip():
                _vthrow(f"{loc} needs a 'rule' saying whose ruling it is.")
    rn = pr.get("reason_names")
    if rn is not None and (not isinstance(rn, dict) or set(rn) - sku_attrs or not all(isinstance(v, str) and v for v in rn.values())):
        _vthrow("list_spec.pricing.reason_names must name SKU attributes only, each with a phrase.")
    # SLICE 6b: panel_controls -- OPTIONAL as a block (absent = today's controls), but when declared it must be COMPLETE
    # over every attribute the panel can show (the SKU attributes, the family attribute, a derive_when_none source)
    # and closed to that namespace, each with a known control. A missing attribute would fall back silently to a
    # code default, which is the "declared per attribute" rule (V5) failing without a sound.
    pc = pr.get("panel_controls")
    if pc is not None:
        if not isinstance(pc, dict):
            _vthrow("list_spec.pricing.panel_controls must be an object.")
        panel_ns = set(sku_attrs)
        fam_attr = spec.get("family_attribute_id")
        if isinstance(fam_attr, str) and fam_attr:
            panel_ns.add(fam_attr)
        for rule in pr.get("derive_when_none") or []:
            when = rule.get("when") if isinstance(rule, dict) else None
            if isinstance(when, dict) and isinstance(when.get("attr"), str):
                panel_ns.add(when["attr"])
        unknown_pc = set(pc) - panel_ns
        if unknown_pc:
            _vthrow(f"list_spec.pricing.panel_controls names attribute(s) the panel cannot show: {', '.join(sorted(unknown_pc))}.")
        bad_pc = sorted(k for k, v in pc.items() if v not in _PANEL_CONTROLS)
        if bad_pc:
            _vthrow(f"list_spec.pricing.panel_controls: each control must be one of {sorted(_PANEL_CONTROLS)} (bad: {', '.join(bad_pc)}).")
        missing_pc = panel_ns - set(pc)
        if missing_pc:
            _vthrow(f"list_spec.pricing.panel_controls must declare every attribute the panel can show; missing: {', '.join(sorted(missing_pc))}.")
        # OWNER FA8 (2026-10-04): "the attributes whic cannot be dropdowns and the user is expected to
        # type in, must have brief explantion abnout whathe user is expected to eneter there." A typed
        # field with no note is a box with no question, so the note is REQUIRED wherever typing is
        # possible -- and `panel_notes` is closed to the same namespace, for the same reason the
        # controls are: a note on an attribute the panel cannot show would never be read.
        notes = pr.get("panel_notes")
        # ⚠️ EVERY TYPED FIELD CARRIES A NOTE, owner ruling 2026-10-04 -- and the validator enforces it
        # "for every category that complies", which is the owner's own wording and the only reading
        # that works. A config DECLARING `panel_notes` must cover every typed field it has; one that
        # declares none is not refused.
        #
        # ⚠️ THAT SCOPE IS MEASURED, NOT CAUTIOUS. Requiring the map outright refused EVERY HISTORICAL
        # HVAC ASSET -- ADP has declared `text` controls with no notes since v9 -- and took 30 tests
        # with it, including the sweeps that pin "every asset file on disk validates with exactly
        # today's outcome". Those assets are frozen history; refusing them buys nothing and costs the
        # sweeps their meaning. The standard is held where it belongs instead: `test_an_07` pins that
        # EVERY typed field of EVERY category in the CURRENT asset has its note, so a new typed field
        # shipped without one fails loudly, while v9 stays as valid as it was the day it was minted.
        typed = {k for k, v in pc.items() if v in _TYPED_CONTROLS}
        if isinstance(notes, dict):
            unknown_n = set(notes) - panel_ns
            if unknown_n:
                _vthrow("list_spec.pricing.panel_notes names attribute(s) the panel cannot show: %s."
                        % ", ".join(sorted(unknown_n)))
            bad_n = sorted(k for k, v in notes.items() if not isinstance(v, str) or not v.strip())
            if bad_n:
                _vthrow("list_spec.pricing.panel_notes: each note must be a non-empty string (bad: %s)."
                        % ", ".join(bad_n))
            missing_n = typed - set(notes)
            if missing_n:
                _vthrow("list_spec.pricing.panel_notes must say what to type in every typed field; "
                        "missing: %s." % ", ".join(sorted(missing_n)))
        elif notes is not None:
            _vthrow("list_spec.pricing.panel_notes must be an object.")
    # families: the family attribute's values, through the alias
    alias = pr.get("family_alias") or {}
    if not isinstance(alias, dict) or not all(isinstance(k, str) and isinstance(v, str) and k in family_vals and v in family_vals and k != v for k, v in alias.items()):
        _vthrow("list_spec.pricing.family_alias must map family values to other family values.")
    nsf = pr.get("no_sku_families") or []
    if not isinstance(nsf, list) or not all(isinstance(f, str) and f in family_vals for f in nsf):
        _vthrow("list_spec.pricing.no_sku_families must list family values.")
    fams = pr.get("families")
    if not isinstance(fams, dict) or not fams:
        _vthrow("list_spec.pricing.families must be a non-empty object.")
    for fname, f in fams.items():
        loc = f"list_spec.pricing.families['{fname}']"
        if fname not in family_vals or fname in alias or fname in nsf:
            _vthrow(f"{loc}: not a priceable family value (must be a family value that is neither an alias nor a no-SKU family).")
        if not isinstance(f, dict):
            _vthrow(f"{loc} must be an object.")
        unk = set(f) - _PRICING_FAMILY_KEYS
        if unk:
            _vthrow(f"{loc}: unknown key(s): {', '.join(sorted(unk))}.")
        needs = f.get("needs")
        if not isinstance(needs, list) or not all(isinstance(n, str) and n in sku_attrs for n in needs):
            _vthrow(f"{loc}.needs must list SKU attributes.")
        units = f.get("units")
        if not isinstance(units, dict) or not units:
            _vthrow(f"{loc}.units must be a non-empty object keyed by unit class.")
        for cls, u in units.items():
            uloc = f"{loc}.units['{cls}']"
            if cls not in ucls:
                _vthrow(f"{uloc}: '{cls}' is not a unit class.")
            if not isinstance(u, dict) or set(u) - _PRICING_UNIT_KEYS:
                _vthrow(f"{uloc} must be an object with needs / pipelines only.")
            if "needs" in u and (not isinstance(u["needs"], list) or not all(isinstance(n, str) and n in sku_attrs for n in u["needs"])):
                _vthrow(f"{uloc}.needs must list SKU attributes.")
            # SLICE 6 (owner T7): a block WITHOUT pipelines runs the config's own `pipelines` -- the shared per-item
            # default -- so the config must declare them (a non-empty `pipelines` is also what makes the list-mode
            # category eligible). A block WITH pipelines keeps its own (a conversion, a derived family).
            if "pipelines" in u:
                _validate_pricing_pipelines(u.get("pipelines"), uloc, pr, sku_attrs)
            elif not cfg.get("pipelines"):
                _vthrow(f"{uloc} declares no pipelines and the config's own pipelines are empty -- nothing would price this block.")
        conv = f.get("convert")
        if conv is not None:
            if not isinstance(conv, dict):
                _vthrow(f"{loc}.convert must be an object keyed by the ROW's unit class.")
            for cls, opts in conv.items():
                cloc = f"{loc}.convert['{cls}']"
                if cls not in ucls:
                    _vthrow(f"{cloc}: '{cls}' is not a unit class.")
                if cls in units:
                    _vthrow(f"{cloc}: the family already prices per {cls}; a conversion from it is unreachable.")
                if not isinstance(opts, list) or not opts:
                    _vthrow(f"{cloc} must be a non-empty list of options.")
                for oi, o in enumerate(opts):
                    oloc = f"{cloc}[{oi}]"
                    if not isinstance(o, dict) or set(o) - _PRICING_CONVERT_KEYS:
                        _vthrow(f"{oloc} must be an object with to / needs / rule / pipelines only.")
                    if o.get("to") not in units:
                        _vthrow(f"{oloc}.to must name a unit class the family prices.")
                    if not isinstance(o.get("needs"), list) or not o["needs"] or not all(isinstance(n, str) and n in sku_attrs for n in o["needs"]):
                        _vthrow(f"{oloc}.needs must be a non-empty list of SKU attributes.")
                    if not isinstance(o.get("rule"), str) or not o["rule"]:
                        _vthrow(f"{oloc}.rule must be a non-empty string.")
                    _validate_pricing_pipelines(o.get("pipelines"), oloc, pr, sku_attrs)
    # SLICE 6 (T7): the config-level pipelines of a list-mode config ARE per-item pipelines (the shared default), so
    # they pass the item-list shape checks as well as the generic pipeline checks
    if cfg.get("pipelines"):
        _validate_pricing_pipelines(cfg.get("pipelines"), "list_spec.pricing (the config's own pipelines)", pr, sku_attrs)
    # defaults: applied only over a "None" answer, so only an allow_none choice may carry one
    dfl = pr.get("defaults") or {}
    if not isinstance(dfl, dict):
        _vthrow("list_spec.pricing.defaults must be an object.")
    for attr, d in dfl.items():
        dloc = f"list_spec.pricing.defaults['{attr}']"
        if attr not in choice_attrs or not by_id[attr].get("allow_none"):
            _vthrow(f"{dloc}: only an allow_none choice attribute may carry a default.")
        if not isinstance(d, dict) or set(d) - _PRICING_DEFAULT_KEYS or not isinstance(d.get("rule"), str) or not d["rule"]:
            _vthrow(f"{dloc} must be an object with rule and value / by_family.")
        vals = by_id[attr]["values"]
        if ("value" in d) == ("by_family" in d):
            _vthrow(f"{dloc} must carry exactly one of value / by_family.")
        if "absent_as_none" in d and not isinstance(d["absent_as_none"], bool):
            _vthrow(f"{dloc}.absent_as_none must be true or false.")
        if "value" in d and d["value"] not in vals:
            _vthrow(f"{dloc}.value must be one of the attribute's values.")
        if "by_family" in d and (not isinstance(d["by_family"], dict) or not d["by_family"] or not all(
                k in fams and v in vals for k, v in d["by_family"].items())):
            _vthrow(f"{dloc}.by_family must map priceable families to the attribute's values.")
    dwn = pr.get("derive_when_none") or []
    if not isinstance(dwn, list):
        _vthrow("list_spec.pricing.derive_when_none must be a list.")
    for i, r in enumerate(dwn):
        rloc = f"list_spec.pricing.derive_when_none[{i}]"
        if not isinstance(r, dict) or set(r) - _PRICING_DERIVE_KEYS or set(_PRICING_DERIVE_KEYS) - set(r):
            _vthrow(f"{rloc} must carry attr / families / when / then / rule.")
        if r["attr"] not in choice_attrs or not by_id[r["attr"]].get("allow_none"):
            _vthrow(f"{rloc}.attr must be an allow_none choice attribute.")
        if r["then"] not in by_id[r["attr"]]["values"]:
            _vthrow(f"{rloc}.then must be one of the attribute's values.")
        if not isinstance(r["families"], list) or not r["families"] or not all(f in fams for f in r["families"]):
            _vthrow(f"{rloc}.families must list priceable families.")
        w = r["when"]
        if not isinstance(w, dict) or set(w) != {"attr", "equals"} or w["attr"] not in by_id or by_id[w["attr"]].get("type") != "choice" or w["equals"] not in by_id[w["attr"]]["values"]:
            _vthrow(f"{rloc}.when must be {{attr: a choice attribute, equals: one of its values}}.")
        if not isinstance(r["rule"], str) or not r["rule"]:
            _vthrow(f"{rloc}.rule must be a non-empty string.")
    # SLICE 8 (owner M-b): the overrides. Every name is checked in the namespace it reads from, exactly as
    # `derive_when_none` is: the target and the condition are both CHOICE attributes of this category, the
    # values are from their own vocabularies, and the families are priceable ones. The one deliberate
    # difference from `derive_when_none` is that the TARGET need not be allow_none -- an override replaces a
    # value the row DID state, so "the row may leave it unsaid" is not a precondition of it.
    # the presence test comes BEFORE the `or []` idiom on purpose: an EMPTY dict is falsy, so `or []` would
    # swallow `"override_when": {}` and ship a silently inert key -- the exact failure the closed allowlists exist
    # to prevent. Absent is still absent, and still fine.
    if "override_when" in pr and not isinstance(pr["override_when"], list):
        _vthrow("list_spec.pricing.override_when must be a list.")
    ovr = pr.get("override_when") or []
    for i, r in enumerate(ovr):
        rloc = f"list_spec.pricing.override_when[{i}]"
        if not isinstance(r, dict) or set(r) - _PRICING_OVERRIDE_KEYS or _PRICING_OVERRIDE_REQUIRED - set(r):
            _vthrow(f"{rloc} must carry attr / families / when / then / rule.")
        if "display" in r and (not isinstance(r["display"], str) or not r["display"].strip()):
            _vthrow(f"{rloc}.display must be a non-empty string.")
        if r["attr"] not in choice_attrs:
            _vthrow(f"{rloc}.attr must be a choice attribute.")
        if r["then"] not in by_id[r["attr"]]["values"]:
            _vthrow(f"{rloc}.then must be one of the attribute's values.")
        if not isinstance(r["families"], list) or not r["families"] or not all(f in fams for f in r["families"]):
            _vthrow(f"{rloc}.families must list priceable families.")
        w = r["when"]
        if not isinstance(w, dict) or set(w) != {"attr", "equals"} or w["attr"] not in choice_attrs or w["equals"] not in by_id[w["attr"]]["values"]:
            _vthrow(f"{rloc}.when must be {{attr: a choice attribute, equals: one of its values}}.")
        if w["attr"] == r["attr"]:
            _vthrow(f"{rloc}: an override cannot be conditioned on the attribute it sets.")
        if not isinstance(r["rule"], str) or not r["rule"]:
            _vthrow(f"{rloc}.rule must be a non-empty string.")
    # SLICE 9 (owner A-4): the SECOND KEYS. `primary` and every `key` entry are SKU attributes of this category,
    # so a typo cannot ship a rule that reads an attribute nothing carries. `alt_key` is deliberately NOT checked
    # against that namespace: it names attributes the CATALOGUE carries (the spec reader's alternative wording),
    # which no config declares -- it is checked for shape and for not colliding with the key itself.
    # Presence before the `or []` idiom, for the reason recorded above `override_when`.
    if "second_key" in pr and not isinstance(pr["second_key"], list):
        _vthrow("list_spec.pricing.second_key must be a list.")
    for i, r in enumerate(pr.get("second_key") or []):
        rloc = f"list_spec.pricing.second_key[{i}]"
        if not isinstance(r, dict) or set(r) - _PRICING_SECOND_KEY_KEYS or {"families", "primary", "key", "name", "primary_pick"} - set(r):
            _vthrow(f"{rloc} must carry families / primary / key / name / primary_pick (alt_key optional).")
        if not isinstance(r["families"], list) or not r["families"] or not all(f in fams for f in r["families"]):
            _vthrow(f"{rloc}.families must list priceable families.")
        if r["primary"] not in sku_attrs:
            _vthrow(f"{rloc}.primary must be a SKU attribute.")
        if not isinstance(r["key"], list) or not r["key"] or not all(isinstance(k, str) and k in sku_attrs for k in r["key"]):
            _vthrow(f"{rloc}.key must be a non-empty list of SKU attributes.")
        if r["primary"] in r["key"]:
            _vthrow(f"{rloc}.key cannot contain the primary key.")
        if "alt_key" in r:
            ak = r["alt_key"]
            if not isinstance(ak, list) or len(ak) != len(r["key"]) or not all(isinstance(k, str) and k.strip() for k in ak):
                _vthrow(f"{rloc}.alt_key must list one catalogue attribute per key entry.")
            if set(ak) & set(r["key"]):
                _vthrow(f"{rloc}.alt_key cannot name a key attribute.")
        if not isinstance(r["name"], str) or not r["name"]:
            _vthrow(f"{rloc}.name must be a non-empty string.")
        if r["primary_pick"] not in _PRICING_PRIMARY_PICKS:
            _vthrow(f"{rloc}.primary_pick must be one of {sorted(_PRICING_PRIMARY_PICKS)}.")


def _validate_pricing_pipelines(pipelines, loc, pr, sku_attrs):
    """The pipelines an item-list unit block / conversion option declares: existing steps only, with the shape
    checks the config-level pipelines get; every `_from_attr` names a SKU attribute; a component_ref's ref
    names the pricing kind and, beyond kind / qty, only SKU attributes or the projected unit-class key."""
    if not isinstance(pipelines, dict) or not pipelines:
        _vthrow(f"{loc}.pipelines must be a non-empty object.")
    readable = set(sku_attrs) | {pr["unit_class_attr"], "family"}
    for pid, p in pipelines.items():
        ploc = f"{loc}.pipelines['{pid}']"
        if not isinstance(p, dict):
            _vthrow(f"{ploc} must be an object.")
        if not isinstance(p.get("output"), list) or not p["output"] or not all(isinstance(o, str) and o for o in p["output"]):
            _vthrow(f"{ploc}: output must be a non-empty list of strings.")
        steps = p.get("steps")
        if not isinstance(steps, list) or not steps:
            _vthrow(f"{ploc}: steps must be a non-empty list.")
        for si, s in enumerate(steps):
            where = f"{ploc} step {si}"
            if not isinstance(s, dict):
                _vthrow(f"{where}: must be an object.")
            st = s.get("step")
            if st not in _PRICING_STEP_TYPES:
                _vthrow(f"{where}: step '{st}' is not one of the item-list pricing steps ({', '.join(sorted(_PRICING_STEP_TYPES))}).")
            if st == "match_master_row":
                params = s.get("params")
                if not isinstance(params, dict) or params.get("kind") != pr["kind"]:
                    _vthrow(f"{where}: match_master_row must match the pricing kind '{pr['kind']}'.")
            elif st == "scale":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: scale needs a string '{key}'.")
                _validate_params(s.get("params"), where)
                for pk, pv in (s.get("params") or {}).items():
                    if pk.endswith(_FROM_ATTR_SUFFIX) and pv not in sku_attrs:
                        _vthrow(f"{where}: '{pk}' names '{pv}', which is not a SKU attribute.")
            elif st == "roundup":
                if not isinstance(s.get("target"), str) or not s.get("target"):
                    _vthrow(f"{where}: roundup needs a string 'target'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("digits")):
                    _vthrow(f"{where}: roundup needs params.digits (a finite number).")
            elif st == "sum_components":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: sum_components needs a string 'result'.")
            elif st == "rate_ref":
                # SLICE 12c -- mirrors the config-level branch exactly, so a pipeline that validates on
                # one path cannot be refused on the other. `result` is the ctx key a later step reads.
                ref = s.get("ref")
                if not isinstance(ref, dict) or not isinstance(ref.get("kind"), str) or not ref.get("kind"):
                    _vthrow(f"{where}: rate_ref needs ref.kind (a string).")
                for key in ("target", "result"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: rate_ref needs a string '{key}'.")
                for bad in _RATE_REF_FORBIDDEN:
                    if bad in s:
                        _vthrow(
                            f"{where}: rate_ref must not carry '{bad}'. A pricing input is a single "
                            "number, not a component: read it with rate_ref and use it in a later step."
                        )
                # ⚠️ A ref value here may name a SKU attribute ("@thickness_mm") or be a literal. It is
                # NOT checked against `sku_attrs`, because a pricing input is resolved in the INPUT
                # kind's own namespace (`item`, `name`), which is not this category's attribute set.
                # The interpreter refuses an unresolved bind loudly at price time, naming it.
            elif st == "component":
                # SLICE 12c -- `target` OPTIONAL (the interpreter has always treated it so: a component
                # whose formula is param-only reads no price off the matched row -- which is exactly
                # Insulation's cladding). Present-but-blank stays an error, so a typo is still caught.
                for key in ("name", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component needs a string '{key}'.")
                if "target" in s and (not isinstance(s.get("target"), str) or not s.get("target")):
                    _vthrow(f"{where}: component 'target', when present, must be a non-empty string.")
                _validate_params(s.get("params"), where)
                conds = s.get("conditions")
                if conds is not None:
                    if not isinstance(conds, list) or not conds:
                        _vthrow(f"{where}: component 'conditions', when present, must be a non-empty list.")
                    for ci, c in enumerate(conds):
                        if not isinstance(c, dict) or not isinstance(c.get("when"), dict) or not c["when"]:
                            _vthrow(f"{where} condition {ci}: needs a non-empty 'when' object.")
                        # every key a condition branches on is a fact of THIS category
                        for wk in c["when"]:
                            if wk not in sku_attrs and wk != pr["unit_class_attr"] and wk != "family":
                                _vthrow(f"{where} condition {ci}: 'when' names '{wk}', which is not a "
                                        f"SKU attribute of this category.")
                        _validate_params(c.get("params"), f"{where} condition {ci}")
                        for pk, pv in (c.get("params") or {}).items():
                            if pk.endswith(_FROM_ATTR_SUFFIX) and pv not in sku_attrs:
                                _vthrow(f"{where} condition {ci}: '{pk}' names '{pv}', which is not a "
                                        f"SKU attribute.")
            elif st == "component_ref":
                for key in ("name", "target"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_ref needs a string '{key}'.")
                ref = s.get("ref")
                if not isinstance(ref, dict) or ref.get("kind") != pr["kind"]:
                    _vthrow(f"{where}: component_ref.ref must name the pricing kind '{pr['kind']}'.")
                if "qty" not in s or not _is_finite_number(s.get("qty")):
                    _vthrow(f"{where}: an item-list component_ref carries a numeric qty (the assembly shape).")
                for rk, rv in ref.items():
                    if rk == "kind":
                        continue
                    if rk not in readable:
                        _vthrow(f"{where}: component_ref.ref key '{rk}' is not a SKU attribute.")
                    if isinstance(rv, str) and rv.startswith("@") and rv[1:] not in readable:
                        _vthrow(f"{where}: component_ref.ref '{rk}' reads '{rv}', which is not a SKU attribute.")


def _validate_alias_of(cfg):
    """SLICE 3: the alias key's shape. Absent => nothing to check (byte-identical to before)."""
    if "alias_of" not in cfg:
        return
    alias = cfg.get("alias_of")
    if not isinstance(alias, dict):
        _vthrow("alias_of must be an object {discipline, category_id}.")
    unknown = set(alias.keys()) - {"discipline", "category_id"}
    if unknown:
        _vthrow(f"alias_of: unknown key(s): {', '.join(sorted(unknown))}.")
    for k in ("discipline", "category_id"):
        v = alias.get(k)
        if not isinstance(v, str) or not v.strip():
            _vthrow(f"alias_of needs a non-empty string '{k}'.")
    own_disc = (cfg.get("discipline") or "").strip()
    own_cat = (cfg.get("category_id") or "").strip()
    if alias["discipline"].strip() == own_disc and alias["category_id"].strip() == own_cat:
        _vthrow("alias_of may not point at the config itself.")
    # an alias holds nothing of its own -- the target's pipelines / definitions are THE definitions
    if cfg.get("pipelines"):
        _vthrow("an alias_of config must have EMPTY pipelines (the target's pipelines are used).")
    if cfg.get("attribute_definitions"):
        _vthrow("an alias_of config must have EMPTY attribute_definitions (the target's are used).")
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
    _validate_alias_of(cfg)  # SLICE 3: shape of the alias key; a no-op for every config without it
    _validate_list_spec(cfg)  # SLICE 4: the item-list mode's per-item schema; a no-op for every other config
    _validate_derived_rates(cfg)      # SLICE 12a: the derived-cost declaration; a no-op without the key
    _validate_rate_composition(cfg)   # SLICE 12a: the cost-parts composition; a no-op without the key
    _validate_column_order(cfg)       # SLICE 12c FINISH: the presentation order; a no-op without the key
    _validate_calculator_only(cfg)    # SLICE 12c FINISH: the calculator admission; a no-op without it

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
            # SLICE 12b(A): `pricing_input` declares a step part of the PRICING-INPUT PREAMBLE, which
            # the interpreter HOISTS to the front of the pipeline. It exists so the mint can APPEND the
            # preamble and leave every original steps[N] index in the asset untouched.
            #
            # A `rate_ref` hoists by TYPE and needs no flag. A `scale` needs the flag because it is the
            # only other preamble shape -- and it is refused anywhere else, because an ordinary step
            # reads a RUNNING VALUE and hoisting one would read it before it exists. That is a moved
            # price with nothing on screen to show it, so the flag is refused BY NAME rather than
            # quietly ignored.
            if "pricing_input" in s:
                if not isinstance(s["pricing_input"], bool):
                    _vthrow(f"{where}: 'pricing_input' must be true or false.")
                if s["pricing_input"] and st not in ("rate_ref", "scale"):
                    _vthrow(
                        f"{where}: 'pricing_input' is only read on a rate_ref or a scale, not on a "
                        f"'{st}'. The preamble is hoisted ahead of every other step, and a step that "
                        "reads a running value cannot be hoisted."
                    )
            # SLICE 12b(A): a `<ident>_from_ctx` param only does something on a step type that BINDS one.
            # The standing rule is that the validator refuses a key the interpreter cannot run on that
            # shape, by name, rather than implementing it -- a `_from_ctx` on (say) a `roundup` would
            # save cleanly and be read by nothing, which is how a wrong price hides.
            if st not in _CTX_ARM_STEPS:
                for pk in (s.get("params") or {}):
                    if isinstance(pk, str) and pk.endswith(_FROM_CTX_SUFFIX):
                        _vthrow(
                            f"{where}: '{pk}' is not read on a '{st}' step. A computed-value binding "
                            f"only works on: {', '.join(sorted(_CTX_ARM_STEPS))}."
                        )
            # SLICE 12b(A): a rate stage may take its multiplier from ctx. It is a KEY, so a string; and
            # it REPLACES `mult`, so a stage carrying both is refused -- letting both apply would
            # silently square the migration, and that is not a thing a reader would notice.
            for gi, stage in enumerate(s.get("rate_stages") or []):
                if not isinstance(stage, dict) or "mult_from_ctx" not in stage:
                    continue
                mv = stage.get("mult_from_ctx")
                if not isinstance(mv, str) or not mv.strip():
                    _vthrow(f"{where} stage {gi}: 'mult_from_ctx' must be a non-empty computed-value key.")
                if _is_finite_number(stage.get("mult")) and stage.get("mult") != 1.0:
                    _vthrow(
                        f"{where} stage {gi}: 'mult_from_ctx' REPLACES 'mult', so do not set both. "
                        f"Remove the literal mult ({stage.get('mult')}) -- leaving it is how a migrated "
                        "value silently keeps its old number."
                    )
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
            elif st == "rate_ref":
                # SLICE 12b(A). Required: ref.kind, target, result. `result` joins ctx_binds so a later
                # step's `_from_ctx` can name it.
                ref = s.get("ref")
                if not isinstance(ref, dict) or not isinstance(ref.get("kind"), str) or not ref.get("kind"):
                    _vthrow(f"{where}: rate_ref needs ref.kind (a string).")
                for key in ("target", "result"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: rate_ref needs a string '{key}'.")
                for bad in _RATE_REF_FORBIDDEN:
                    if bad in s:
                        _vthrow(
                            f"{where}: rate_ref must not carry '{bad}'. A pricing input is a single "
                            "number, not a component: read it with rate_ref and use it in a later step."
                        )
                # every non-kind ref value is a literal or an "@bound" attribute; a bound one is
                # reference-guarded exactly as component_ref's are.
                for rk, rv in ref.items():
                    if rk in ("kind", "attributes"):
                        continue
                    if isinstance(rv, str) and rv.startswith("@"):
                        _ref(rv[1:], f"{where} rate_ref")
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
                            # SLICE 12b(A): a stage takes its multiplier EITHER from a literal `mult` OR
                            # from a Pricing Input via `mult_from_ctx` -- exactly one of the two. Before
                            # the inputs existed only the literal was possible, so this check asked for
                            # it unconditionally; a migrated stage has no literal BY DESIGN, because
                            # leaving one is how a migrated value silently keeps its old number.
                            if not isinstance(stage, dict):
                                _vthrow(f"{where}: rate_stages[{ri}] must be an object.")
                            has_lit = _is_finite_number(stage.get("mult"))
                            has_ctx = isinstance(stage.get("mult_from_ctx"), str) and stage["mult_from_ctx"].strip()
                            if not has_lit and not has_ctx:
                                _vthrow(
                                    f"{where}: rate_stages[{ri}] needs a finite 'mult' or a "
                                    "'mult_from_ctx' naming a pricing input."
                                )
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
                # SLICE 12b(A): the ratio may come from a Pricing Input instead of a literal -- exactly
                # one of the two, for the same reason the rate-stage check says it: a migrated step has
                # no literal BY DESIGN, because leaving one is how the input silently does nothing.
                if not isinstance(params, dict):
                    _vthrow(f"{where}: install_as_ratio needs a params object.")
                _has_lit = _is_finite_number(params.get("ratio"))
                _has_ctx = isinstance(params.get("ratio_from_ctx"), str) and params["ratio_from_ctx"].strip()
                if not _has_lit and not _has_ctx:
                    _vthrow(
                        f"{where}: install_as_ratio needs params.ratio (a finite number) or "
                        "params.ratio_from_ctx naming a pricing input."
                    )
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


# -- SLICE 12a: DERIVED COSTS -- declared, GENERATED AT MINT, never hand-authored -----------------
# Owner ruling I-2 (2026-09-26): "those formula should be preserved even in our system so that if we
# make change to the base row the change gets reflected on all other rows. any tab which has this
# prpety must ensure it."
#
# A DERIVED cost cell is one whose value comes from ANOTHER CATALOGUE ROW. `derived_rates` records
# that, per (item_uid, rate_key), as a LIST of terms summed:  base_value * multiplier + constant.
# A LIST, not a single base, because one cell can read two rows and one ROW can read two rows in two
# different columns (Insulation rows 78-105 read `I` from one row and `K` from another).
#
# THE DECLARATION IS DESCRIPTIVE, NEVER AUTHORITATIVE. The price still comes from the pipeline, as it
# always did; `derived_rates` exists so the rate file, the Rate Master screen and the upload refusal
# can tell the truth about it. If the two ever disagree the PIPELINE wins and the mint is wrong --
# which is exactly why the mint GENERATES it (`derived_rates_from_pipelines`) instead of an author
# writing it by hand.
#
# THE BOUNDARY IS A STEP TYPE, NOT A JUDGEMENT, AND THAT IS THE WHOLE POINT. A cell is derived only
# when a pipeline OVERWRITES A STORED RATE KEY OF THE MATCHED ROW with a value that entered through a
# `component_ref` (which reads a rate key off a DIFFERENT row). Measured over every pipeline of every
# config in both live assets at c4e45891:
#   * HVAC: 64 pipelines; 62 write a stored rate key; exactly 2 of those carry a `component_ref`
#     (cross-talk / count) -> 12 declared cells. The other 60 scale the MATCHED ROW'S OWN cost by a
#     unit conversion and MUST stay editable; they carry no `component_ref`, so they cannot be
#     declared. That is the 60-pipeline trap, closed structurally rather than by care.
#   * Electrical: 28 pipelines; 14 of them DO carry a `component_ref` -- and NOT ONE writes a
#     `result` that is a stored rate key. Its component_refs build an ASSEMBLY total (`supply`,
#     `install`, `bcs_supply`), and no item stores a key by any of those names. So no rule of any
#     strictness can declare an Electrical cell, and Electrical's rates are unchanged by
#     construction, not by a gate someone could later remove.
#
# A category with NO pipelines (slice 12a's `hvac_insulation`) cannot be generated from pipelines at
# all -- there is nothing to read. Its declaration is generated at mint FROM THE SOURCE WORKBOOK'S
# OWN FORMULAS, and the invariants below (flattened, acyclic, no `from` pointing at a derived cell)
# are enforced HERE, so both generators are held to exactly the same contract.
DERIVED_RATES_KEY = "derived_rates"
RATE_COMPOSITION_KEY = "rate_composition"
COLUMN_ORDER_KEY = "column_order"
CALCULATOR_ONLY_KEY = "calculator_only"
COLUMN_ORDER_SIDES = ("attributes", "rates")
_DERIVED_TERM_KEYS = {"from", "multiplier", "constant"}
_DERIVED_FROM_KEYS = {"item_uid", "rate_key"}
# The step types whose value flows target -> result (or in place, when there is no result).
_FLOW_STEPS = ("scale", "roundup", "rounddown", "round", "apply_effective_multiplier",
               "install_as_ratio")
_CTX_PARAM_SUFFIX = "_from_ctx"


def derived_cells(cfg):
    """{(item_uid, rate_key): [term, ...]} for a config. {} when the config declares nothing -- which
    is every config that shipped before slice 12a, so every reader degrades to today's behaviour."""
    out = {}
    dr = (cfg or {}).get(DERIVED_RATES_KEY) or {}
    if not isinstance(dr, dict):
        return out
    for uid, keys in dr.items():
        if not isinstance(keys, dict):
            continue
        for rate_key, terms in keys.items():
            if isinstance(terms, list) and terms:
                out[(uid, rate_key)] = terms
    return out


def is_derived_cell(cfg, item_uid, rate_key):
    """Is this (item, rate key) DECLARED derived? PURE, and the ONE predicate every reader keys on."""
    return (item_uid, rate_key) in derived_cells(cfg)


class DerivedRateError(Exception):
    """A declaration that cannot be computed: a missing base row, a missing base value, a cycle.

    Its own class, NOT `frappe.ValidationError`, because every caller must decide deliberately how
    loud to be -- the mint aborts, a write path refuses the write. What none of them may do is
    continue with a stale number, which is the defect this whole mechanism exists to remove.
    """


def recompute_derived_values(configs, items_by_uid):
    """SLICE 12a-FIX (owner R1 / R5) -- RECALCULATE ON SAVE. PURE: no frappe, no DB, no I/O.

    `{(item_uid, rate_key): value}` -- what every DECLARED derived cell of every given config
    SHOULD hold, computed from its base row's CURRENT value:

        value = sum over terms of (base row's rate_key value * multiplier + constant)

    ⚠️ THIS IS THE HALF SLICE 12a DID NOT BUILD. 12a recorded the links, marked the cells and
    refused an edit to them; nothing recomputed them, so a base-row edit moved ONE row and the
    dependants silently kept a stale number WHILE THEIR FORMULA COLUMN NAMED THE ROW THEY NO LONGER
    followed. The live round trip of 2026-09-30 measured exactly that: 143 -> 150 on the base,
    five dependants unchanged, the file still reading "insulation 143 <- derived from ...".

    `configs` is an iterable of config dicts (a discipline's active configs); `items_by_uid` maps
    item_uid -> a dict carrying "rates". The caller supplies the state it is ABOUT TO WRITE, so the
    answer describes the post-write catalogue, never the pre-write one.

    ⚠️ COMPUTED IN CHAIN ORDER (Kahn), so a dependant whose base is itself derived reads the base's
    NEW value and not its stored one. Today `_validate_derived_rates` enforces FLATTENED
    declarations (owner I-4), so every chain is one hop and the ordering is a no-op -- it is here
    because the ordering is what makes the rule true rather than accidentally true, and because a
    future unflattened declaration must not quietly compute against a stale intermediate.

    RAISES `DerivedRateError` -- never returns a partial answer -- when a base row is absent, when
    the base row carries no value for the named rate key, or when the declarations form a cycle.
    A declaration that cannot be computed is a defect in the catalogue, not a cell to skip.
    """
    cells = {}
    for cfg in configs or []:
        cells.update(derived_cells(cfg))
    if not cells:
        return {}

    # (1) every base a declaration names must exist and carry a number.
    for (uid, rate_key), terms in sorted(cells.items()):
        for term in terms:
            src = term.get("from") or {}
            b_uid, b_key = src.get("item_uid"), src.get("rate_key")
            base = items_by_uid.get(b_uid)
            if base is None:
                raise DerivedRateError(
                    "%s/%s is derived from item %s, which is not an active item of this discipline."
                    % (uid, rate_key, b_uid)
                )
            if not _is_finite_number((base.get("rates") or {}).get(b_key)):
                raise DerivedRateError(
                    "%s/%s is derived from %s/%s, which carries no number."
                    % (uid, rate_key, b_uid, b_key)
                )

    # (2) chain order. An edge runs base cell -> dependent cell; only edges BETWEEN declared cells
    #     constrain the order, because a typed base never changes while this runs.
    deps = {c: set() for c in cells}
    for cell, terms in cells.items():
        for term in terms:
            src = term["from"]
            base_cell = (src["item_uid"], src["rate_key"])
            if base_cell in cells:
                deps[cell].add(base_cell)
    order, ready = [], sorted(c for c, d in deps.items() if not d)
    remaining = {c: set(d) for c, d in deps.items()}
    while ready:
        cell = ready.pop(0)
        order.append(cell)
        for other, d in sorted(remaining.items()):
            if cell in d:
                d.discard(cell)
                if not d and other not in order and other not in ready:
                    ready.append(other)
        remaining.pop(cell, None)
    if len(order) != len(cells):
        stuck = sorted(c for c in cells if c not in order)
        raise DerivedRateError(
            "derived_rates contains a cycle -- these cells cannot be ordered: %s"
            % ", ".join("%s/%s" % c for c in stuck[:6])
        )

    # (3) compute, newest value first. A computed cell feeds the next one through `computed`.
    computed = {}
    for cell in order:
        total = 0.0
        for term in cells[cell]:
            src = term["from"]
            base_cell = (src["item_uid"], src["rate_key"])
            if base_cell in computed:
                base_value = computed[base_cell]
            else:
                base_value = (items_by_uid[src["item_uid"]].get("rates") or {})[src["rate_key"]]
            total += float(base_value) * float(term.get("multiplier", 1.0)) \
                + float(term.get("constant", 0.0))
        computed[cell] = total
    return computed


def derived_rate_updates(configs, items_by_uid, tolerance=1e-9):
    """`{item_uid: {rate_key: value}}` -- ONLY the STORED derived cells whose value is out of step.

    The write paths' entry point: it answers "what must I write?", so a path that changed nothing a
    declaration reads writes nothing at all (acceptance item 13). The tolerance is the float-noise
    guard `_same_rate` already uses on the upload comparison, for the same reason -- a 6-decimal
    mint figure re-derived in binary is not an edit.

    ⚠️⚠️ AN ABSENT CELL IS ABSENT BY DESIGN AND IS NEVER WRITTEN. `derived_rates` serves TWO
    populations and they need opposite treatment:

      * Insulation's 228 cells STORE a figure (the mint copied it) and nothing recomputed it -- those
        are what this mechanism exists to bring back in step.
      * ADP's 12 cross-talk cells store NOTHING AT ALL. Their pipeline fetches the base row's rate at
        price time through a `component_ref`, so they are already live, and the declaration merely
        DESCRIBES that. Writing a value into one would turn a live link into a frozen copy -- the
        exact defect being removed -- and it would change ADP.

    ⚠️ THIS IS NOT A THEORETICAL GUARD. Without it, the first Phase-0 upload wrote
    `cost_supply 1600` and `cost_install 500` onto all six ADP cross-talk rows, which v14 stores with
    markups only: 6 unintended ADP writes from an Insulation upload, reported as
    `derived_recomputed=11` where five were expected. The rows were repaired from their superseded
    predecessors and re-verified byte-equal to v14.

    ⚠️ THE DISCRIMINATOR IS "IS IT STORED", NEVER A CATEGORY NAME (the HV-10 rule). A future category
    whose pipeline computes a declared cell is protected by the same line, with no edit here.
    """
    out = {}
    for (uid, rate_key), value in recompute_derived_values(configs, items_by_uid).items():
        stored = (items_by_uid.get(uid, {}).get("rates") or {}).get(rate_key)
        if not _is_finite_number(stored):
            continue                      # absent by design -- the pipeline supplies it; never write
        if abs(float(stored) - value) <= tolerance * max(1.0, abs(float(stored)), abs(value)):
            continue                      # already in step
        out.setdefault(uid, {})[rate_key] = value
    return out


def _validate_derived_rates(cfg):
    """The shape of `derived_rates`, plus the two invariants that make a declaration trustworthy: it
    is FLATTENED (no `from` points at a cell that is itself declared derived -- owner I-4, "flatten to
    the base") and therefore ACYCLIC. ABSENT => nothing to check, byte-identical to before."""
    if DERIVED_RATES_KEY not in cfg:
        return
    dr = cfg.get(DERIVED_RATES_KEY)
    if not isinstance(dr, dict):
        _vthrow("derived_rates must be an object of item_uid -> rate_key -> [terms].")
    declared = set()
    for uid, keys in dr.items():
        if not isinstance(uid, str) or not uid.strip():
            _vthrow("derived_rates: every key must be a non-empty item_uid.")
        if not isinstance(keys, dict) or not keys:
            _vthrow("derived_rates['%s'] must be a non-empty object of rate_key -> [terms]." % uid)
        for rate_key, terms in keys.items():
            if not isinstance(rate_key, str) or not rate_key.strip():
                _vthrow("derived_rates['%s']: every rate key must be a non-empty string." % uid)
            if not isinstance(terms, list) or not terms:
                _vthrow("derived_rates['%s']['%s'] must be a non-empty list of terms."
                        % (uid, rate_key))
            declared.add((uid, rate_key))
            for ti, term in enumerate(terms):
                where = "derived_rates['%s']['%s'][%d]" % (uid, rate_key, ti)
                if not isinstance(term, dict):
                    _vthrow("%s must be an object." % where)
                unknown = set(term.keys()) - _DERIVED_TERM_KEYS
                if unknown:
                    _vthrow("%s: unknown key(s) %s. Known: %s."
                            % (where, ", ".join(sorted(unknown)),
                               ", ".join(sorted(_DERIVED_TERM_KEYS))))
                src = term.get("from")
                if not isinstance(src, dict):
                    _vthrow("%s needs a `from` object naming the base row." % where)
                unknown_from = set(src.keys()) - _DERIVED_FROM_KEYS
                if unknown_from:
                    _vthrow("%s.from: unknown key(s) %s."
                            % (where, ", ".join(sorted(unknown_from))))
                for k in sorted(_DERIVED_FROM_KEYS):
                    v = src.get(k)
                    if not isinstance(v, str) or not v.strip():
                        _vthrow("%s.from needs a non-empty %s." % (where, k))
                if (src["item_uid"], src["rate_key"]) == (uid, rate_key):
                    _vthrow("%s points at itself -- a cell cannot be derived from itself." % where)
                if not _is_finite_number(term.get("multiplier", 1.0)):
                    _vthrow("%s.multiplier must be a finite number." % where)
                if not _is_finite_number(term.get("constant", 0.0)):
                    _vthrow("%s.constant must be a finite number." % where)
    # FLATTENED, therefore ACYCLIC: no base may itself be a declared derived cell (owner I-4).
    for uid, keys in dr.items():
        for rate_key, terms in keys.items():
            for term in terms:
                src = term["from"]
                if (src["item_uid"], src["rate_key"]) in declared:
                    _vthrow(
                        "derived_rates['%s']['%s'] is derived from %s/%s, which is ITSELF declared "
                        "derived. A declaration must be FLATTENED to the ultimate base (owner I-4)."
                        % (uid, rate_key, src["item_uid"], src["rate_key"])
                    )



def _validate_column_order(cfg):
    """`column_order` -- the category's own PRESENTATION order for the rate file and the screen.

    ⚠️ WHY A SECOND ORDER KEY EXISTS (owner F5, 2026-10-03: "the structure may vary for every
    category ... we have planned to change the structure also for the electrical categories"). The
    order already came from each category's OWN definition -- but the only lever was
    `rate_composition`, which is a PRICING declaration: `csv_exporter._composition_role`, the formula
    renderer and, for a category with no pipelines, the GENERATED `derived_rates` all read it. So
    reordering a file through it reworded the formula row and could move a derivation. This key does
    only the one thing, and nothing else reads it.

    SHAPE: {"attributes": [ids...], "rates": [rate keys...]} -- either side may be omitted, and a
    PARTIAL list is the point: the names it gives LEAD, in the order given, and everything else keeps
    the order it had (a declared `rate_composition` sheet order, else the sorted default). ABSENT is
    byte-identical to before this key existed.

    An ATTRIBUTE id is reference-guarded against the category's own definitions -- a typo there would
    silently order nothing, which is the "validates but never executes" failure. A RATE key cannot be:
    rate keys are not declared anywhere in a config, they are OBSERVED on the items, so a name no item
    carries simply orders nothing (which is the same tolerance `rate_composition.parts` already has,
    and `test_co_01` pins).
    """
    if COLUMN_ORDER_KEY not in cfg:
        return
    spec = cfg.get(COLUMN_ORDER_KEY)
    # ⚠️ PRESENCE, NOT TRUTHINESS: `"column_order": {}` must be REFUSED, not read as absent -- the
    # `or []` lesson from `override_when`. An empty declaration is a mistake, not a no-op.
    if not isinstance(spec, dict) or not spec:
        _vthrow("column_order must be a non-empty object of 'attributes' / 'rates' -> list of names.")
    unknown = sorted(set(spec) - set(COLUMN_ORDER_SIDES))
    if unknown:
        _vthrow("column_order: unknown key(s) %s. Known: %s."
                % (", ".join(unknown), ", ".join(COLUMN_ORDER_SIDES)))
    declared_attrs = {d.get("id") for d in (cfg.get("attribute_definitions") or [])
                      if isinstance(d, dict)}
    for side in COLUMN_ORDER_SIDES:
        if side not in spec:
            continue
        names = spec[side]
        if not isinstance(names, list) or not names:
            _vthrow("column_order['%s'] must be a non-empty list of names." % side)
        seen = set()
        for n in names:
            if not isinstance(n, str) or not n.strip():
                _vthrow("column_order['%s'] must hold non-empty strings." % side)
            if n in seen:
                _vthrow("column_order['%s']: '%s' is listed twice." % (side, n))
            seen.add(n)
            if side == "attributes" and n not in declared_attrs:
                _vthrow("column_order['attributes']: '%s' is not an attribute of this category." % n)



def _validate_calculator_only(cfg):
    """`calculator_only` -- the category is priceable in the CALCULATOR but not on a BoQ row.

    OWNER RULING ON FA7 (2026-10-04, option A): a category whose pricing rules are complete may be
    exercised in the Pricing Calculator tab before it is wired into BoQ rows, so the rules can be
    checked against real picks without turning on extraction for that category.

    ⚠️ IT IS A TEMPORARY ADMISSION WITH A MECHANICAL REMOVAL CONDITION, and that is the whole reason
    it is validated here rather than just read. The owner's words: the slice that makes the category
    fully eligible REMOVES this key in the same slice, "so there is never a second on/off switch".
    Eligibility itself is `pipelines` + `attribute_definitions` (`extraction.config_is_eligible`), so
    a config carrying BOTH that and this key would have two independent switches for the same
    question -- one of which nothing would ever think to turn off. **That combination is REFUSED by
    name**, which is what keeps the promise after everyone has forgotten it was made.

    It also refuses the key on a config with NOTHING TO PRICE: admitting a category whose rules are
    absent would put it in the calculator's reach only to refuse every pick, which is worse than the
    coming-soon card it replaces. For an item-list category the rules live in `list_spec.pricing`
    (that nesting is exactly what keeps such a category out of the eligibility predicate).
    """
    if CALCULATOR_ONLY_KEY not in cfg:
        return
    val = cfg.get(CALCULATOR_ONLY_KEY)
    if val is not True:
        # Not a tri-state: an explicit `false` is a key doing nothing, which is the shape this slice
        # has refused twice (`column_order: {}`, `override_when: {}`). Omit it instead.
        _vthrow("calculator_only must be exactly true, or be omitted entirely.")
    if (cfg.get("pipelines") or {}) and (cfg.get("attribute_definitions") or []):
        _vthrow("calculator_only must not be declared on a config that is already eligible "
                "(it has pipelines and attribute definitions) -- there must never be two switches "
                "for the same question. Remove calculator_only in the slice that makes it eligible.")
    has_rules = bool((((cfg.get("list_spec") or {}).get("pricing") or {}).get("families"))
                     or (cfg.get("pipelines") or {}))
    if not has_rules:
        _vthrow("calculator_only needs pricing rules to run: this config declares neither "
                "list_spec.pricing.families nor pipelines, so the calculator would refuse every pick.")


def _validate_rate_composition(cfg):
    """`rate_composition` -- how a category's STORED cost PARTS make up its supply / install cost, so
    the row-level formula columns can show each step's own result (owner I-6). Declared in CONFIG,
    never in code, exactly like `helper_message` / `pending_label` (the HV-10 rule: no category named
    in code). ABSENT => the row-level columns read `typed`, which is every category that shipped
    before slice 12a."""
    if RATE_COMPOSITION_KEY not in cfg:
        return
    comp = cfg.get(RATE_COMPOSITION_KEY)
    if not isinstance(comp, dict) or not comp:
        _vthrow("rate_composition must be a non-empty object of 'supply' / 'install' -> composition.")
    unknown = set(comp.keys()) - {"supply", "install"}
    if unknown:
        _vthrow("rate_composition: unknown side(s) %s. Known: install, supply."
                % ", ".join(sorted(unknown)))
    for side, spec in comp.items():
        if not isinstance(spec, dict):
            _vthrow("rate_composition['%s'] must be an object." % side)
        unknown_k = set(spec.keys()) - {"parts", "wastage_key", "markup_key", "roundup"}
        if unknown_k:
            _vthrow("rate_composition['%s']: unknown key(s) %s."
                    % (side, ", ".join(sorted(unknown_k))))
        parts = spec.get("parts")
        if (not isinstance(parts, list) or not parts
                or not all(isinstance(p, str) and p.strip() for p in parts)):
            _vthrow("rate_composition['%s'].parts must be a non-empty list of rate keys." % side)
        for k in ("wastage_key", "markup_key"):
            if k in spec and (not isinstance(spec[k], str) or not spec[k].strip()):
                _vthrow("rate_composition['%s'].%s must be a non-empty rate key." % (side, k))
        if "roundup" in spec and not isinstance(spec["roundup"], int):
            _vthrow("rate_composition['%s'].roundup must be an integer number of digits." % side)


def _unit_class_of(unit, unit_classes):
    """The unit CLASS a stored `unit` spelling belongs to, or None. Mirrors the interpreter's
    READ-TIME projection (`attributes.unit_class`) -- nothing is stored, the class is resolved."""
    want = (unit or "").strip().lower()
    for cls, spellings in (unit_classes or {}).items():
        for s in spellings or ():
            if want == str(s).strip().lower():
                return cls
    return None


def _pipeline_scopes(cfg):
    """(label, family, unit_class, steps, is_convert) for EVERY pipeline a config carries -- the
    top-level map (Electrical's shape) and the item-list families' per-unit-class and `convert`
    blocks (ADP's shape). A `convert` block RE-POINTS the match onto its `to` class, so the rows it
    prices are that class's rows, which that class's own `units` block already governs."""
    for name, p in (cfg.get("pipelines") or {}).items():
        if isinstance(p, dict):
            yield ("pipelines." + name, None, None, p.get("steps") or [], False)
    pricing = ((cfg.get("list_spec") or {}).get("pricing") or {})
    for fam, fv in (pricing.get("families") or {}).items():
        if not isinstance(fv, dict):
            continue
        for uc, ub in (fv.get("units") or {}).items():
            if not isinstance(ub, dict):
                continue
            for pname, p in (ub.get("pipelines") or {}).items():
                if isinstance(p, dict):
                    yield ("%s/%s/%s" % (fam, uc, pname), fam, uc, p.get("steps") or [], False)
        for from_uc, opts in (fv.get("convert") or {}).items():
            for opt in (opts if isinstance(opts, list) else [opts]):
                if not isinstance(opt, dict):
                    continue
                for pname, p in (opt.get("pipelines") or {}).items():
                    if isinstance(p, dict):
                        yield ("%s/%s->%s/%s" % (fam, from_uc, opt.get("to"), pname),
                               fam, opt.get("to"), p.get("steps") or [], True)


def _tainted_stored_results(steps, stored_keys):
    """{stored rate key: the `component_ref` step that brought another row's value in}.

    THE TAINT: a `component_ref` reads a rate key OFF A DIFFERENT ROW. Its contribution flows through
    `sum_components` into that step's `result`, and onward through the value-carrying steps from
    `target` (or from a `<name>_from_ctx` param) to `result`. A tainted name that is ALSO a rate key
    the matched item STORES is a DERIVED cell -- the pipeline overwrites the row's own stored cost
    with another row's. A `component` step reads the MATCHED row's own key and never taints; a step
    that writes an untainted value over a tainted name CLEARS the taint."""
    tainted = {}          # ctx name -> the component_ref that tainted it
    pending = None        # the component_ref awaiting its sum_components
    out = {}
    for s in steps:
        if not isinstance(s, dict):
            continue
        st = s.get("step")
        if st == "component_ref":
            pending = s
        elif st == "sum_components":
            res = s.get("result")
            if res:
                if pending is not None:
                    tainted[res] = pending
                else:
                    tainted.pop(res, None)
            pending = None
        elif st in _FLOW_STEPS:
            tgt = s.get("target")
            res = s.get("result") or tgt
            src = tainted.get(tgt)
            if src is None:
                for pk, pv in (s.get("params") or {}).items():
                    if pk.endswith(_CTX_PARAM_SUFFIX) and isinstance(pv, str):
                        src = tainted.get(pv)
                        if src is not None:
                            break
            if res:
                if src is not None:
                    tainted[res] = src
                elif res != tgt:
                    tainted.pop(res, None)
        res = s.get("result")
        if res and res in stored_keys and res in tainted:
            out[res] = tainted[res]
    return out


def derived_rates_from_pipelines(cfg, items):
    """THE MINT'S GENERATOR (owner I-2; recon B2.3). PURE.

    Returns `derived_rates` for a config, PROJECTED from the config's own `component_ref` steps onto
    the (item_uid, rate_key) pairs they govern. `items` are the discipline's active master items as
    dicts carrying `item_uid`, `kind`, `unit`, `attributes`, `rates`.

    An author never says which cells are derived: only a `component_ref` that overwrites a STORED
    rate key can produce a declaration, so the row's-own-cost pipelines (60 of ADP's) and the rows the
    pricer never matches cannot be mis-marked. `_validate_derived_rates` enforces flatness whichever
    generator produced the map.

    Raises ValueError when a `component_ref` does not resolve to exactly ONE base row -- the same
    condition the interpreter requires at price time, so a mint cannot declare what pricing cannot do.
    """
    pricing = ((cfg.get("list_spec") or {}).get("pricing") or {})
    unit_classes = pricing.get("unit_classes") or {}
    family_attr = (cfg.get("list_spec") or {}).get("family_attribute_id") or "family"
    kinds = set(cfg.get("item_kinds") or [])
    stored = set()
    for it in items:
        stored.update((it.get("rates") or {}).keys())

    def matches(it, kind, fam, uc, extra):
        if kind and it.get("kind") != kind:
            return False
        if kinds and it.get("kind") not in kinds:
            return False
        attrs = it.get("attributes") or {}
        if fam is not None and attrs.get(family_attr) != fam:
            return False
        if uc is not None and _unit_class_of(it.get("unit"), unit_classes) != uc:
            return False
        for k, v in (extra or {}).items():
            if k in ("kind", "unit_class", family_attr, "family"):
                continue
            if attrs.get(k) != v:
                return False
        return True

    out = {}
    for label, fam, uc, steps, is_convert in _pipeline_scopes(cfg):
        if is_convert:
            continue           # the match is re-pointed onto the `to` class, governed by its own block
        hits = _tainted_stored_results(steps, stored)
        if not hits:
            continue
        priced = [it for it in items if matches(it, None, fam, uc, None)]
        for rate_key, cref in sorted(hits.items()):
            ref = cref.get("ref") or {}
            base_key = cref.get("target") or rate_key
            bases = [it for it in items
                     if matches(it, ref.get("kind"), ref.get(family_attr, ref.get("family")),
                                ref.get("unit_class"), ref)]
            if len(bases) != 1:
                raise ValueError(
                    "%s: the component_ref %r resolves to %d rows, not exactly one -- a derivation "
                    "must name ONE base row." % (label, ref, len(bases))
                )
            base = bases[0]
            for it in priced:
                if it["item_uid"] == base["item_uid"] and rate_key == base_key:
                    continue
                out.setdefault(it["item_uid"], {})[rate_key] = [{
                    "from": {"item_uid": base["item_uid"], "rate_key": base_key},
                    "multiplier": 1.0,
                    "constant": 0.0,
                }]
    return out

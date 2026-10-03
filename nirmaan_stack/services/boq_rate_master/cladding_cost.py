"""SLICE 12c FINISH (owner F4) -- the LIVE cladding cost of a catalogue row.

Owner: the cladding cost column shows "the live calculated figure, greyed and not editable", in the
grid AND the download; typing a value into it is refused and points at Pricing Inputs; an Aluminium
Foil row keeps its typed value and stays editable.

⚠️ WHY THIS IS READ FROM THE CONFIG AND NOT WRITTEN OUT AS ARITHMETIC. The figure is produced at
price time by a `component` step whose branches are keyed on the row's own cladding. Re-deriving
"(aluminium x overlap + glass cloth) x girth" here in Python would be a SECOND implementation of a
rule that lives in config -- the exact drift the rate-master rules keep warning about -- and it would
not follow a config change. So this reads the SAME component the pipeline runs: its branch for this
row's cladding, its parameter bindings, its formula.

⚠️ AND IT IS PINNED AGAINST THE PIPELINE. `test_rate_master` prices every insulation row through the
product's own interpreter and asserts this function returns the same cladding figure, so the two
cannot drift silently -- the `FORMULA_FIXTURE` idiom, applied to a number instead of a sentence.

NOTHING IS STORED. This is a READ-TIME projection, like the brand projection: no write, no migration,
no backfill, so every row past and future behaves identically and a historical row self-heals.

PURE: no `frappe`, no request context. The caller passes the config and the items.
"""

_PI_SUFFIX = "_pricing_input"
_CTX = "_from_ctx"
_ATTR = "_from_attr"

# the one geometry rule the cladding formulas reference by name, and the only binding this module
# supplies that does not come from the config's own params
_GIRTH = "girth"


def _pricing_input_rates(items):
    """{input id: {rate key: value}} for every pricing-input row in the catalogue."""
    out = {}
    for it in items or []:
        if not str(it.get("kind") or "").endswith(_PI_SUFFIX):
            continue
        iid = (it.get("attributes") or {}).get("item")
        if isinstance(iid, str):
            out[iid] = dict(it.get("rates") or {})
    return out


def _ctx_from_rate_refs(steps, pi_rates):
    """The ctx a pipeline's `rate_ref` steps load, resolved from the pricing inputs.

    A `rate_ref` that reads anything other than a pricing input is skipped: this module only needs
    the input-derived values, and a catalogue-row read resolves per row at price time.
    """
    ctx = {}
    for st in steps or []:
        if not isinstance(st, dict) or st.get("step") != "rate_ref":
            continue
        ref = st.get("ref") or {}
        if not str(ref.get("kind") or "").endswith(_PI_SUFFIX):
            continue
        rates = pi_rates.get(ref.get("item")) or {}
        v = rates.get(st.get("target"))
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            ctx[st.get("result")] = float(v)
    return ctx


def _geometry_ctx(steps, attrs, ctx):
    """Add the ctx values a pipeline's GEOMETRY scales produce -- a `scale` whose parameters are all
    `_from_attr`, i.e. one computed purely from the row's own stated facts.

    ⚠️ READ FROM THE CONFIG, NOT RESTATED. The girth rule (3.14 x (pipe + 2 x thickness) / 1000) is
    declared once, in the pipeline; writing it again here is how the file and the price drift apart.
    A scale this module cannot evaluate simply contributes nothing, and the caller then returns None
    rather than a wrong number.
    """
    for st in steps or []:
        if not isinstance(st, dict) or st.get("step") != "scale":
            continue
        params = st.get("params") or {}
        if not params or not all(k.endswith(_ATTR) for k in params):
            continue
        env = {}
        ok = True
        for k, v in params.items():
            try:
                env[k[: -len(_ATTR)]] = float(attrs.get(v))
            except (TypeError, ValueError):
                ok = False
                break
        if not ok:
            continue
        # `scale` also binds its target as `base`; a geometry scale does not use it, and a formula
        # that does will simply fail to evaluate and contribute nothing.
        val = _eval(st.get("formula") or "", env)
        if val is not None:
            ctx[st.get("result")] = val
    return ctx


def _eval(formula, env):
    """Evaluate one config formula over a fixed variable set.

    The formulas are the config's own (`(al*ov + gc)*girth`, `al + gc`, `base + gi*gif + gia`), so the
    input is ours and not a user's; the builtins are stripped and only the bound names are visible.
    A name the env does not carry raises, which is an honest no-value rather than a silent zero.
    """
    try:
        return float(eval(formula, {"__builtins__": {}}, dict(env)))  # noqa: S307 - our own config
    except Exception:
        return None


def _cladding_step(pr, family, unit_class):
    """The `component` named `cladding` of a family's supply pipeline, or None."""
    fam = ((pr.get("families") or {}).get(family) or {})
    unit = ((fam.get("units") or {}).get(unit_class) or {})
    steps = (((unit.get("pipelines") or {}).get("supply") or {}).get("steps")) or []
    for st in steps:
        if isinstance(st, dict) and st.get("step") == "component" and st.get("name") == "cladding":
            return st, steps
    return None, steps


def computed_cladding_cost(cfg, item, items, unit_class_of):
    """The live cladding cost of ONE catalogue row, or None when the rules do not compute one.

    None means "this row's cladding cost is its own stored number" -- which is the Aluminium Foil
    case the owner ruled stays typed and editable.
    """
    pr = ((cfg or {}).get("list_spec") or {}).get("pricing") or {}
    if not pr:
        return None
    attrs = item.get("attributes") or {}
    family = attrs.get(pr.get("family_attribute_id") or "item")
    uc = unit_class_of(item)
    step, steps = _cladding_step(pr, family, uc)
    if step is None:
        return None

    cond = None
    for c in step.get("conditions") or []:
        when = c.get("when") or {}
        if all(attrs.get(k) == v for k, v in when.items()):
            cond = c
            break
    if cond is None:
        return None

    # ⚠️ WHICH CLADDINGS ARE TYPED IS DECLARED IN CONFIG, NOT INFERRED. The owner ruled that an
    # Aluminium Foil row "keeps its typed value, editable" -- and structurally a foil row and a
    # cladding-of "No" row are the SAME shape (both reduce to the row's own stored base), so no
    # inference can separate them. The config names the typed ones; code names no cladding and no
    # category. ABSENT => every branch that computes is computed.
    if attrs.get("cladding") in set(pr.get("typed_cladding") or []):
        return None

    params = cond.get("params") or {}
    ctx = _ctx_from_rate_refs(steps, _pricing_input_rates(items))
    _geometry_ctx(steps, attrs, ctx)
    env = {}
    for k, v in params.items():
        if k.endswith(_CTX):
            name = k[: -len(_CTX)]
            if v not in ctx:
                return None
            env[name] = ctx[v]
        elif k.endswith(_ATTR):
            name = k[: -len(_ATTR)]
            try:
                env[name] = float(attrs.get(v))
            except (TypeError, ValueError):
                return None
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            env[k] = float(v)

    formula = step.get("formula") or ""
    if "base" in formula:
        base = (item.get("rates") or {}).get(step.get("target"))
        if not isinstance(base, (int, float)) or isinstance(base, bool):
            return None
        env["base"] = float(base)
    return _eval(formula, env)


def computed_cladding_by_uid(cfg, items, unit_class_of, kind):
    """{item_uid: figure} for every row of `kind` whose cladding cost the rules compute."""
    out = {}
    for it in items or []:
        if it.get("kind") != kind:
            continue
        v = computed_cladding_cost(cfg, it, items, unit_class_of)
        if v is not None:
            out[it["item_uid"]] = v
    return out

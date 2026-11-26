"""VAV-2b2 (R16) -- WHICH ROWS FILED UNDER MISC OR SENSORS THE VAV HELPER CLAIMS. PURE (no frappe, no database).

Owner 2026-11-21 12:33 (verbatim): "for VAV we borrow items from sensor and misc, so VAV helper should run over those categories also.
any other category if we need we will build as exceptions. Lets hold on the wider change for later if really required."; 12:34 "agree on
all 3" -- (1) only on sheets that have VAV rows; (2) only rows that name a VAV item (a controller for the VAVs, DDC panel, DP sensor,
integrator, VAV installation, conical or transformation piece) - every other Misc / Sensors row untouched; (3) the row stays where it is
filed and carries a note. An EXCEPTION, for VAV Box only, to instruments block 83 ("the user's category decides"). No toggle.

The recognition is the PRODUCT's own VAV word tests, read from the VAV config's own tables (never copied): `sheet_shares.separate` (the
DDC panel / BACnet controller / controller-for-the-VAVs / DP sensor rows), `own_row_check` (the integrator row, the conical and
transformation pieces) and `existing_boxes` (dismantling / refixing). This module is the Python twin of pricingSheetHelper.ts
`vavSeparateRow` / `vavNearHit` as `vavSheetOf` composes them; vav2b2Claims parity tests pin the two equal on the real rows of the 84 VAV
sheets. Only a config carrying `list_spec.pricing.claims_filed` claims anything (ABSENT => no row is claimed: every Misc / Sensors row
exactly as before).

A LINE is the own-row view the BoQ page builds (rateSuggestionModel.ts `sheetLinesOf`): {"text": description + " | " + the row's own
notes, "unit": str, "headings": [ancestor descriptions, root first]}.
"""
import re

_CACHE = {}


def _re(p):
    """A config pattern compiled case-insensitively (the client's `new RegExp(p, "i")`); a pattern that does not compile reads as absent."""
    if not p:
        return None
    if p not in _CACHE:
        try:
            _CACHE[p] = re.compile(p, re.I)
        except re.error:
            _CACHE[p] = None
    return _CACHE[p]


def _search(p, text):
    r = _re(p)
    return r.search(text) if r is not None else None


def near_hit(text, words, near=None, near_chars=120, not_near=None, not_near_chars=80):
    """vavNearHit: the first match of `words` whose surrounding text (never the match itself) has a `near` word within `near_chars` and
    no `not_near` word within `not_near_chars`. Returns the match start, or None."""
    g = _re(words)
    if g is None:
        return None
    nr, nn = _re(near), _re(not_near)
    for m in g.finditer(text):
        if m.group(0) == "":
            continue
        at, ln = m.start(), len(m.group(0))

        def win(c):
            return text[max(0, at - c):at] + " " + text[at + ln:at + ln + c]

        if nr is not None and not nr.search(win(near_chars if near_chars is not None else 120)):
            continue
        if nn is not None and nn.search(win(not_near_chars if not_near_chars is not None else 80)):
            continue
        return at
    return None


def _first(e, text):
    if e.get("near_words"):
        return near_hit(text, e["words"], e.get("near_words"), e.get("near_chars", 120), e.get("not_near_words"), e.get("not_near_chars", 80))
    m = _search(e.get("words"), text)
    return m.start() if m else None


def _unit_key(u):
    return str(u or "").strip().lower()


def separate_row(oc, e, line):
    """vavSeparateRow: is this line a SEPARATE row of the extra `e`, by the agreed test."""
    t = line.get("text") or ""
    heads = " | ".join(line.get("headings") or ([line["heading"]] if line.get("heading") else []))
    at = _first(e, t)
    if at is None:
        return False
    if _search(oc.get("box_words"), t):
        sv = oc.get("serves")
        if not sv or not sv.get("item_first"):
            return False
        if sv.get("extras") and e.get("label") not in sv["extras"] and e.get("label") not in (sv.get("also") or []):
            return False
        desc = t.split(" | ")[0]
        md = _first(e, desc)
        bd = _search(oc.get("box_words"), desc)
        if md is None or (bd is not None and bd.start() <= md):
            return False
    if _search(oc.get("existing_words"), t):
        return False
    u = _unit_key(line.get("unit"))
    if u in [_unit_key(x) for x in oc.get("metre_units") or []]:
        return False
    if u != "" and u not in [_unit_key(x) for x in oc.get("count_units") or []]:
        return False
    c = _search(oc.get("cable_words"), t)
    if c and c.start() < at:
        return False
    art = _re(oc.get("artefact_words"))
    if art is not None and (art.search(t) or art.search(heads)):
        return False
    if e.get("needs_vav"):
        vav = _re(oc.get("vav_words"))
        if not (vav is not None and (vav.search(t) or vav.search(heads))):
            return False
    if e.get("not_words") and _search(e["not_words"], t):
        return False
    return True


def _integrator_extra(oc):
    for x in oc.get("extras") or []:
        if x.get("presence_only") and (x.get("target") or {}).get("attr"):
            return x
    return None


def _oc_integrator(oc):
    sv = dict(oc.get("serves") or {"item_first": True})
    sv["item_first"] = True
    sv["extras"] = list(sv.get("extras") or []) + list((oc.get("serves") or {}).get("also") or [])
    return dict(oc, serves=sv)


def share_row(pricing, share_id, line):
    """vavSheetOf's separate-row test for ONE share kind ("ddc" / "bacnet" / "dp"): any of its `sheet_shares.separate` extras hits and the
    row is not an integrator / router row only (QR-D2, owner 19:46 / 19:50 / 20:20)."""
    sh, oc = pricing.get("sheet_shares") or {}, pricing.get("own_row_check")
    if not oc:
        return False
    sep = sh.get("separate") or {}
    exs = [e for e in sep.get("extras") or [] if e.get("share") == share_id]
    if not exs:
        return False
    oc2 = dict(oc, artefact_words=(sep.get("artefact_words") or {}).get(share_id) or oc.get("artefact_words"),
               serves={"item_first": True, "extras": [e["label"] for e in exs if e.get("item_first")]})
    integ, oc_i = _integrator_extra(oc), _oc_integrator(oc)
    desc = (line.get("text") or "").split(" | ")[0]
    for e in exs:
        ex = {k: e.get(k) for k in ("label", "words", "needs_vav", "not_words", "near_words", "near_chars", "not_near_words", "not_near_chars")}
        ex = {k: v for k, v in ex.items() if v is not None}
        integrator_only = False
        if e.get("not_integrator_rows") and integ is not None and separate_row(oc_i, integ, line):
            ctl = _search(e.get("controls_vav_words"), desc) if e.get("controls_vav_words") else None
            integrator_only = not ctl
        if separate_row(oc2, ex, line) and not integrator_only:
            return True
    return False


def _existing_kind(pricing, line):
    eb, oc = pricing.get("existing_boxes") or {}, pricing.get("own_row_check") or {}
    t = line.get("text") or ""
    desc = t.split(" | ")[0]
    u = _unit_key(line.get("unit"))
    if u != "" and u not in [_unit_key(x) for x in oc.get("count_units") or []]:
        return None
    if not _search(eb.get("vav_words"), desc):
        return None
    for k in eb.get("kinds") or []:
        if _search(k.get("words"), t):
            return k.get("id")
    return None


def claim_of(pricing, line):
    """The VAV item this Misc / Sensors line names, by the config's `claims_filed.kinds` in their order -- {"kind", "item"} -- or None.
    The caller has already checked the row's filed category and that the sheet has a VAV row."""
    cf = (pricing or {}).get("claims_filed")
    if not cf:
        return None
    oc = pricing.get("own_row_check") or {}
    for k in cf.get("kinds") or []:
        hit = False
        if k.get("share"):
            hit = share_row(pricing, k["share"], line)
        elif k.get("own_row_extra") == "integrator":
            integ = _integrator_extra(oc)
            hit = integ is not None and separate_row(_oc_integrator(oc), integ, line)
        elif k.get("own_row_extra"):
            e = [x for x in oc.get("extras") or [] if x.get("label") == k["own_row_extra"]]
            hit = bool(e) and separate_row(oc, e[0], line)
        elif k.get("existing_boxes"):
            hit = _existing_kind(pricing, line) is not None
        elif k.get("words"):
            # VAV-2b2 (owner 2026-11-21 13:40 "all 7 option a", QR-K3 B1 / B2): the item named in the row's own DESCRIPTION; any unit but a
            # per-metre one (a cable row is never the item)
            desc = (line.get("text") or "").split(" | ")[0]
            unit_ok = _unit_key(line.get("unit")) not in [_unit_key(x) for x in oc.get("metre_units") or []]
            hit = unit_ok and bool(_search(k["words"], desc)) and not (k.get("not_words") and _search(k["not_words"], desc))
        if hit:
            return {"kind": k["id"], "item": k["item"]}
    return None


def claims_for_sheet(pricing, own_category, lines_by_row, cats_by_row):
    """{excel_row: {"kind", "item", "from"}} for every line of ONE sheet the VAV helper claims: filed under one of `claims_filed.categories`,
    on a sheet with at least one line filed `own_category` (owner 12:34 limit 1), naming a VAV item (limit 2). Empty when the key is absent."""
    cf = (pricing or {}).get("claims_filed")
    if not cf:
        return {}
    cats = cf.get("categories") or {}
    if not any(c == own_category for c in cats_by_row.values()):
        return {}
    out = {}
    for er, line in lines_by_row.items():
        frm = cats_by_row.get(er)
        if frm not in cats:
            continue
        c = claim_of(pricing, line)
        if c:
            out[er] = dict(c, **{"from": frm})
    return out

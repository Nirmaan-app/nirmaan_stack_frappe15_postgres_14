# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE SPEC READER -- item name + item detail are the source of truth for a category's attributes.

Slice 1c (2026-09-21). Owner rulings, quoted:
  S-a  "Both - your text for people, attributes for matching" -- owner: "ok. I agree."
  S-b  "ok with spec reader on upload. im that case we shouldnot show the derived attribue columns
       in the csv to avoid confusion. they will be hidden from the user and the spec reader will
       make modifications based on the item and spec."
  S-c  "agree on 1c": (1) the reader reproduces the v1 items EXACTLY, including the slice 1a rulings;
       (2) a spec the reader cannot understand is NEVER guessed -- the preview says exactly why, the
       item is saved with a clear "won't price: spec not understood" mark, and the fix is rewording
       the spec or extending these rules; (3) the Rate Master shows the attributes READ-ONLY and the
       manual add/edit form uses this same reader -- no back door.

WHAT IT IS. A DETERMINISTIC rule set: a spec either fits a rule or it is reported as not understood,
with the reason. No AI call. No fuzzy match. A family this module does not know is not understood.
The rules are the slice 1a mapping (the `_mint_hvac_v1_tmp.py` `attrs_for` table) carried over
verbatim, with every path that mapping ASSERTED on turned into a named refusal.

HOW A CATEGORY OPTS IN. Its stored config carries the top-level key `attributes_from_spec: true`
(registered in `config_validation._KNOWN_CONFIG_KEYS`). Every category WITHOUT the key behaves
exactly as before -- the importer, the exporter and the manual add/edit endpoints all branch on
`spec_categories(discipline)`, which is empty for Electrical. The reader for a category is looked up
by `category_id` in `READERS`; a category that opts in without a reader here is refused LOUDLY at
plan time, never silently passed through.

WHAT IS STORED. On an opted-in item the `attributes` JSON holds the two TEXT keys
(`item_name`, `item_detail` -- the sheet's own words, verbatim) plus the DERIVED keys the reader
produced. A spec the reader could not understand stores the text, `spec_status = "not_understood"`
and `spec_note = <reason>`, and NO derived keys -- the flag rides in the existing JSON column, so no
doctype changed (the same shape as the five undeclared keys Electrical items already carry).
⚠️ CARRY FOR SLICE 5 (recorded in the plan doc): an item whose spec was not understood must NEVER
match in pricing. Not built here -- hvac_adp has no pipelines yet.

PURE: `read_spec` / `read_adp_spec` touch no database. Only `spec_categories` reads the config table,
and it imports frappe lazily so the reader stays importable (and testable) without a bench.
"""

import re

CONFIG_KEY = "attributes_from_spec"

TEXT_ATTRS = ("item_name", "item_detail")
SPEC_STATUS_ATTR = "spec_status"
SPEC_NOTE_ATTR = "spec_note"
NOT_UNDERSTOOD = "not_understood"
# SLICE 1d (owner T-a / T-b): the THIRD status. A spec the exact read could not understand, for which the
# SUGGESTER offered a best match and A USER CONFIRMED it. "read" stays the ABSENCE of a status (1c, unchanged);
# "not_understood" is unchanged. A confirmed item records WHO and WHEN in two more reserved keys.
CONFIRMED = "confirmed"
SPEC_CONFIRMED_BY_ATTR = "spec_confirmed_by"
SPEC_CONFIRMED_AT_ATTR = "spec_confirmed_at"
# The reserved keys the reader OWNS on an opted-in item: never a CSV column, never hand-edited.
RESERVED_ATTRS = (SPEC_STATUS_ATTR, SPEC_NOTE_ATTR, SPEC_CONFIRMED_BY_ATTR, SPEC_CONFIRMED_AT_ATTR)

# The 25 ADP families, in the v1 config's order (this list IS the `family` def's values list).
ADP_FAMILIES = [
    "VCD", "fire damper", "actuator", "control panel", "linear grille", "curved grille", "intake louvre",
    "door grille", "floor grille", "slot diffuser", "square diffuser", "round diffuser", "jet / eyeball diffuser",
    "butterfly damper", "spigot", "flexible duct", "disc valve", "NRD", "collar damper", "sound attenuator",
    "cross-talk", "double-skin plenum", "mixing box / LP plenum", "canvas connection", "access door",
]

# The derived attribute ids the ADP reader may produce -- the v1 `hvac_adp` definitions, minus the
# two text keys this slice adds.
ADP_DERIVED_ATTRS = (
    "family", "damper", "insulated", "neck_mm", "face_w_mm", "face_h_mm", "depth_mm", "dia_mm",
    "slot_count", "torque_nm", "ul", "panel_ratio", "thickness_mm", "variant",
)
# SLICE 9 (owner A-5): the ALTERNATIVE OUTER (`face_alt_w_mm` / `face_alt_h_mm`) is read from the detail
# like every other derived attribute, but it is deliberately NOT in the tuple above -- that tuple mirrors the
# config's `attribute_definitions`, and this pair is NOT a definition: it is never a model question, never a
# panel field and never a CSV column. It is a CATALOGUE fact the pricer's second-key match reads.


class SpecNotUnderstood(Exception):
    """The spec does not fit any rule. `str(exc)` is the exact reason shown to the user."""


# ── the small parsers the slice 1a mapping used, unchanged ─────────────────────────────────


def _dia(d):
    m = re.search(r"(\d+)\s*mm\s*dia", d, re.I)
    return int(m.group(1)) if m else None


def _wxh(d):
    m = re.search(r"(\d+)\s*(?:mm)?\s*x\s*(\d+)", d, re.I)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _neck(d):
    m = re.search(r"NECK:\s*(\d+)X(\d+)", d, re.I)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _outer(d):
    m = re.search(r"OUTER:\s*(\d+)X(\d+)", d, re.I)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _outer_alt(d):
    """SLICE 9 (owner A-5): the ALTERNATIVE outer written in brackets after the real one --
    "OUTER: 595X595 (600X600)". Absent brackets => None, so every pre-slice-9 detail reads exactly
    as it did."""
    m = re.search(r"OUTER:\s*\d+\s*X\s*\d+\s*\(\s*(\d+)\s*X\s*(\d+)\s*\)", d, re.I)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _refuse(reason):
    raise SpecNotUnderstood(reason)


# ── the ADP rules ──────────────────────────────────────────────────────────────────────────


def read_adp_spec(item_name, item_detail, unit=None):
    """The ADP attributes for one spec, or raise SpecNotUnderstood with the exact reason.

    `unit` is accepted for the reader's contract (name, detail, unit) but no ADP rule reads it
    today: the sheet's own three-unit canvas row (R-d 3) is three ITEMS with the same text.
    Family by family, in plain words:

      VCD ............. name starts "volume control damper"; detail is exactly one of GI Rectangular /
                        GI Oval / Motorized -> variant. Anything else: not understood.
      fire damper ..... name is exactly "fire damper"; detail names motorised / UL 555 / with sleeve /
                        without sleeve -> variant + ul. Anything else: not understood.
      actuator ........ name starts "fire damper actuator"; ul from "UL 555" in the name; torque from a
                        leading "<n> NM" in the detail; the owner's "9/10 NM" is torque 10 (R-d 1).
      control panel ... "control panel" in the name; the owner's exact "1:10 /12" is ratio 12 (R-d 2);
                        otherwise a plain "1:N" is N. Anything else: not understood.
      grill ........... name is exactly "grill"; the detail says linear / curved (damper with|without),
                        intake louver, or door grill. Anything else: not understood.
      slot diffuser ... "slot diffuser" in the name; damper from the name; "<n> slot" in the detail is
                        the slot count when present (the sheet leaves it off on some rows).
      square diffuser . name starts "diffuser with" / "diffuser without"; damper from the name; a
                        "NECK: WxH" (W must equal H) is the neck; "OUTER: WxH" is the face; a bare
                        "W x H" is a FACE size, neck NA (R-d 6, row 33); no size at all is accepted
                        as the sheet writes it.
      round diffuser, butterfly damper, flexible duct (insulated unless the name starts "un-"),
      disc valve, spigot, jet / eyeball diffuser ("eye ball" in the name -- one family, R-d 4):
                        "<n> mm dia" in the detail is REQUIRED; missing -> not understood.
      back draft ...... -> NRD.   collar damper / sound attenuator / canvas: family only.
      double skin plenum: "<n> mm" thickness REQUIRED.
      ms floor grill .. damper from the detail.
      z-piece ......... cross-talk; a "W x H" in the detail is the face when present.
      low pressure plenum: mixing box / LP plenum; insulated from the name; "W X H X D" when present.
      access door ..... "W x H" REQUIRED.
      anything else ... not understood: no known family matches the name.
    """
    item = (item_name or "").strip()
    det = (item_detail or "").strip()
    il, dl = item.lower(), det.lower()
    if not item:
        _refuse("Item is blank -- the family is read from the item name.")
    a = {}

    def fam(f):
        a["family"] = f

    def need_dia():
        d = _dia(det)
        if d is None:
            _refuse("no diameter found in '%s' -- write it as '<n> mm dia'." % det)
        a["dia_mm"] = float(d)

    if il.startswith("volume control damper"):
        fam("VCD")
        variants = {"gi rectangular": "GI rectangular", "gi oval": "GI oval", "motorized": "motorised"}
        if dl not in variants:
            _refuse("VCD detail '%s' is not one of GI Rectangular, GI Oval, Motorized." % det)
        a["variant"] = variants[dl]
    elif il == "fire damper":
        fam("fire damper")
        if "motoris" in dl:
            a["variant"] = "motorised"; a["ul"] = "no"
        elif "ul 555" in dl:
            a["variant"] = "UL"; a["ul"] = "yes"
        elif dl.startswith("with ") and "sleeve" in dl:
            a["variant"] = "with sleeve"; a["ul"] = "no"
        elif "wihtout sleeve" in dl or "without sleeve" in dl:
            a["variant"] = "without sleeve"; a["ul"] = "no"
        else:
            _refuse("fire damper detail '%s' names none of: motorised, UL 555, with sleeve, without sleeve." % det)
    elif il.startswith("fire damper actuator"):
        fam("actuator")
        a["ul"] = "yes" if "ul 555" in il else "no"
        if dl.startswith("9/10"):
            a["torque_nm"] = 10.0                                            # R-d (1): "9/10 NM" -> 10
        else:
            m = re.match(r"([\d.]+)\s*nm", dl)
            if not m:
                _refuse("no torque found in '%s' -- write it as '<n> NM'." % det)
            a["torque_nm"] = float(m.group(1))
    elif "control panel" in il:
        fam("control panel")
        if re.fullmatch(r"1\s*:\s*10\s*/\s*12", det):
            a["panel_ratio"] = 12.0                                          # R-d (2): "1:10 /12" -> 12
        else:
            m = re.fullmatch(r"1\s*:\s*(\d+)", det)
            if not m:
                _refuse("panel ratio '%s' is not of the form '1:N'." % det)
            a["panel_ratio"] = float(m.group(1))
    elif il == "grill":
        if "linear" in dl:
            fam("linear grille"); a["damper"] = "with" if "with damper" in dl else "without"
        elif "curved" in dl:
            fam("curved grille"); a["damper"] = "with" if ("with damper" in dl and "without" not in dl) else "without"
        elif "intake louver" in dl:
            fam("intake louvre")
        elif "door grill" in dl:
            fam("door grille")
        else:
            _refuse("grill detail '%s' names none of: linear, curved, intake louver, door grill." % det)
    elif "slot diffuser" in il:
        fam("slot diffuser"); a["damper"] = "without" if "without" in il else "with"
        m = re.match(r"(\d)\s*slot", dl)
        if m:
            a["slot_count"] = float(m.group(1))
    elif il.startswith("diffuser with") or il.startswith("diffuser without"):
        fam("square diffuser"); a["damper"] = "without" if "without" in il else "with"
        n, o = _neck(det), _outer(det)
        if n:
            if n[0] != n[1]:
                _refuse("neck '%dx%d' is not square -- a square diffuser's neck is one size." % n)
            a["neck_mm"] = float(n[0])
        if o:
            a["face_w_mm"], a["face_h_mm"] = float(o[0]), float(o[1])
            alt = _outer_alt(det)                                          # SLICE 9 (A-5): the alternative name
            if alt:
                a["face_alt_w_mm"], a["face_alt_h_mm"] = float(alt[0]), float(alt[1])
        if not n and not o:
            w = _wxh(det)
            if w:
                a["face_w_mm"], a["face_h_mm"] = float(w[0]), float(w[1])   # R-d (6): a FACE size, neck NA
    elif il.startswith("round diffuser"):
        fam("round diffuser"); a["damper"] = "without" if "without" in il else "with"; need_dia()
    elif il.startswith("butterfly damper"):
        fam("butterfly damper"); need_dia()
    elif "flexible duct" in il:
        fam("flexible duct"); a["insulated"] = "without" if il.startswith("un-") else "with"; need_dia()
    elif "disc valve" in il:
        fam("disc valve"); need_dia()
    elif "back draft" in il:
        fam("NRD")
    elif il.startswith("collar damper"):
        fam("collar damper")
    elif il == "sound attenuator":
        fam("sound attenuator")
    elif il.startswith("double skin plenum"):
        fam("double-skin plenum")
        m = re.match(r"(\d+)\s*mm", dl)
        if not m:
            _refuse("no thickness found in '%s' -- write it as '<n> mm'." % det)
        a["thickness_mm"] = float(m.group(1))
    elif il.startswith("ms floor grill"):
        fam("floor grille"); a["damper"] = "without" if "without" in dl else "with"
    elif il == "spigot":
        fam("spigot"); need_dia()
    elif "canvas" in il:
        fam("canvas connection")
    elif il.startswith("z-piece"):
        fam("cross-talk")
        w = _wxh(det)
        if w:
            a["face_w_mm"], a["face_h_mm"] = float(w[0]), float(w[1])
    elif il.startswith("low pressure plenum"):
        fam("mixing box / LP plenum"); a["insulated"] = "without" if "without" in il else "with"
        m = re.search(r"(\d+)\s*X\s*(\d+)\s*X\s*(\d+)", det, re.I)
        if m:
            a["face_w_mm"], a["face_h_mm"], a["depth_mm"] = float(m.group(1)), float(m.group(2)), float(m.group(3))
    elif "eye ball" in il:
        fam("jet / eyeball diffuser"); need_dia()                           # R-d (4): one family
    elif "access door" in il:
        fam("access door")
        w = _wxh(det)
        if not w:
            _refuse("no size found in '%s' -- write it as 'W x H'." % det)
        a["face_w_mm"], a["face_h_mm"] = float(w[0]), float(w[1])
    else:
        _refuse("no known ADP family matches item '%s'." % item)
    assert a["family"] in ADP_FAMILIES, a["family"]
    return a


READERS = {"hvac_adp": read_adp_spec}


def has_reader(category_id):
    return category_id in READERS


def read_spec(category_id, item_name, item_detail, unit=None):
    """(derived_attributes, None) when understood; ({}, reason) when not. Never raises for a spec
    problem; DOES raise for a category that has no reader, because that is a configuration error."""
    reader = READERS.get(category_id)
    if reader is None:
        raise KeyError("no spec reader is registered for category '%s'" % category_id)
    try:
        return reader(item_name, item_detail, unit), None
    except SpecNotUnderstood as exc:
        return {}, str(exc)


def attributes_for(category_id, item_name, item_detail, unit=None):
    """THE ONE STORED SHAPE for an opted-in item's `attributes`: the two text keys, then either the
    derived keys (understood) or the two reserved flag keys (not understood). Every write path --
    the asset mint, the CSV apply, manual add, manual edit -- builds the map through this function,
    so no path can store a different shape from the one the preview described."""
    derived, reason = read_spec(category_id, item_name, item_detail, unit)
    out = {"item_name": item_name, "item_detail": item_detail}
    if reason is None:
        out.update(derived)
    else:
        out[SPEC_STATUS_ATTR] = NOT_UNDERSTOOD
        out[SPEC_NOTE_ATTR] = reason
    return out, reason


def is_not_understood(attributes):
    return (attributes or {}).get(SPEC_STATUS_ATTR) == NOT_UNDERSTOOD


def text_of(attributes):
    """(item_name, item_detail) as stored, '' when absent."""
    attributes = attributes or {}
    return (str(attributes.get("item_name") or ""), str(attributes.get("item_detail") or ""))


def derived_attr_ids(cfg):
    """The config's attribute-definition ids that the reader owns: everything except the text keys."""
    return [
        d["id"] for d in (cfg.get("attribute_definitions") or [])
        if isinstance(d, dict) and d.get("id") and d["id"] not in TEXT_ATTRS
    ]


def spec_categories(discipline):
    """{kind: category_id} for every ACTIVE config of `discipline` that opts in. Empty for a
    discipline with no opted-in category (Electrical), which is what keeps every legacy path
    byte-identical. Lazy frappe import: the reader itself needs no bench."""
    import json

    import frappe

    from nirmaan_stack.services.boq_rate_master import csv_exporter

    out = {}
    for c in frappe.get_all("BoQ Rate Category Config",
                            filters={"discipline": discipline, "active": 1},
                            fields=["category_id", "config"], order_by="category_id asc"):
        cfg = c["config"] if isinstance(c["config"], dict) else json.loads(c["config"] or "{}")
        if cfg.get(CONFIG_KEY) is True:
            for k in csv_exporter._config_kinds(cfg):
                out.setdefault(k, c["category_id"])
    return out


# ══════════════════════════════════════════════════════════════════════════════════════════════
# SLICE 1d -- THE SUGGESTER: when the exact read fails, offer the best match; A USER CONFIRMS IT.
# ══════════════════════════════════════════════════════════════════════════════════════════════
# Owner T-a: "instead of refusing can we take confirmation from user with the best mapping and then
# proceed". Owner T-b ("1d confirmed"): exact read first, unchanged; if it fails, the best match with
# FIXED RULES, not AI -- spelling tolerance and known synonyms -- then the exact rules re-run on the
# corrected text; ONE suggestion or none; none when no family is close enough, when two candidates
# are equally close, or when a required size cannot be read (a size is NEVER invented). Standing
# (1c, S-c 2): a spec is never GUESSED -- a suggestion a user confirms is not a guess; a suggestion
# applied WITHOUT confirmation would be, so nothing here writes anything.
#
# THE TOLERANCE, in plain words: a word of FIVE or more letters that is not itself a family word may be
# corrected to a family word that is ONE letter away (one letter added, dropped or changed -- not two,
# not a swap of two letters), and ONLY when exactly one family word is that close. Shorter words
# ("with", "duct", "slot", "disc", "ball", "oval") are never corrected, because at four letters a
# one-letter change reaches too many real words. The SYNONYM TABLE below is applied first, word-bounded,
# case-insensitive; it is the list of spellings the owner named plus the sheet's own hyphen / spacing
# variants. A whole-name synonym ("Fire Damper UL") maps to a family name AND a detail marker.
# PROVEN (test + the sweep in the slice record): over the 95 sheet names, each family word misspelt by
# one letter two ways, and over the correct names, no name is ever suggested as a DIFFERENT family.

SUGGEST_MAX_EDITS = 1
SUGGEST_MIN_WORD_LEN = 5

# (pattern, replacement, plain words) -- applied to name AND detail, in this order.
SYNONYMS = (
    (r"\bgrilles?\b", "grill", '"Grille" / "Grilles" is read as "Grill"'),
    (r"\blouvres?\b", "louver", '"Louvre" / "Louvres" is read as "Louver"'),
    (r"\bmotorised\b", "motorized", '"Motorised" is read as "Motorized"'),
    (r"\beyeball\b", "eye ball", '"Eyeball" is read as "Eye ball"'),
    (r"\bz\s*piece\b", "z-piece", '"Z piece" / "Zpiece" is read as "Z-piece"'),
    (r"\bback\s*-\s*draft\b", "back draft", '"Back-draft" is read as "Back draft"'),
)
# A whole NAME that stands for a family plus a detail marker: (family name, text prepended to the detail).
NAME_SYNONYMS = {
    "fire damper ul": ("fire damper", "UL 555"),      # T-b (2): "Fire Damper UL" -> fire damper, UL variant
}
# The family words the exact rules key on (name AND detail), five letters or more. A word outside this
# set is never a correction target, so a slip can only ever move TOWARDS a family word.
FAMILY_WORDS = frozenset({
    "volume", "control", "damper", "actuator", "panel", "grill", "diffuser", "round", "butterfly",
    "flexible", "valve", "collar", "sound", "attenuator", "double", "plenum", "floor", "spigot",
    "canvas", "piece", "pressure", "access", "linear", "curved", "intake", "louver", "sleeve",
    "motorized", "without", "draft", "rectangular",
})


def _edit_distance(a, b, cap=SUGGEST_MAX_EDITS):
    """Plain Levenshtein (add / drop / change one letter; a swap counts two), capped: returns cap + 1 as
    soon as the distance must exceed `cap`, so the sweep stays cheap."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        best = i
        for j, cb in enumerate(b, 1):
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            cur.append(v)
            best = min(best, v)
        if best > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def _normalise(text):
    """Lower-case, one space between words, punctuation kept (sizes like 'NECK: 375X375' must survive)."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _apply_synonyms(text, notes):
    out = text
    for pat, rep, words in SYNONYMS:
        new = re.sub(pat, rep, out)
        if new != out:
            notes.append(words)
            out = new
    return out


def _correct_words(text, notes):
    """Correct each alphabetic word of >= SUGGEST_MIN_WORD_LEN letters to the ONE family word within
    SUGGEST_MAX_EDITS; a word with two equally close family words is AMBIGUOUS and stops the whole
    suggestion (returns None)."""
    def fix(m):
        w = m.group(0)
        if w in FAMILY_WORDS:
            return w
        near = sorted(f for f in FAMILY_WORDS if _edit_distance(w, f) <= SUGGEST_MAX_EDITS)
        if not near:
            return w
        if len(near) > 1:
            raise _Ambiguous("'%s' could be %s" % (w, " or ".join("'%s'" % f for f in near)))
        notes.append("'%s' is read as '%s'" % (w, near[0]))
        return near[0]
    return re.sub(r"[a-z]{%d,}" % SUGGEST_MIN_WORD_LEN, fix, text)


class _Ambiguous(Exception):
    pass


def correct_spec_text(item_name, item_detail):
    """(corrected_name, corrected_detail, notes) -- synonyms, then the whole-name table, then one-letter
    word corrections, on BOTH texts. Raises _Ambiguous when a word has two equally close family words.
    PURE."""
    notes = []
    name = _apply_synonyms(_normalise(item_name), notes)
    detail = _apply_synonyms(_normalise(item_detail), notes)
    if name in NAME_SYNONYMS:
        fam, marker = NAME_SYNONYMS[name]
        notes.append("'%s' is read as '%s' with '%s'" % (name, fam, marker))
        name = fam
        detail = (marker + " " + detail).strip()
    name = _correct_words(name, notes)
    detail = _correct_words(detail, notes)
    return name, detail, notes


def suggestion_fingerprint(item_name, item_detail, unit, derived):
    """What the APPLY re-verifies: the text the suggestion was made for and the attributes it would store.
    A suggestion re-derived at apply time that does not reproduce this fingerprint is refused."""
    import hashlib
    import json

    blob = json.dumps([item_name, item_detail, unit, derived], sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:24]


def suggest_spec(category_id, item_name, item_detail, unit=None):
    """ONE suggestion or None, for a spec the EXACT read refused.

    Returns (suggestion, reason). `suggestion` is
      {"attributes": <derived>, "corrected_name", "corrected_detail", "notes": [plain words], "fingerprint"}
    and `reason` is None; or (None, why) -- no family close enough, an ambiguous word, or a family
    recognised whose required size cannot be read (the exact rules' own refusal, verbatim).
    NEVER called by the exact path: the caller runs `read_spec` first and only comes here on a refusal.
    PURE, deterministic, no AI, no network."""
    reader = READERS.get(category_id)
    if reader is None:
        raise KeyError("no spec reader is registered for category '%s'" % category_id)
    try:
        name, detail, notes = correct_spec_text(item_name, item_detail)
    except _Ambiguous as exc:
        return None, "ambiguous: %s -- no suggestion." % exc
    if (name, detail) == (_normalise(item_name), _normalise(item_detail)):
        # nothing to correct: no spelling slip and no synonym applies, so there is no better reading to
        # offer -- the exact read's own refusal (unknown family, or an unreadable size) stands as is.
        return None, "no close match to a known wording in '%s' -- no suggestion." % ((item_name or "").strip(),)
    try:
        derived = reader(name, detail, unit)
    except SpecNotUnderstood as exc:
        # the corrected text names a family but still refuses -- typically a REQUIRED size that is not
        # there. A size is never invented: no suggestion, the exact rule's own words as the reason.
        return None, "after reading %s: %s -- no suggestion." % ("; ".join(notes), exc)
    return {
        "attributes": derived,
        "corrected_name": name,
        "corrected_detail": detail,
        "notes": notes,
        "fingerprint": suggestion_fingerprint(item_name, item_detail, unit, derived),
    }, None


def confirmed_attributes(item_name, item_detail, derived, user, when):
    """THE STORED SHAPE of a CONFIRMED item: the text keys, the suggested derived keys, and the status
    trio -- the ONE builder every write path (CSV apply, manual add, manual edit) goes through."""
    out = {"item_name": item_name, "item_detail": item_detail}
    out.update(derived)
    out[SPEC_STATUS_ATTR] = CONFIRMED
    out[SPEC_CONFIRMED_BY_ATTR] = user
    out[SPEC_CONFIRMED_AT_ATTR] = when
    return out


def is_confirmed(attributes):
    return (attributes or {}).get(SPEC_STATUS_ATTR) == CONFIRMED


def suggestion_label(derived):
    """The best match in words, for the question: 'family = linear grille, damper = without'."""
    return ", ".join("%s = %s" % (k, v) for k, v in (derived or {}).items()) or "(family only)"

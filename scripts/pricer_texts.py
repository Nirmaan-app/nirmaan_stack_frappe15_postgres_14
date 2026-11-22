#!/usr/bin/env python3
"""VAV-2c1 (owner 2026-11-22 10:49 / 13:03 "a": R3; R9): every text of a rate-master asset file, walked and counted by a program.

`walk(asset)` yields every string of every category config and every Pricing Input item: (category, key path, text).
`where(path, text)` says where a text reaches a screen, from the code that renders it, or why it is on no screen (first rule that fits).
`labels(text)` names the internal working labels a text carries (`pricer_text_labels.json`: the R3 kinds). The owner's own words and the
dates are never labels. The guard tests (test_vav2c1_keys, vav2c1CodeLabels.test.ts) and the TSV lists use these same functions, so they cannot disagree.

CLI: pricer_texts.py <asset.json> --labels <out.tsv>   (every text with a label)
     pricer_texts.py <asset.json> --texts <out.tsv>    (every text a pricer can read; prints the counts)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KINDS = [(k["id"], re.compile(k["re"])) for k in json.loads((HERE / "pricer_text_labels.json").read_text(encoding="utf-8"))["kinds"]]
# words of the trade and of the BoQ that look like a label and are none (measured on v81): a rate-only unit, a refrigerant, a filter
NOT_LABELS = {"QRO", "R-410", "R-410A", "R410A", "R-32", "R32", "R-22", "R22"}

RULES: list[tuple[str, str | None, str]] = [
    # (pattern on the key path, where it is shown or None, why)
    (r"^notes$", None, "the category note: no screen reads config.notes"),
    (r"attribute_definitions/.*/(note|guidance)(/|$)", None, "reading guidance: part of the model request, drawn by no item-list screen"),
    (r"(^|/)pipelines/.*/note$|(^|/)pipelines/[^/]+/note$", None, "a pipeline's note: PipelineResult.note has no reader"),
    (r"derivation_reasons/.*/title$", None, "a pattern that finds a rules-page line"),
    (r"(rule_lines|derivation_reasons)/[^/]+/rule$", None, "a rule id: it ties a rules-page line to its reason and is drawn nowhere"),
    (r"(companion_items|existing_work|text_notes|material_text|choice_text|refuse_on_unit_class|named_in_row|unstocked_materials|"
     r"sheet_heading_notes|stream_heading_default|family_text|family_merge|no_sku_named_by)(/.*)?/rule$", None,
     "an audit rule: the pricer returns it and no screen draws it"),
    (r"/(words?|not_words|near_words|not_near_words|pattern|unless|first_words|unit_words|from_words|all_words|any_words|"
     r"\w*_words|words_\w+|words_at_start|when_words|named_words)(/|$)(?!.*/(rule|line|refuse|label)$)", None, "words the helper matches"),
    (r"/derivation_reasons/.*/why$", "rules page (Derivation)", "RateMasterDerivation: '-- why: ...'"),
    (r"/(title|detail)$", "rules page (Derivation) / heading", "rule_lines, titles"),
    (r"/(explain)$", "working line", "ratePipelineInterpreter step label"),
    (r"/rule(_by_family/.*)?$", "working line / field note / rules page", "default, override and conversion rules"),
    (r"/(panel_notes|panel_controls)(/|$)", "field note", "the box's note"),
    (r"(line|lines|note|notes|refuse|refusal|refusals|bar|message|helper_message|pending_label|reason|input_missing|many_line)(_\w+)?(/[^/]+)*$",
     "row note / message", "notes, lines and refusals on a row"),
    (r"/(label|labels|heading|name|names|group|intro|total|extra|tag|tags|add_label|addLabel|called|qty_label|family_note|family_units_label)(/|$)",
     "label or heading", "labels"),
    (r"(values|values_by_family|families|options|category_display|family|prices|unit_words)(/|$)", "name or option", "item names and choices"),
]
_RULES = [(re.compile(p), w, y) for p, w, y in RULES]
_REGEXISH = re.compile(r"\\[bswdWS.]|\(\?[:!=<]|\[\^|\$\)|\.\*")
_IDISH = re.compile(r"^[a-z0-9_.:/+-]*$")


def walk(asset: dict):
    """(category, path as a list, text) for every string of every category config, and of every Pricing Input item."""
    def rec(o, path):
        if isinstance(o, str):
            yield path, o
        elif isinstance(o, dict):
            for k, v in o.items():
                yield from rec(v, path + [k])
        elif isinstance(o, list):
            for i, v in enumerate(o):
                yield from rec(v, path + [i])
    for c in asset["category_configs"]:
        for p, t in rec(c, []):
            yield c["category_id"], p, t
    for it in asset["items"]:
        if str(it.get("kind", "")).endswith("_pricing_input"):
            for p, t in rec(it, ["item:" + str(it["attributes"].get("item"))]):
                yield "pricing_inputs", p, t


def key(path) -> str:
    return "/".join(str(x) for x in path)


def where(category: str, path, text: str) -> tuple[str | None, str]:
    """(where it is shown | None, why). First rule that fits."""
    k = key(path)
    if category == "pricing_inputs":
        leaf = path[-1]
        return (("Pricing Inputs page", "the grid") if leaf in ("name", "remarks", "unit") else (None, "an id or a field of the item"))
    if _REGEXISH.search(text):
        return None, "a pattern the helper matches"
    for rx, w, why in _RULES:
        if rx.search(k):
            if w is not None and _IDISH.match(text) and " " not in text:
                return None, "an id, a unit key or a word"
            return w, why
    return None, "an id, a key, a unit or a word the helper matches"


def labels(text: str) -> list[str]:
    out = []
    for kid, rx in KINDS:
        for m in rx.finditer(text):
            s = m.group(0).strip()
            if s in NOT_LABELS or (kid == "key" and "{" in text[max(0, m.start() - 1):m.start()]):
                continue
            out.append(f"{kid}:{s}")
    return out


def clean(t: str) -> str:
    return t.replace("\t", " ").replace("\r", " ").replace("\n", " / ")


def main(argv: list[str]) -> int:
    asset = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    mode, out = argv[1], argv[2]
    rows, shown, hidden = [], 0, 0
    for cat, path, text in walk(asset):
        w, why = where(cat, path, text)
        shown += w is not None
        hidden += w is None
        lab = labels(text)
        if mode == "--labels" and lab:
            rows.append([cat, key(path), "; ".join(lab), "yes" if w else "no", w or why, clean(text)])
        elif mode == "--texts" and w:
            rows.append([cat, w, key(path), clean(text)])
    head = ["category", "key path", "label(s)", "shown on a screen", "where / why not", "text"] if mode == "--labels" else ["category", "where shown", "key path", "text"]
    Path(out).write_text("\n".join("\t".join(r) for r in [head] + rows) + "\n", encoding="utf-8", newline="\n")
    print(f"walked {shown + hidden} = shown {shown} + not on a screen {hidden}; listed {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

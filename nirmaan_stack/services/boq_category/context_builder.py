# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Committed-tree context builder for the classifier (Classifier CL-1a).

build_sheet_context(boq, sheet_name) reconstructs, from the CURRENT committed tier, the
same per-row context feed the certified harness assembles (electrical_classification_
harness.py) -- so the rule runner and the AI voter receive an identical input contract to
the measured runs. It is the SINGLE feed source: it emits both the rules feed (anc_texts /
anc_headers) AND the structured per-ancestor material (node_type + description + notes) the
AI voter rebuilds the indented ancestor_chain from, so nothing re-walks the tree.

Fidelity to the harness is load-bearing (the EARTH-ANC lesson): anc_texts / anc_headers are
byte-identical to the harness (sheet_name prepended; headers = descriptions only, texts =
description + notes). _notes_text is replicated locally rather than imported -- the harness
is a read-only CLI whose main() opens a Frappe context at import-adjacent scope.

NOTE (parked): work headers are deliberately NOT read or emitted in this slice (owner
decision -- work-header-as-signal is parked behind a separate minor fix). The AI feed stays
the certified measured feed: description / ancestor_chain / notes only.

The walk is foolproof: cycle-guarded, hop-capped (80, mirroring the harness), terminates only
at a parentless node, and NEVER silently drops a row -- a parent pointing at a missing / non-
current node surfaces a per-row warning instead. Row eligibility mirrors the harness scorable-
row rule exactly (node_type in {Line Item, Preamble}).
"""

import json

import frappe

# The harness scorable-row rule (electrical_classification_harness.py: CLASSIFY_NT).
_CLASSIFY_NT = {"Line Item", "Preamble"}
# The harness ancestor-walk hop cap (electrical_classification_harness.py: ancestors()).
_HOP_CAP = 80

_NODE_FIELDS = [
    "name",
    "source_row_number",
    "sort_order",
    "parent_node",
    "node_type",
    "row_class",
    "description",
    "notes",
    "attached_notes",
    "append_notes_raw",
    "level",
    "code",
    "commit_version",
    "is_current",
]

# F1-a (owner 2026-10-22, ruling V2): the text the commit writes on a node whose review row had NO description and NO
# Sl. No. -- commit_pipeline._build_node_pass1: `d.get("description") or d.get("sl_no_value") or "(untitled)"`.
# Pinned to that expression by test_f1a_derived_notes.
_COMMIT_UNTITLED = "(untitled)"


def _commit_note_text(node):
    """The description the COMMIT's derive saw for this node: its stored description, except that the commit's
    stand-in -- "(untitled)", or the node's own code (sl_no_value) standing in for an empty description -- is handed
    back as "", which is what the commit read for that row (owner V2, 2026-10-22).

    ⚠️ BLIND SPOT, KNOWN AND MEASURED: a note whose REAL description is exactly its own sl_no_value is indistinguishable
    here from the stand-in and contributes "" too. 0 such note rows across all 899 committed sheets at F1-a
    (2026-10-22); a later O2 slice that changes what an empty-description note contributes retires this adapter."""
    desc = node.get("description") or ""
    code = node.get("code")
    if desc == _COMMIT_UNTITLED or (code and desc == code):
        return ""
    return desc


def derive_attached_notes(nodes):
    """F1-a: {node name: [note text, ...]} for one sheet's CURRENT committed nodes, built by the commit's own rule
    (commit_pipeline._derive_attached_notes, imported, never re-implemented) over the committed tree: a node's notes are
    the descriptions of its child nodes of row_class "note", in sort_order (= the commit's row_index). The node's
    `parent_node` is the commit's effective parent; a note whose parent is not a current node lands in no list (the
    commit's master bucket). A node with no note children is absent.

    Where the commit derived the saved `attached_notes` (every commit since 2026-08-11), this equals it exactly; where
    the saved copy is stale (older commits), this is the tree as it stands. The import is lazy: the classifier never
    needs it at module load."""
    from nirmaan_stack.api.boq.wizard.commit_pipeline import _derive_attached_notes

    sort_by_name = {n["name"]: n.get("sort_order") for n in nodes}
    name_by_sort = {n.get("sort_order"): n["name"] for n in nodes}
    node_rows = [
        (
            {"row_index": n.get("sort_order"), "description": _commit_note_text(n)},
            {"effective_classification": n.get("row_class"),
             "effective_parent_index": sort_by_name.get(n.get("parent_node"))},
        )
        for n in nodes
    ]
    return {name_by_sort[i]: notes for i, notes in _derive_attached_notes(node_rows).items() if i in name_by_sort}


def _attached_notes_drift(nodes, derived):
    """F1-a AC6: the nodes whose saved `attached_notes` differs from the derived list, compared as the pricing payload
    reads both (extraction._as_list: trimmed strings, blanks dropped) -- [{node, source_row_number, saved, derived}]
    with COUNTS only, for the Suggest run's one log line."""
    from nirmaan_stack.services.boq_rate_master.extraction import _as_list

    out = []
    for n in nodes:
        saved, fresh = _as_list(n.get("attached_notes")), _as_list(derived.get(n["name"]))
        if saved != fresh:
            out.append({"node": n["name"], "source_row_number": n.get("source_row_number"),
                        "saved": len(saved), "derived": len(fresh)})
    return out


def _notes_text(node):
    """Combine a node's own notes + attached_notes (list) + append_notes_raw (dict) into a
    single ' | '-joined string. Byte-identical to the harness _notes_text so the rules feed
    matches the measured runs (the fidelity gate)."""
    parts = []
    if node.get("notes"):
        parts.append(str(node["notes"]).strip())
    an = node.get("attached_notes")
    if an:
        try:
            v = json.loads(an) if isinstance(an, str) else an
        except Exception:
            v = an
        if isinstance(v, list):
            parts += [str(x).strip() for x in v if str(x).strip()]
        elif isinstance(v, dict):
            parts += [str(x).strip() for x in v.values() if str(x).strip()]
        elif v:
            parts.append(str(v).strip())
    ap = node.get("append_notes_raw")
    if ap:
        try:
            v = json.loads(ap) if isinstance(ap, str) else ap
        except Exception:
            v = ap
        if isinstance(v, dict):
            for val in v.values():
                if isinstance(val, list):
                    parts += [str(x).strip() for x in val if str(x).strip()]
                elif str(val).strip():
                    parts.append(str(val).strip())
        elif isinstance(v, list):
            parts += [str(x).strip() for x in v if str(x).strip()]
        elif v:
            parts.append(str(v).strip())
    return " | ".join(p for p in parts if p)


def build_sheet_context(boq, sheet_name):
    """Build the classifier context for one committed sheet.

    Resolves the CURRENT committed BoQ Sheet for (boq, sheet_name VERBATIM #152), reads its
    current BOQ Nodes, and emits one context dict per ELIGIBLE row (node_type in {Line Item,
    Preamble}). Returns a wrapper:

        {
          "committed_version": int | None,   # the current sheet's commit_version (callers stamp it)
          "sheet_name": str,                 # VERBATIM
          "rows": [ {...per-row context...} ],
          "sheet_warnings": [str],           # sheet-level problems (e.g. no current sheet)
        }

    Each row dict:
        excel_row (= source_row_number), node_type, description, sheet_name, committed_version,
        notes (own, combined), own_notes_raw (own, the FLAT notes field alone -- EA-7, additive),
        attached_notes (own, raw), append_notes_raw (own, raw),
        anc_texts (rules feed: [sheet] + desc+notes per ancestor, root-first),
        anc_headers (rules feed: [sheet] + desc-only per ancestor, root-first),
        ancestors (structured, root-first: [{node_type, description, notes, attached_notes,
                   append_notes_raw}] -- the AI voter rebuilds the indented chain from this),
        anc_attached_notes (raw, per ancestor, root-first),
        anc_append_notes_raw (raw, per ancestor, root-first),
        warnings ([str] -- e.g. a broken/non-current ancestor pointer; the row is KEPT),
        derived_attached_notes (F1-a, ADDITIVE: the row's attached notes from the current tree -- also on each
                   `ancestors` entry; read by the pricing payload only).

    F1-a (owner 2026-10-22, O1): the wrapper also carries `attached_notes_drift` (see _attached_notes_drift). Every
    pre-existing key is byte-identical: the classifier reads the saved `attached_notes` exactly as before.
    """
    sheets = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": boq, "sheet_name": sheet_name, "is_current": 1},
        fields=["name", "commit_version"],
    )
    if not sheets:
        return {
            "committed_version": None,
            "sheet_name": sheet_name,
            "rows": [],
            "sheet_warnings": [
                f"No current committed BoQ Sheet for boq={boq}, sheet_name={sheet_name!r}."
            ],
            "attached_notes_drift": [],
        }

    sheet_doc = sheets[0]["name"]
    committed_version = sheets[0]["commit_version"]

    nodes = frappe.get_all(
        "BOQ Nodes",
        filters={"boq": boq, "sheet": sheet_doc, "is_current": 1},
        fields=_NODE_FIELDS,
        order_by="sort_order asc",
    )
    by_name = {n["name"]: n for n in nodes}
    # F1-a: once per sheet, from the nodes already loaded -- no extra query.
    derived = derive_attached_notes(nodes)

    def ancestors(node):
        """Walk parent_node -> root, root-first. Cycle-guarded + hop-capped. Returns
        (chain, broken_ref): broken_ref is the parent name that could not be resolved (missing
        or non-current) when the walk stops early, else None. The row is NEVER dropped."""
        chain = []
        seen = set()
        cur = node.get("parent_node")
        hops = 0
        broken = None
        while cur and cur not in seen and hops < _HOP_CAP:
            if cur not in by_name:
                broken = cur
                break
            seen.add(cur)
            hops += 1
            a = by_name[cur]
            chain.append(a)
            cur = a.get("parent_node")
        chain.reverse()  # root-first
        return chain, broken

    rows = []
    for n in nodes:
        if (n.get("node_type") or "").strip() not in _CLASSIFY_NT:
            continue

        desc = str(n.get("description") or "")
        own_notes = _notes_text(n)
        anc, broken = ancestors(n)

        warnings = []
        if broken is not None:
            warnings.append(
                f"Ancestor walk stopped early: parent_node {broken!r} is missing or not current."
            )

        # Rules feed -- byte-identical to the harness (sheet_name prepended, root-first).
        anc_texts = [str(sheet_name)] + [
            f"{a.get('description') or ''} {_notes_text(a)}".strip() for a in anc
        ]
        anc_headers = [str(sheet_name)] + [str(a.get("description") or "") for a in anc]

        # Structured per-ancestor material -- the AI voter rebuilds the indented chain from this.
        #
        # EA-7 (ADDITIVE ONLY): `own_notes_raw` is the ancestor's FLAT `notes` field on its own,
        # i.e. the first component _notes_text folds into its ' | ' join. The rate-extraction
        # payload needs the three note kinds SEPARATELY so it can label them and apply the tier
        # rule; it cannot recover them from the joined string. Adding a key here changes nothing
        # for any existing consumer -- `notes` still carries the identical joined value, and the
        # classifier voter (ai_voter._ai_item) reads only node_type / description / notes.
        ancestors_struct = [
            {
                "node_type": a.get("node_type"),
                "description": a.get("description") or "",
                "notes": _notes_text(a),
                "own_notes_raw": a.get("notes"),
                "attached_notes": a.get("attached_notes"),
                "append_notes_raw": a.get("append_notes_raw"),
                "derived_attached_notes": derived.get(a["name"]),
            }
            for a in anc
        ]

        rows.append(
            {
                "excel_row": n.get("source_row_number"),
                "node_type": n.get("node_type"),
                "description": desc,
                "sheet_name": sheet_name,  # VERBATIM (#152)
                "committed_version": committed_version,
                "notes": own_notes,
                # EA-7 (ADDITIVE ONLY): the row's FLAT `notes` field on its own. `notes` above is
                # the joined string _notes_text builds and is UNCHANGED; this is the un-folded
                # first component, so extraction can label the three kinds separately.
                "own_notes_raw": n.get("notes"),
                "attached_notes": n.get("attached_notes"),
                "append_notes_raw": n.get("append_notes_raw"),
                "anc_texts": anc_texts,
                "anc_headers": anc_headers,
                "ancestors": ancestors_struct,
                "anc_attached_notes": [a.get("attached_notes") for a in anc],
                "anc_append_notes_raw": [a.get("append_notes_raw") for a in anc],
                "warnings": warnings,
                "derived_attached_notes": derived.get(n["name"]),
            }
        )

    return {
        "committed_version": committed_version,
        "sheet_name": sheet_name,
        "rows": rows,
        "sheet_warnings": [],
        "attached_notes_drift": _attached_notes_drift(nodes, derived),
    }

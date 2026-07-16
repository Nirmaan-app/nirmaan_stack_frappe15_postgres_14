# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Per-sheet classification orchestrator (Classifier CL-1b).

classify_sheet_rows ties the CL-1a service core together for one committed sheet:
context_builder (feed) -> rule runner + independent AI voter -> R3d router -> persist. It
CALLS the CL-1a modules; it does not re-implement any of them.

ELIGIBLE-ONLY, SILENT scoping (owner decision): a range is never rejected for containing
spacers / headings / non-current rows -- the eligible subset (node_type in {Line Item,
Preamble}, current) is classified and the summary reports N-of-M plus a compact
skipped_by_reason count rollup (why the rest were skipped), never a per-row list.

The summary M (total_in_range) is HONEST: it counts every committed row the scope covered,
including the ineligible ones, so "classified N of M" is truthful.
"""

import frappe

from nirmaan_stack.services.boq_category import ai_voter, context_builder, persist, routing
from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset

# The harness scorable-row rule (mirrors context_builder / the harness CLASSIFY_NT).
_CLASSIFY_NT = {"Line Item", "Preamble"}

# AI batch size -- MUST equal ai_voter._BATCH. The orchestrator drives the batching (in slices
# of this size) so it can emit progress BETWEEN batches; the size stays 20 so the AI behaviour
# (batching, prompt, model) is byte-identical to the certified CL-1b smoke test.
_AI_BATCH = 20

# Map an excluded committed row to a compact, human-groupable skip reason. row_class carries
# the fine classification (node_type "Other" covers all of these); is_current=0 -> superseded.
_ROW_CLASS_REASON = {
    "spacer": "layout",
    "header_repeat": "layout",
    "note": "note",
    "subtotal_marker": "subtotal",
}


def _skip_reason(node):
    if not node.get("is_current"):
        return "superseded"
    rc = (node.get("row_class") or "").strip()
    return _ROW_CLASS_REASON.get(rc, "other")


def _empty_summary(committed_version, sheet_warnings):
    return {
        "total_in_range": 0,
        "eligible_classified": 0,
        "needs_review": 0,
        "auto_accepted": 0,
        "skipped_total": 0,
        "skipped_by_reason": {},
        "committed_version": committed_version,
        "sheet_warnings": sheet_warnings,
        "ai_status": None,
    }


def classify_sheet_rows(boq, sheet_name, discipline, row_filter=None, progress_cb=None, ai_client=None):
    """Classify one committed sheet's eligible rows.

    row_filter: None (whole sheet) or (start_excel_row, end_excel_row) inclusive.
    progress_cb: optional callable(done, total) invoked once per 20-row AI batch (done is the
        cumulative rows fed to the voter so far, clamped to total).
    ai_client: optional injected Anthropic client (tests); passed through to the AI voter.

    Returns {total_in_range, eligible_classified, needs_review, auto_accepted, skipped_total,
    skipped_by_reason:{reason:count}, committed_version, sheet_warnings}.
    """
    # Resolve the CURRENT committed sheet (needed for the honest-M skip rollup -- context_builder
    # returns eligible rows only, so the ineligible/superseded counts come from a direct read).
    sheets = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": boq, "sheet_name": sheet_name, "is_current": 1},
        fields=["name", "commit_version"],
    )
    if not sheets:
        return _empty_summary(
            None, [f"No current committed BoQ Sheet for boq={boq}, sheet_name={sheet_name!r}."]
        )
    sheet_doc = sheets[0]["name"]
    committed_version = sheets[0]["commit_version"]

    # Defence-in-depth: a classification-frozen sheet rejects a re-classify here too (the primary
    # guard is in start_classify, which blocks the enqueue). This backstops any DIRECT service /
    # test caller of classify_sheet_rows. Reject-mutates-nothing: fires before any node read/write.
    if persist.is_sheet_classification_frozen(boq, sheet_name, committed_version):
        frappe.throw(persist._FROZEN_WRITE_MESSAGE, title="Classification frozen")

    def _in_range(row_number):
        if row_filter is None:
            return True
        start, end = row_filter
        return row_number is not None and start <= row_number <= end

    # Honest M + skip rollup: EVERY committed row under the current sheet doc in scope (any
    # is_current). Eligible rows are classified below; the rest are counted by reason.
    scope_nodes = [
        n
        for n in frappe.get_all(
            "BOQ Nodes",
            filters={"boq": boq, "sheet": sheet_doc},
            fields=["source_row_number", "node_type", "row_class", "is_current"],
        )
        if _in_range(n.get("source_row_number"))
    ]
    total_in_range = len(scope_nodes)
    skipped_by_reason = {}
    for n in scope_nodes:
        if n.get("is_current") and (n.get("node_type") or "").strip() in _CLASSIFY_NT:
            continue  # eligible -> classified below
        reason = _skip_reason(n)
        skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + 1
    skipped_total = sum(skipped_by_reason.values())

    # Eligible feed (context_builder = is_current=1 + eligible), filtered to the scope range.
    ctx = context_builder.build_sheet_context(boq, sheet_name)
    kept = [row for row in ctx["rows"] if _in_range(row.get("excel_row"))]

    ruleset = load_ruleset(discipline=discipline)
    rules_version = ruleset.get("version", "") or ""

    total = len(kept)
    # Independent AI voter, driven in slices of _AI_BATCH so progress fires BETWEEN 20-row
    # batches (Option A). Batch size is IDENTICAL to ai_voter._BATCH -- AI behaviour (batching,
    # prompt, model) stays byte-identical to the certified smoke test; only the progress emit is
    # added. The voter never sees rule output. When ai_client is None (production) the voter
    # builds its client per slice -- negligible vs opus latency, and keeps ai_voter the sole
    # owner of client/settings logic (no duplication here).
    ai_by_excel = {}
    prompt_version = model = ""
    ai_status = None  # "ran" | "disabled" | "no_key" (None only when there were no eligible rows)
    for b in range(0, total, _AI_BATCH):
        env = ai_voter.classify_rows_ai(kept[b:b + _AI_BATCH], discipline=discipline, client=ai_client)
        for r in env["results"]:
            ai_by_excel[r["excel_row"]] = r
        prompt_version = env.get("prompt_version", "") or prompt_version
        model = env.get("model", "") or model
        ai_status = env.get("ai_status") or ai_status
        if progress_cb:
            progress_cb(min(b + _AI_BATCH, total), total)

    # AI-off fail-safe (Option A, owner-locked). When the independent AI voter did NOT actually
    # run (settings disabled / no key), it returned a blank vote for EVERY row, so route_r3d would
    # treat rule=category / AI=blank as a one-sided disagreement and BLANK final_category_id --
    # leaving every Category cell empty. Instead: adopt the RULE category as the effective category
    # (a genuine rule-abstain -> "" stays honestly blank) and flag EVERY row Needs review. This is a
    # RUN-LEVEL override that the pure, unit-tested route_r3d is deliberately blind to (and persist
    # stays a faithful writer) -- neither is touched. eb9221ac wired only the amber "AI voter was
    # off" completion note; this completes the fail-safe the note describes.
    ai_off = ai_status in ("disabled", "no_key")

    rows_to_persist = []
    needs_review = 0
    auto_accepted = 0
    for row in kept:
        notes_list = [row["notes"]] if row.get("notes") else []
        res = classify_line(
            row.get("description") or "",
            row.get("anc_texts"),
            notes_list,
            discipline=discipline,
            ancestor_headers=row.get("anc_headers"),
        )
        ai = ai_by_excel.get(row["excel_row"], {"category_id": "", "confidence": 0.0})
        routed = routing.route_r3d(
            {"category_id": res["category_id"], "band": res["band"]},
            {"category_id": ai.get("category_id", ""), "confidence": ai.get("confidence", 0.0)},
        )
        if ai_off:
            # Rule category becomes the effective category; every row flagged for review. Overriding
            # `routed` HERE (before the counter + rows_to_persist assembly) means the existing
            # needs_review tally counts it exactly once and persist stores the rule category.
            routed = {
                "routing": "Needs review",
                "final_category_id": res["category_id"] or "",
                "reason": "AI off -- rule category, flagged for review",
            }
        if routed["routing"] == "Auto-accepted":
            auto_accepted += 1
        else:
            needs_review += 1
        rows_to_persist.append(
            {
                "excel_row": row["excel_row"],
                "rule_category_id": res["category_id"],
                "rule_band": res["band"],
                "rule_score": res["score"],
                "ai_category_id": ai.get("category_id", ""),
                "ai_confidence": ai.get("confidence", 0.0),
                "final_category_id": routed["final_category_id"],
                "routing": routed["routing"],
                "routing_reason": routed["reason"],
                "description": row.get("description") or "",
                "rules_version": rules_version,
                "prompt_version": prompt_version,
                "model": model,
            }
        )

    if rows_to_persist:
        persist.write_row_categories(boq, sheet_name, committed_version, discipline, rows_to_persist)

    return {
        "total_in_range": total_in_range,
        "eligible_classified": len(rows_to_persist),
        "needs_review": needs_review,
        "auto_accepted": auto_accepted,
        "skipped_total": skipped_total,
        "skipped_by_reason": skipped_by_reason,
        "committed_version": committed_version,
        "sheet_warnings": ctx.get("sheet_warnings", []),
        "ai_status": ai_status,
    }

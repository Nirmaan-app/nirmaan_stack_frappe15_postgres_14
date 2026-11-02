# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Spec cards for historical matching (DEV2-B1; owner R-H2W, R-H2AH, B0 gaps G10 (a) / G24 (a)).

A SPEC CARD is the model's structured reading of one BoQ row (kind, scope, material, dims, ratings, ...). This
module builds the card requests, reuses stored cards, sends what is left through the safe call runner and stores
every answer -- good or not -- in `BoQ Row Spec Card`.

THE REQUEST IS DEV2-S8 C3's, BYTE FOR BYTE (the owner's bench measured on it):
  * the prompt is `card_prompt.txt` beside this file, copied verbatim from DEV2-S8's p1_card_prompt.txt;
  * each row's payload is `extraction._ai_item(row)` over `context_builder.build_sheet_context` -- the SAME block
    the Suggest run sends, never cut (R-H2SPEC);
  * the message is prompt + extraction._ROW_CONTEXT_SHAPE_GUIDANCE + "\\n\\nROWS:\\n" + json.dumps(items,
    ensure_ascii=False);
  * rows go in sheet order (excel_row ascending), at most 20 to a request, one sheet per request.

REUSE (R-H2W): a row is not sent when a card with status "ok" exists for its (payload_sha256, prompt_version,
model). payload_sha256 is the sha256 of the row's exact `_ai_item` block as sent (json.dumps, ensure_ascii=False),
so any change to the row's text, notes or headings -- or its Excel row -- makes a new payload; prompt_version is the
sha256 of the prompt file. A malformed or failed card is sent again, and its stored row is overwritten in place.

STORE: one `BoQ Row Spec Card` per (payload_sha256, prompt_version, model). A reply that parses gives each row its
card ("ok"); a row missing from the reply, or a reply that does not parse, is stored "malformed" with the error and
what came back (never dropped); a call that failed or was never answered is stored "failed". Each row carries an
equal share of its request's tokens and cost.

THE COMMIT JOB (R-H2W "new BoQs get cards at commit time"): commit_pipeline enqueues `card_committed_sheet` for a
committed sheet ONLY when match_enabled AND match_cards_at_commit are both on (both OFF by default). It cards the
sheet's rate-editable rows -- Line Item always, a qty-bearing Preamble -- as extraction._rate_editable_excel_rows
defines them.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import frappe

from nirmaan_stack.services.boq_rate_match import call_runner

CARD_DOCTYPE = "BoQ Row Spec Card"
PROMPT_PATH = Path(__file__).resolve().parent / "card_prompt.txt"
CARD_BATCH_ROWS = 20
STATUS_OK, STATUS_MALFORMED, STATUS_FAILED = "ok", "malformed", "failed"
CARD_JOB_TIMEOUT_SEC = 1800


# --- the request -------------------------------------------------------------------------------------------------

def card_prompt() -> str:
    """The card prompt, exactly as stored (UTF-8)."""
    return PROMPT_PATH.read_bytes().decode("utf-8")


def prompt_version() -> str:
    """sha256 of the prompt file's bytes: a card made under another prompt is never reused."""
    return hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest()


def item_block(item: dict) -> str:
    """The row's payload block exactly as the request carries it."""
    return json.dumps(item, ensure_ascii=False)


def payload_sha256(item: dict) -> str:
    return hashlib.sha256(item_block(item).encode("utf-8")).hexdigest()


def request_content(items: list) -> str:
    """DEV2-S8 C3's message: prompt + the row-context guidance + the rows."""
    from nirmaan_stack.services.boq_rate_master import extraction

    return card_prompt() + extraction._ROW_CONTEXT_SHAPE_GUIDANCE + "\n\nROWS:\n" + json.dumps(items, ensure_ascii=False)


def sheet_items(boq: str, sheet_name: str, excel_rows=None):
    """(committed_version, [(excel_row, item)], not_in_context) for one committed sheet, in sheet order.

    `excel_rows` None = the sheet's rate-editable rows (Line Item + qty-bearing Preamble); otherwise exactly those
    rows. A requested row the context does not hold is named in not_in_context, never dropped silently."""
    from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
    from nirmaan_stack.services.boq_rate_master import extraction

    ctx = build_sheet_context(boq, sheet_name)
    cv = ctx["committed_version"]
    if cv is None:
        return None, [], sorted(excel_rows or [])
    wanted = (set(extraction._rate_editable_excel_rows(boq, sheet_name, cv)) if excel_rows is None
              else {int(r) for r in excel_rows})
    by_row = {r["excel_row"]: r for r in ctx["rows"]}
    items = [(er, extraction._ai_item(by_row[er])) for er in sorted(wanted) if er in by_row]
    return cv, items, sorted(er for er in wanted if er not in by_row)


def batches(items: list) -> list:
    """At most CARD_BATCH_ROWS rows to a request, in the order given."""
    return [items[i:i + CARD_BATCH_ROWS] for i in range(0, len(items), CARD_BATCH_ROWS)]


# --- reuse and the store -----------------------------------------------------------------------------------------

def existing_cards(keys: list, version: str, model: str) -> dict:
    """{payload_sha256: (name, status)} for stored cards of these payloads under this prompt and model."""
    if not keys:
        return {}
    rows = frappe.get_all(
        CARD_DOCTYPE,
        filters={"payload_sha256": ["in", list(keys)], "prompt_version": version, "model": model},
        fields=["name", "payload_sha256", "status"],
    )
    return {r["payload_sha256"]: (r["name"], r["status"]) for r in rows}


def plan_sheet(boq: str, sheet_name: str, model: str, excel_rows=None) -> dict:
    """What a card run of this sheet would send: {committed_version, reused, batches, not_in_context}. Each batch is
    {name, rows: [excel_row], items, keys: [payload_sha256], content}. A row with an ok card is in `reused`."""
    version = prompt_version()
    cv, items, missing = sheet_items(boq, sheet_name, excel_rows)
    keys = {er: payload_sha256(it) for er, it in items}
    stored = existing_cards(list(keys.values()), version, model)
    reused = [er for er, _ in items if stored.get(keys[er], (None, None))[1] == STATUS_OK]
    todo = [(er, it) for er, it in items if stored.get(keys[er], (None, None))[1] != STATUS_OK]
    out = []
    for i, chunk in enumerate(batches(todo), start=1):
        its = [it for _, it in chunk]
        out.append({
            "name": f"{boq}|{sheet_name}|{i:04d}",
            "rows": [er for er, _ in chunk],
            "items": its,
            "keys": [keys[er] for er, _ in chunk],
            "content": request_content(its),
        })
    return {"committed_version": cv, "prompt_version": version, "reused": reused, "batches": out,
            "not_in_context": missing, "stored": stored}


def parse_reply(text, ids: list) -> tuple[dict, str | None]:
    """({id: card dict}, error). The reply must hold one JSON array; each element with a known id is that row's card.
    A reply that does not parse gives ({}, error); rows it does not answer are simply absent."""
    s = (text or "").strip()
    a, b = s.find("["), s.rfind("]")
    if a < 0 or b < a:
        return {}, "no JSON array in the reply"
    try:
        arr = json.loads(s[a:b + 1])
    except ValueError as e:
        return {}, f"the reply's JSON does not parse: {e}"
    if not isinstance(arr, list):
        return {}, "the reply is not a JSON array"
    want = {str(i) for i in ids}
    cards = {}
    for el in arr:
        if isinstance(el, dict) and str(el.get("id")) in want:
            cards[str(el.get("id"))] = el
    return cards, None


def _store(stored: dict, *, boq, sheet_name, excel_row, cv, key, version, model, card, status, tin, tout, usd):
    values = {
        "boq": boq, "sheet": sheet_name, "excel_row": excel_row, "commit_version": cv,
        "payload_sha256": key, "prompt_version": version, "model": model,
        "card_json": json.dumps(card, ensure_ascii=False), "status": status,
        "tokens_in": tin, "tokens_out": tout, "cost_usd": usd,
    }
    prior = stored.get(key)
    if prior:
        doc = frappe.get_doc(CARD_DOCTYPE, prior[0])
        doc.update(values)
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(dict(doctype=CARD_DOCTYPE, **values))
        doc.insert(ignore_permissions=True)
    stored[key] = (doc.name, status)


def card_sheet(boq: str, sheet_name: str, *, excel_rows=None, cap_usd=None, client=None, settings=None) -> dict:
    """Card one committed sheet. Refuses (MatchSettingsIncomplete) when the card model or a price is empty. Returns a
    summary: counts by status, reused, not sent (by batch), the stop reason and the spend."""
    from nirmaan_stack.api.boq.wizard.ai_settings import require_match_settings

    s = settings or require_match_settings("card")
    plan = plan_sheet(boq, sheet_name, s["model"], excel_rows)
    cap = s["cost_cap_usd"] if cap_usd is None else cap_usd
    reqs = [call_runner.CallRequest(name=b["name"], content=b["content"], model=s["model"],
                                    max_tokens=s["reply_max_tokens"], price_in=s["price_in"],
                                    price_out=s["price_out"], timeout=s.get("request_timeout_seconds"))
            for b in plan["batches"]]
    summary = {"boq": boq, "sheet": sheet_name, "committed_version": plan["committed_version"],
               "prompt_version": plan["prompt_version"], "model": s["model"], "reused": len(plan["reused"]),
               "not_in_context": plan["not_in_context"], "batches": len(reqs), "not_sent": [],
               "stop_reason": None, "spent_usd": 0.0, STATUS_OK: 0, STATUS_MALFORMED: 0, STATUS_FAILED: 0}
    if not reqs:
        return summary
    res = call_runner.run(reqs, cap_usd=cap, limits=call_runner.Limits.from_settings(s), client=client)
    by_name = {b["name"]: b for b in plan["batches"]}
    for name, r in res.results.items():
        b = by_name[name]
        n = len(b["rows"])
        tin, tout, usd = round(r.tokens_in / n), round(r.tokens_out / n), r.cost_usd / n
        if r.ok:
            cards, err = parse_reply(r.text, [it["id"] for it in b["items"]])
        else:
            cards, err = {}, r.error or "the call failed"
        for er, it, key in zip(b["rows"], b["items"], b["keys"]):
            card = cards.get(str(it["id"]))
            if card is not None:
                status, body = STATUS_OK, card
            elif r.ok:
                status = STATUS_MALFORMED
                body = {"error": err or "no card for this row in the reply", "stop_reason": r.stop_reason,
                        "reply_text": r.text}
            else:
                status, body = STATUS_FAILED, {"error": err, "status": r.status}
            _store(plan["stored"], boq=boq, sheet_name=sheet_name, excel_row=er, cv=plan["committed_version"],
                   key=key, version=plan["prompt_version"], model=s["model"], card=body, status=status,
                   tin=tin, tout=tout, usd=usd)
            summary[status] += 1
        frappe.db.commit()
    summary.update(not_sent=res.not_sent, stop_reason=res.stop_reason, stop_detail=res.stop_detail,
                   spent_usd=res.spent_usd)
    return summary


# --- the commit job ----------------------------------------------------------------------------------------------

def boq_card_spend(boq: str) -> float:
    """USD already spent on cards stored for this BoQ (R-H2AD: the cap is per BoQ)."""
    v = frappe.db.sql(f'select coalesce(sum(cost_usd), 0) from "tab{CARD_DOCTYPE}" where boq = %s', (boq,))
    return float(v[0][0] or 0)


def enqueue_sheet_cards(boq: str, sheet_name: str, commit_version: int) -> bool:
    """Called by commit_pipeline right after a sheet's commit. Enqueues one card job on queue `long` ONLY when
    match_enabled AND match_cards_at_commit are both ON; otherwise returns False having read nothing but the two
    switches. Never raises (a committed sheet must not fail on a settings read or a queue error)."""
    from nirmaan_stack.api.boq.wizard.ai_settings import match_cards_at_commit_on

    if not match_cards_at_commit_on():
        return False
    try:
        frappe.enqueue(
            "nirmaan_stack.services.boq_rate_match.cards.card_committed_sheet",
            queue="long", timeout=CARD_JOB_TIMEOUT_SEC,
            job_id=f"boq_spec_cards:{boq}:{sheet_name}:{commit_version}", deduplicate=True,
            boq=boq, sheet_name=sheet_name, commit_version=commit_version,
        )
        return True
    except Exception:
        frappe.log_error(title="BoQ spec-card enqueue failed", message=frappe.get_traceback())
        return False


def card_committed_sheet(boq: str, sheet_name: str, commit_version: int) -> dict | None:
    """The background job. Re-checks both switches (off = nothing), skips a sheet that has been re-committed since
    (its newer commit enqueued its own job), and cards the rate-editable rows within the BoQ's remaining cap."""
    from nirmaan_stack.api.boq.wizard.ai_settings import match_cards_at_commit_on, require_match_settings

    if not match_cards_at_commit_on():
        return None
    current = frappe.db.get_value("BoQ Sheet", {"boq": boq, "sheet_name": sheet_name, "is_current": 1},
                                  "commit_version")
    if current is None or int(current) != int(commit_version):
        return {"skipped": "the sheet is no longer at this committed version"}
    s = require_match_settings("card")
    remaining = s["cost_cap_usd"] - boq_card_spend(boq)
    if remaining <= 0:
        return {"skipped": f"the BoQ's card spend has reached the cap of {s['cost_cap_usd']} USD"}
    return card_sheet(boq, sheet_name, cap_usd=remaining, settings=s)

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""In-stack independent AI voter (Option B) for the classifier (Classifier CL-1a).

Ports the certified harness _ai_batch mechanics (electrical_classification_harness.py) into a
Frappe-callable service: batch of 20, retry with backoff, valid-id enforcement, confidence
clamp, and the indented ancestor_chain feed. The AI voter is INDEPENDENT -- it NEVER receives
rule-engine output (a design invariant); it sees only the line's description, its ancestor
chain, and its own notes.

FEED FIDELITY: the per-item payload is the certified measured feed -- {id, description,
ancestor_chain, notes} ONLY. Work headers are deliberately NOT included (owner decision --
work-header-as-signal is parked). This keeps the AI input byte-identical to the measured runs.

Config/secret resolution reuses api/boq/wizard/ai_settings.py (the encrypted-key + settings
singleton). Model = settings value else "claude-opus-4-8" (mirrors the harness line). Fails
CLOSED: when the settings singleton is disabled (or no key), NO Anthropic client is built and
NO API call is attempted -- every row returns a blank verdict.

No enqueue here (CL-1a is service core only). The background worker that orchestrates rules +
this voter + routing + persist is a later slice.
"""

import json
import os
import re
import time

from nirmaan_stack.services.boq_category.runner import load_ruleset

_BATCH = 20
_AI_MAX_TOKENS = 8000
_AI_TIMEOUT = 300
_RETRIES = 3
_DEFAULT_MODEL = "claude-opus-4-8"

_PROMPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "prompts", "electrical_ai_category_prompt.md"
)


def _read_prompt():
    with open(_PROMPT_PATH, encoding="utf-8") as fh:
        return fh.read()


def _parse_prompt_version(text):
    """Extract the prompt version token from the header comment ('version: v1.3 (...)')."""
    m = re.search(r"version:\s*(\S+)", text)
    return m.group(1) if m else ""


def _extract_json_array(text):
    s = text.find("[")
    e = text.rfind("]")
    if s == -1 or e == -1 or e < s:
        raise ValueError("no JSON array in AI response")
    return json.loads(text[s : e + 1])


def _ai_item(item):
    """Build one AI payload item from a context row -- the certified measured shape:
    {id, description, ancestor_chain, notes}. ancestor_chain is the harness indented tree
    ([sheet] first, then each ancestor 'node_type: description  (notes: ...)' indented)."""
    chain = [f"[sheet] {item.get('sheet_name')}"]
    for i, a in enumerate(item.get("ancestors") or []):
        line = f"{'  ' * (i + 1)}{a.get('node_type') or ''}: {a.get('description') or ''}"
        an = (a.get("notes") or "").strip()
        if an:
            line += f"  (notes: {an})"
        chain.append(line)
    return {
        "id": item["excel_row"],
        "description": item.get("description") or "",
        "ancestor_chain": chain,
        "notes": item.get("notes") or "",
    }


def _ai_batch(client, model, prompt_text, payload_items, valid_ids):
    """One batch call with retry/backoff. Returns {id: (category_id, confidence, reason)}.
    A category outside valid_ids is blanked; confidence is clamped to [0, 1]. Ports the
    harness _ai_batch verbatim (batch <= 20, 3 attempts, sleep 2*attempt)."""
    payload = prompt_text + "\n" + json.dumps(payload_items, ensure_ascii=False)
    last = None
    for attempt in range(1, _RETRIES + 1):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=_AI_MAX_TOKENS,
                messages=[{"role": "user", "content": payload}],
                timeout=_AI_TIMEOUT,
            )
            text = "".join(getattr(b, "text", "") for b in resp.content)
            out = {}
            for el in _extract_json_array(text):
                rid = int(el["id"])
                cat = el.get("category_id") or ""
                cat = cat if cat in valid_ids else ""
                try:
                    conf = float(el.get("confidence"))
                except (TypeError, ValueError):
                    conf = 0.0
                out[rid] = (cat, max(0.0, min(1.0, conf)), str(el.get("brief_reason") or "").strip())
            return out
        except Exception as exc:
            last = exc
            time.sleep(2 * attempt)
    raise RuntimeError(f"AI batch failed after {_RETRIES} attempts: {last!r}")


def classify_rows_ai(items, discipline="Electrical", client=None):
    """Classify context rows with the independent AI voter.

    items: the list of context rows from context_builder.build_sheet_context(...)["rows"]
    (each carrying excel_row, description, ancestors, notes, sheet_name).
    client: an optional injected Anthropic client (for tests). When None and enabled, a real
    anthropic.Anthropic is built from the encrypted key.

    Returns {model, prompt_version, enabled, results:[{excel_row, category_id, confidence,
    reason}]}. Fails CLOSED (enabled False / no key) -> blank results, no API call.
    """
    from nirmaan_stack.api.boq.wizard.ai_settings import (
        get_boq_ai_api_key,
        get_boq_ai_settings,
    )

    ruleset = load_ruleset(discipline=discipline)
    valid_ids = {c["category_id"] for c in ruleset["categories"]}
    prompt_text = _read_prompt()
    prompt_version = _parse_prompt_version(prompt_text)

    settings = get_boq_ai_settings()
    model = settings.get("model") or _DEFAULT_MODEL

    def _blank_results():
        return [
            {"excel_row": it["excel_row"], "category_id": "", "confidence": 0.0, "reason": ""}
            for it in items
        ]

    # The AI voter stamps only ITS OWN provenance (prompt_version + model). rules_version is
    # the rule engine's provenance, assembled by the orchestrator/persist caller separately.
    # ai_status tells the caller whether the voter ACTUALLY ran: "ran" | "disabled" | "no_key"
    # (the two fail-closed cases return blank verdicts, so the caller can surface "AI did not run"
    # at completion instead of a silent all-needs-review).
    def _envelope(enabled, results, ai_status):
        return {
            "model": model,
            "prompt_version": prompt_version,
            "enabled": enabled,
            "ai_status": ai_status,
            "results": results,
        }

    # Fail closed: disabled settings -> no client, no call.
    if not settings.get("enabled"):
        return _envelope(False, _blank_results(), "disabled")

    if client is None:
        api_key = get_boq_ai_api_key()
        if not api_key:
            return _envelope(True, _blank_results(), "no_key")
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

    ai_out = {}
    for b in range(0, len(items), _BATCH):
        batch = items[b : b + _BATCH]
        payload_items = [_ai_item(it) for it in batch]
        ai_out.update(_ai_batch(client, model, prompt_text, payload_items, valid_ids))

    results = []
    for it in items:
        cat, conf, reason = ai_out.get(it["excel_row"], ("", 0.0, "AI_MISSING"))
        results.append(
            {"excel_row": it["excel_row"], "category_id": cat, "confidence": conf, "reason": reason}
        )
    return _envelope(True, results, "ran")

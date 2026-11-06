# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE H2 BENCH's TEST CLIENT (split out of h2_bench.py in DEV2-B6 when the guard took it past 500 lines; h2_bench
re-exports both names, so h2_bench.RecordingClient is unchanged for its callers and the slices' scripts).

RecordingClient wraps the model client: it archives every request and raw reply and refuses a call that would pass the
caller's TEST budget (a scratch / bench run's caps; the product itself has no cost cap). No model call happens here.
"""
import json
import os
import threading
import time


# DEV2-B6 S1 (owner answer 2 to DEV2-B5: "the test-budget guard should reserve the measured p90 reply size, not the
# 32,000 ceiling (it has tripped well below real use twice: B3 T4, B5 S1)"). MEASURED in DEV2-B6 P0 (e) over every
# archived reply of DEV2-B3 p2 / p2b / t4_run1 / t4b, DEV2-B4 s1_run + the 10 s4 sheets and DEV2-B5 s1 (x3): JUDGE
# 3,828 replies, output tokens p50 2,508 / p90 3,920 / p99 5,496 / max 25,362; CARD 61 replies, p50 8,518 / p90 13,819 /
# p99 16,095 / max 17,398. A judge request is the one carrying "CANDIDATES:" (judge.build_request); any other is a card.
P90_REPLY_TOKENS = {"judge": 3920, "card": 13819}


def reply_reserve(content, max_tokens):
    """The reply tokens a call in flight reserves: the measured p90 of its kind, never above its own max_tokens."""
    return min(int(max_tokens), P90_REPLY_TOKENS["judge" if "CANDIDATES:" in content else "card"])


class RecordingClient:
    """Wraps the model client: archives every request and raw reply (with the rate-limit headers) and refuses a call
    that would pass the caller's test budget. Before the send a call reserves chars / 2 + the measured p90 reply
    (DEV2-B6); after every reply the REAL totals are checked, and once one reaches its cap no further call is sent
    (`reached` says why; each refused call is named in `skipped`). No model call happens here."""

    def __init__(self, client, archive=None, max_calls=None, max_tokens=None, max_usd=None, price_in=0, price_out=0):
        self.client, self.archive = client, archive
        self.skipped = []          # DEV2-B4: calls the test budget refused (named, counted); the run went on
        self.reached = None        # DEV2-B6: set once a REAL total reaches its cap; every later call is refused
        self.caps = (max_calls, max_tokens, max_usd)
        self.prices = (price_in, price_out)
        self.lock = threading.Lock()
        self.calls = self.tokens = self.r_tokens = 0
        self.usd = self.r_usd = 0.0
        self.messages = self
        if archive:
            os.makedirs(archive, exist_ok=True)

    def _write(self, name, rec):
        if self.archive:
            with self.lock, open(os.path.join(self.archive, name), "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")

    def create(self, **kw):
        content = kw["messages"][0]["content"]
        out_t = reply_reserve(content, kw["max_tokens"])
        up_t = int(len(content) / 2) + out_t
        up_usd = (int(len(content) / 2) * self.prices[0] + out_t * self.prices[1]) / 1e6
        mc, mt, mu = self.caps
        with self.lock:
            if self.reached or ((mc is not None and self.calls + 1 > mc) or (mt is not None and self.tokens + self.r_tokens + up_t > mt)
                                or (mu is not None and self.usd + self.r_usd + up_usd > mu)):
                # DEV2-B4 (owner answer 3 to DEV2-B3 Q3): SKIP this call, never stop the run. CallerRefused is the
                # runner's own refusal type, so it is never read as a connection error.
                why = (f"test budget reached: {self.reached}" if self.reached else
                       f"test budget: this call would pass the budget (calls {self.calls}, tokens "
                       f"{self.tokens}+{self.r_tokens}, usd {self.usd:.4f}+{self.r_usd:.4f})")
                self.skipped.append(why)
                from nirmaan_stack.services.boq_rate_match.call_runner import CallerRefused
                raise CallerRefused(why)
            self.calls += 1
            self.r_tokens += up_t
            self.r_usd += up_usd
        n = self.calls
        self._write("requests.jsonl", {"n": n, "ts": time.time(), "request": kw})
        t0 = time.time()
        headers, resp, err = {}, None, None
        try:
            raw = self.client.messages.with_raw_response.create(**kw)
            headers = {k: v for k, v in raw.headers.items() if k.startswith("anthropic-ratelimit") or k in ("request-id", "retry-after")}
            resp = raw.parse()
        except Exception as e:  # noqa: BLE001 -- archived, then raised for the runner to classify
            err = e
        u = getattr(resp, "usage", None)
        tin = sum(int(getattr(u, k, 0) or 0) for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) if u else 0
        tout = int(getattr(u, "output_tokens", 0) or 0) if u else 0
        with self.lock:
            self.r_tokens -= up_t
            self.r_usd -= up_usd
            self.tokens += tin + tout
            self.usd += (tin * self.prices[0] + tout * self.prices[1]) / 1e6
            if not self.reached and ((mt is not None and self.tokens >= mt) or (mu is not None and self.usd >= mu)):
                self.reached = (f"the real total reached a cap (tokens {self.tokens} of {mt}, usd {self.usd:.4f} of "
                                f"{mu}); no further call is sent")
        self._write("replies.jsonl", {
            "n": n, "secs": round(time.time() - t0, 3), "headers": headers,
            "reply_text": "".join(getattr(b, "text", "") or "" for b in (getattr(resp, "content", None) or [])) if resp else None,
            "stop_reason": getattr(resp, "stop_reason", None), "usage": {"input": tin, "output": tout},
            "error": f"{type(err).__name__}: {err}" if err else None, "status": getattr(err, "status_code", None)})
        if err:
            raise err
        return resp

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The safe call runner for historical matching (DEV2-B1, owner BUILD REQUIREMENTS + R-H2AJ G9; DEV2-B3 size guard).

Runs a list of model requests with at most `calls_at_once` in flight (threads) and applies the owner's rule
EXACTLY:

* A LONE CONNECTION ERROR (an exception with no HTTP status) is retried ONCE, after `retry_wait_s`, but only if
  other calls are landing: another request's reply landed after this attempt was sent. With nothing else
  landing, the error is not lone and the run STOPS.
* STOP at once on any 429 or usage-limit error, on a second failure of the same call, or when `burst_failures`
  failures (every failed attempt counts) fall within `burst_window_s` seconds.
* Any other HTTP error fails that one call (counted toward the burst) and the run goes on.
* STOP means: nothing more is sent; calls already in flight finish and are recorded; every request never sent
  is named in `not_sent`.

THE SIZE GUARD (DEV2-B3; chat-Claude's DEV2-B1 review: the judge model bills a request over 100k input tokens at a
higher rate on everything). Before a request is sent its input is estimated as request chars / 2 tokens (B1's
reservation rule); a request whose estimate passes `Limits.max_request_tokens` (the setting
match_max_request_tokens) is NOT sent: it is named in `refused` with reason "too_large", and the run goes on. A
request AT the limit is sent.

A CALLER'S REFUSAL (DEV2-B4; owner answer 3 to DEV2-B3 Q3: "a budget-guard refusal must skip that call and carry on,
never stop the run"). A client wrapper that will not send one call (a test budget, h2_bench's RecordingClient) raises
`CallerRefused` from `messages.create`. That call is named in `refused` with reason "caller_refused" and the wrapper's
words, counts as no failure (no burst, no retry, no stop) and the run goes on. It is never read as a connection
error: without this, a status-less exception with nothing else landing stopped the whole run (DEV2-B3 T4 run 1).

NO COST CAP (owner 2026-11-02 23:23, amending R-H2AD: "that $5 limit was just for our purpose...a guideline...it
should not be a part of the code or setting"). The runner never reserves, refuses or stops on cost; every attempt's
tokens, USD and seconds are still recorded, with the run's totals.

The client is the Anthropic client built from the AI settings' key exactly as the existing callers read it
(get_boq_ai_api_key: presence only, never logged), with max_retries=0 so the SDK's own hidden retries are off and
every attempt is one the runner counted. The model, max_tokens and prices come per request from the settings
(ai_settings.require_match_settings); nothing here names a model.

Every attempt is recorded: request name, attempt number, model, seconds, tokens in (input + cache read + cache
creation) and out, USD, stop_reason, and the error with its HTTP status.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

# Usage-limit wording, as extraction._TERMINAL_MARKERS names it (its usage subset). A 429 needs no marker.
USAGE_LIMIT_MARKERS = ("USAGE LIMIT", "USAGE_LIMIT", "QUOTA", "CREDIT BALANCE", "BILLING")

STOP_RATE_LIMIT = "rate_limit_429"
STOP_USAGE_LIMIT = "usage_limit"
STOP_SECOND_FAILURE = "second_failure_of_a_call"
STOP_BURST = "burst_of_failures"
STOP_NOT_LONE = "connection_error_with_nothing_landing"
REFUSED_TOO_LARGE = "too_large"
REFUSED_BY_CALLER = "caller_refused"


class CallerRefused(Exception):
    """Raised by a client wrapper to refuse ONE call before it is sent (a caller's test budget). The runner names the
    call in `refused` (reason caller_refused, with this exception's text) and carries on; it is never a failure."""


@dataclass
class CallRequest:
    """One model call. `name` is the caller's id (a batch id); `content` the single user message."""
    name: str
    content: str
    model: str
    max_tokens: int
    price_in: float      # USD per million input tokens
    price_out: float     # USD per million output tokens
    timeout: float | None = None


@dataclass
class Limits:
    calls_at_once: int
    retry_wait_s: float
    burst_failures: int
    burst_window_s: float
    max_request_tokens: int     # the size guard: the setting match_max_request_tokens (no code default)

    @classmethod
    def from_settings(cls, s: dict) -> "Limits":
        return cls(calls_at_once=int(s["calls_at_once"]), retry_wait_s=float(s["retry_wait_s"]),
                   burst_failures=int(s["burst_failures"]), burst_window_s=float(s["burst_window_s"]),
                   max_request_tokens=int(s["max_request_tokens"]))


@dataclass
class CallResult:
    name: str
    ok: bool = False
    text: str | None = None
    stop_reason: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    attempts: int = 0
    error: str | None = None
    status: int | None = None


@dataclass
class RunResult:
    results: dict = field(default_factory=dict)      # name -> CallResult, for every request that was sent
    not_sent: list = field(default_factory=list)     # names never sent because the run stopped, in request order
    refused: list = field(default_factory=list)      # never sent, the run went on: {name, reason too_large, estimate_tokens, limit} or {name, reason caller_refused, detail}
    stop_reason: str | None = None
    stop_detail: str | None = None
    attempts: list = field(default_factory=list)     # one dict per attempt, in finishing order
    spent_usd: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    max_in_flight: int = 0


def estimate_tokens(req: CallRequest) -> int:
    """The request's input estimate before it is sent: chars / 2 tokens (B1's reservation rule)."""
    return int(len(req.content) / 2.0)


def cost_usd(tokens_in: int, tokens_out: int, req: CallRequest) -> float:
    return (tokens_in * req.price_in + tokens_out * req.price_out) / 1e6


def _status_of(exc: BaseException):
    return getattr(exc, "status_code", None)


def _is_usage_limit(exc: BaseException) -> bool:
    blob = f"{type(exc).__name__} {exc}".upper()
    return any(m in blob for m in USAGE_LIMIT_MARKERS)


def _usage(resp) -> tuple[int, int]:
    u = getattr(resp, "usage", None)
    if u is None:
        return 0, 0
    tin = sum(int(getattr(u, k, 0) or 0)
              for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return tin, int(getattr(u, "output_tokens", 0) or 0)


def make_client():
    """The Anthropic client with the SDK's own retries OFF. The key is read the way the existing callers read it
    (ai_settings.get_boq_ai_api_key, presence only); refuses when the AI settings are off or no key is set."""
    from nirmaan_stack.api.boq.wizard.ai_settings import get_boq_ai_api_key, get_boq_ai_settings

    if not get_boq_ai_settings().get("enabled"):
        raise RuntimeError("The BoQ AI settings are switched off, so no matching call is made.")
    api_key = get_boq_ai_api_key()
    if not api_key:
        raise RuntimeError("No Anthropic API key is set in BOQ Upload Review AI Settings.")
    import anthropic

    return anthropic.Anthropic(api_key=api_key, max_retries=0)


class _Run:
    def __init__(self, requests, limits, client, sleep, clock):
        self.requests = list(requests)
        self.limits = limits
        self.client = client
        self.sleep = sleep
        self.clock = clock
        self.cv = threading.Condition()
        self.in_flight = 0          # requests holding a slot (sending, or waiting to retry)
        self.http_in_flight = 0     # attempts on the wire
        self.failures = []          # clock() of every failed attempt
        self.landed_seq = 0         # bumped on every successful reply
        self.out = RunResult()

    # --- shared state, always under self.cv -------------------------------------------------------------------

    def _stop(self, reason, detail):
        if self.out.stop_reason is None:
            self.out.stop_reason = reason
            self.out.stop_detail = detail
        self.cv.notify_all()

    # --- one request, on its own thread ------------------------------------------------------------------------

    def _send(self, req: CallRequest):
        res = CallResult(name=req.name)
        retried = False
        try:
            while True:
                with self.cv:
                    if res.attempts and self.out.stop_reason is not None:
                        res.error = res.error or "not retried: the run stopped"
                        return
                    self.http_in_flight += 1
                    seq_at_send = self.landed_seq
                res.attempts += 1
                t0 = self.clock()
                err = resp = None
                try:
                    kw = dict(model=req.model, max_tokens=req.max_tokens,
                              messages=[{"role": "user", "content": req.content}])
                    if req.timeout:
                        kw["timeout"] = req.timeout
                    resp = self.client.messages.create(**kw)
                except Exception as e:  # noqa: BLE001 -- every failure is classified below
                    err = e
                secs = self.clock() - t0
                with self.cv:
                    self.http_in_flight -= 1
                    rec = {"name": req.name, "attempt": res.attempts, "model": req.model, "seconds": round(secs, 3)}
                    if isinstance(err, CallerRefused):
                        # the caller would not send it: named, skipped, never a failure; the run goes on
                        res.error = f"refused by the caller: {err}"
                        self.out.refused.append({"name": req.name, "reason": REFUSED_BY_CALLER, "detail": str(err)})
                        rec.update(tokens_in=0, tokens_out=0, cost_usd=0.0, decision="refused by the caller",
                                   error=res.error)
                        self.out.attempts.append(rec)
                        self.cv.notify_all()
                        return
                    if err is None:
                        tin, tout = _usage(resp)
                        usd = cost_usd(tin, tout, req)
                        self.out.spent_usd += usd
                        self.out.tokens_in += tin
                        self.out.tokens_out += tout
                        self.landed_seq += 1
                        res.ok = True
                        res.text = "".join(getattr(b, "text", "") or "" for b in (getattr(resp, "content", None) or []))
                        res.stop_reason = getattr(resp, "stop_reason", None)
                        res.tokens_in += tin
                        res.tokens_out += tout
                        res.cost_usd += usd
                        res.seconds += secs
                        res.error = None
                        rec.update(tokens_in=tin, tokens_out=tout, cost_usd=usd, stop_reason=res.stop_reason)
                        self.out.attempts.append(rec)
                        self.cv.notify_all()
                        return
                    status = _status_of(err)
                    now = self.clock()
                    self.failures.append(now)
                    recent = [x for x in self.failures if now - x <= self.limits.burst_window_s]
                    res.seconds += secs
                    res.status = status
                    res.error = f"{type(err).__name__}: {str(err)[:300]}"
                    rec.update(tokens_in=0, tokens_out=0, cost_usd=0.0, error=res.error, status=status,
                               failures_in_window=len(recent))
                    decision = "failed"
                    if status == 429:
                        self._stop(STOP_RATE_LIMIT, f"{req.name}: {res.error}")
                        decision = "STOP"
                    elif _is_usage_limit(err):
                        self._stop(STOP_USAGE_LIMIT, f"{req.name}: {res.error}")
                        decision = "STOP"
                    elif retried:
                        self._stop(STOP_SECOND_FAILURE, f"{req.name}: {res.error}")
                        decision = "STOP"
                    elif len(recent) >= self.limits.burst_failures:
                        self._stop(STOP_BURST, f"{len(recent)} failures within {self.limits.burst_window_s} s; "
                                               f"last {req.name}: {res.error}")
                        decision = "STOP"
                    elif status is None:
                        if self.landed_seq > seq_at_send and self.out.stop_reason is None:
                            decision = "retry once"
                        else:
                            self._stop(STOP_NOT_LONE, f"{req.name}: a connection error and no other reply landed "
                                                      f"while it was in flight: {res.error}")
                            decision = "STOP"
                    rec["decision"] = decision
                    self.out.attempts.append(rec)
                    self.cv.notify_all()
                    if decision != "retry once":
                        return
                retried = True
                self.sleep(self.limits.retry_wait_s)
        finally:
            with self.cv:
                self.out.results[req.name] = res
                self.in_flight -= 1
                self.cv.notify_all()

    # --- the dispatcher ----------------------------------------------------------------------------------------

    def go(self) -> RunResult:
        threads = []
        for i, req in enumerate(self.requests):
            est = estimate_tokens(req)
            if est > self.limits.max_request_tokens:
                # the size guard: never sent, named with its reason, and the run goes on
                with self.cv:
                    self.out.refused.append({"name": req.name, "reason": REFUSED_TOO_LARGE, "estimate_tokens": est,
                                             "limit": self.limits.max_request_tokens})
                continue
            with self.cv:
                while self.in_flight >= self.limits.calls_at_once and self.out.stop_reason is None:
                    self.cv.wait()
                if self.out.stop_reason is not None:
                    self.out.not_sent = [r.name for r in self.requests[i:]]
                    break
                self.in_flight += 1
                self.out.max_in_flight = max(self.out.max_in_flight, self.in_flight)
            t = threading.Thread(target=self._send, args=(req,), daemon=True)
            threads.append(t)
            t.start()
        for t in threads:
            t.join()
        self.out.spent_usd = round(self.out.spent_usd, 10)
        return self.out


def run(requests, *, limits: Limits, client=None,
        sleep: Callable[[float], Any] = time.sleep, clock: Callable[[], float] = time.monotonic) -> RunResult:
    """Run `requests` (CallRequest) under `limits`. Returns a RunResult with every sent request's CallResult, the
    requests the size guard refused (`refused`; the run went on), the names never sent because the run stopped
    (`not_sent`), the stop reason (None when all ran), every attempt and the spend (tokens, USD). `client` defaults to
    make_client(); `sleep` and `clock` are seams for tests. Nothing here refuses on cost."""
    if limits.calls_at_once < 1:
        raise ValueError("calls_at_once must be 1 or more")
    if client is None:
        client = make_client()
    return _Run(requests, limits, client, sleep, clock).go()

# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The safe call runner for historical matching (DEV2-B1, owner BUILD REQUIREMENTS + R-H2AJ G9).

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

COST CAP, RESERVED BEFORE EACH SEND (R-H2AD; the DEV2-S7 lesson that a cap checked after the reply is passed by the
calls in flight). Before every attempt the runner reserves that attempt's upper bound -- request chars / 2 input
tokens + max_tokens output tokens, at the request's prices -- against the cap the caller passes. An attempt whose
reservation would pass the cap waits while other reservations are outstanding (their replies usually cost less than
their reservation); when none is outstanding and it still does not fit, it is not sent and the run stops with
"cost_cap". A reply releases its reservation and adds its real cost.

The client is the Anthropic client built from the AI settings' key exactly as the existing callers read it
(get_boq_ai_api_key: presence only, never logged), with max_retries=0 so the SDK's own hidden retries are off and
every attempt is one the runner counted. The model, max_tokens and prices come per request from the settings
(ai_settings.require_match_settings); nothing here names a model.

Every attempt is recorded: request name, attempt number, model, seconds, tokens in (input + cache read + cache
creation) and out, USD, stop_reason, and the error with its HTTP status. No caller is wired in DEV2-B1.
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
STOP_COST_CAP = "cost_cap"


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

    @classmethod
    def from_settings(cls, s: dict) -> "Limits":
        return cls(calls_at_once=int(s["calls_at_once"]), retry_wait_s=float(s["retry_wait_s"]),
                   burst_failures=int(s["burst_failures"]), burst_window_s=float(s["burst_window_s"]))


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
    not_sent: list = field(default_factory=list)     # names never sent, in request order
    stop_reason: str | None = None
    stop_detail: str | None = None
    attempts: list = field(default_factory=list)     # one dict per attempt, in finishing order
    spent_usd: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    max_in_flight: int = 0


def reservation_usd(req: CallRequest) -> float:
    """The upper bound of one attempt: request chars / 2 input tokens + max_tokens output tokens, at its prices."""
    return (int(len(req.content) / 2.0) * req.price_in + req.max_tokens * req.price_out) / 1e6


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
    def __init__(self, requests, cap_usd, limits, client, sleep, clock):
        self.requests = list(requests)
        self.cap = float(cap_usd)
        self.limits = limits
        self.client = client
        self.sleep = sleep
        self.clock = clock
        self.cv = threading.Condition()
        self.in_flight = 0          # requests holding a slot (sending, or waiting to retry)
        self.http_in_flight = 0     # attempts on the wire
        self.reserved = 0.0
        self.failures = []          # clock() of every failed attempt
        self.landed_seq = 0         # bumped on every successful reply
        self.out = RunResult()

    # --- shared state, always under self.cv -------------------------------------------------------------------

    def _stop(self, reason, detail):
        if self.out.stop_reason is None:
            self.out.stop_reason = reason
            self.out.stop_detail = detail
        self.cv.notify_all()

    def _try_reserve(self, amount) -> bool:
        if self.out.spent_usd + self.reserved + amount > self.cap + 1e-12:
            return False
        self.reserved += amount
        return True

    def _reserve_or_stop(self, amount, name) -> bool:
        """Wait while the reservation does not fit and other reservations are outstanding (each belongs to an attempt
        already dispatched, which will land and release it); False (and STOP) when it still does not fit with no
        reservation outstanding, or when the run stopped meanwhile. A thread waiting here holds no reservation of its
        own, so two waiters can never wait on each other."""
        while True:
            if self.out.stop_reason is not None:
                return False
            if self._try_reserve(amount):
                return True
            if self.reserved <= 1e-12:
                self._stop(STOP_COST_CAP,
                           f"{name}: spent {self.out.spent_usd:.6f} + reserved {self.reserved:.6f} + this call "
                           f"{amount:.6f} would pass the cap {self.cap:.6f} USD")
                return False
            self.cv.wait()

    # --- one request, on its own thread ------------------------------------------------------------------------

    def _send(self, req: CallRequest):
        res = CallResult(name=req.name)
        retried = False
        try:
            while True:
                amount = reservation_usd(req)
                with self.cv:
                    if res.attempts and not self._reserve_or_stop(amount, req.name):
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
                    self.reserved -= amount
                    rec = {"name": req.name, "attempt": res.attempts, "model": req.model, "seconds": round(secs, 3)}
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
            with self.cv:
                while self.in_flight >= self.limits.calls_at_once and self.out.stop_reason is None:
                    self.cv.wait()
                if self.out.stop_reason is not None or not self._reserve_or_stop(reservation_usd(req), req.name):
                    self.out.not_sent = [r.name for r in self.requests[i:]]
                    break
                # the first attempt's reservation is held by the dispatcher; hand it to the thread
                self.in_flight += 1
                self.out.max_in_flight = max(self.out.max_in_flight, self.in_flight)
            # The dispatcher holds the first attempt's reservation; _send releases it when that attempt ends and
            # reserves again only for a retry.
            t = threading.Thread(target=self._send, args=(req,), daemon=True)
            threads.append(t)
            t.start()
        for t in threads:
            t.join()
        self.out.spent_usd = round(self.out.spent_usd, 10)
        return self.out


def run(requests, *, cap_usd: float, limits: Limits, client=None,
        sleep: Callable[[float], Any] = time.sleep, clock: Callable[[], float] = time.monotonic) -> RunResult:
    """Run `requests` (CallRequest) under `limits` and the cost cap `cap_usd` (USD). Returns a RunResult with
    every sent request's CallResult, the names never sent, the stop reason (None when all ran) and every attempt.
    `client` defaults to make_client(); `sleep` and `clock` are seams for tests."""
    if limits.calls_at_once < 1:
        raise ValueError("calls_at_once must be 1 or more")
    if client is None:
        client = make_client()
    return _Run(requests, cap_usd, limits, client, sleep, clock).go()

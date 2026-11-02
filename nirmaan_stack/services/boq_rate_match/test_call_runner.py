# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the safe call runner (DEV2-B1, T1). A mock client only: no model call, no database write.

Each rule of the owner's retry / stop rule has a positive and a negative test:
  retry-once        a lone connection error is retried once after the wait  /  nothing landing -> STOP, no retry
  second failure    the retried call failing again stops the run            /  a retry that succeeds does not
  429               stops at once, unsent named                              /  a 500 fails one call, run goes on
  burst             N failures within the window stop                        /  the same N spread wider do not
  calls at once     never more in flight than the setting                    /  and the setting is actually reached
  cap               the call that would pass the cap is refused, named       /  a cap that fits sends everything
  usage and $       tokens (cache included), USD and seconds per call
"""
import threading
import time
from types import SimpleNamespace
from unittest.mock import patch

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import call_runner as cr


class ConnErr(Exception):
    """An exception with no HTTP status: what the SDK raises for a dropped connection."""


class HttpErr(Exception):
    def __init__(self, status, msg="http error"):
        super().__init__(msg)
        self.status_code = status


def _resp(text="[]", tin=10, tout=5, stop="end_turn", cache_read=0, cache_create=0):
    return SimpleNamespace(
        content=[SimpleNamespace(text=text)], stop_reason=stop,
        usage=SimpleNamespace(input_tokens=tin, output_tokens=tout,
                              cache_read_input_tokens=cache_read, cache_creation_input_tokens=cache_create))


class FakeClient:
    """messages.create(**kw) -> script[name] pops the next outcome for that request (an exception is raised, a
    response is returned, a callable is called with kw). Records every call and the concurrency it saw."""

    def __init__(self, script=None, default=None, delay=0.0):
        self.script = {k: list(v) for k, v in (script or {}).items()}
        self.default = default
        self.delay = delay
        self.calls = []
        self.lock = threading.Lock()
        self.now = 0
        self.max_now = 0
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        name = kw["messages"][0]["content"].split("|", 1)[0]
        with self.lock:
            self.calls.append((name, kw))
            self.now += 1
            self.max_now = max(self.max_now, self.now)
        try:
            if self.delay:
                time.sleep(self.delay)
            seq = self.script.get(name)
            out = seq.pop(0) if seq else (self.default if self.default is not None else _resp())
            if callable(out) and not isinstance(out, SimpleNamespace):
                out = out(kw)
            if isinstance(out, BaseException):
                raise out
            return out
        finally:
            with self.lock:
                self.now -= 1


def _req(name, chars=200, max_tokens=100, price_in=1.0, price_out=2.0, model="m-test"):
    content = (name + "|").ljust(chars, "x")
    return cr.CallRequest(name=name, content=content, model=model, max_tokens=max_tokens,
                          price_in=price_in, price_out=price_out)


def _limits(calls=4, wait=5, burst=10, window=60):
    return cr.Limits(calls_at_once=calls, retry_wait_s=wait, burst_failures=burst, burst_window_s=window)


class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.lock = threading.Lock()

    def __call__(self):
        with self.lock:
            return self.t

    def advance(self, s):
        with self.lock:
            self.t += s


class TestRetryOnce(FrappeTestCase):

    def test_a_lone_connection_error_is_retried_once_after_the_wait(self):
        # A is sent, B lands while A is in flight, then A's connection drops: A is retried once, after the wait.
        landed = threading.Event()

        def b_reply(kw):
            landed.set()
            return _resp()

        def a_fails_after_b(kw):
            landed.wait(5)
            time.sleep(0.3)  # let the runner record B's landing before A's error arrives
            return ConnErr("connection reset")

        client = FakeClient({"A": [a_fails_after_b, _resp()], "B": [b_reply]})
        sleeps = []
        out = cr.run([_req("A"), _req("B")], cap_usd=100, limits=_limits(calls=2, wait=7), client=client,
                     sleep=sleeps.append)
        self.assertIsNone(out.stop_reason, out.stop_detail)
        self.assertTrue(out.results["A"].ok)
        self.assertEqual(out.results["A"].attempts, 2)
        self.assertEqual(sleeps, [7])
        self.assertEqual([c[0] for c in client.calls].count("A"), 2)
        self.assertEqual(out.not_sent, [])

    def test_a_connection_error_with_nothing_landing_stops_without_a_retry(self):
        client = FakeClient({"A": [ConnErr("connection reset"), _resp()]})
        sleeps = []
        out = cr.run([_req("A"), _req("B")], cap_usd=100, limits=_limits(calls=1), client=client, sleep=sleeps.append)
        self.assertEqual(out.stop_reason, cr.STOP_NOT_LONE)
        self.assertEqual(out.results["A"].attempts, 1)
        self.assertFalse(out.results["A"].ok)
        self.assertEqual(sleeps, [])
        self.assertEqual(out.not_sent, ["B"])


class TestSecondFailure(FrappeTestCase):

    def test_the_same_call_failing_twice_stops_the_run(self):
        landed = threading.Event()

        def b_reply(kw):
            landed.set()
            return _resp()

        def a_fails(kw):
            landed.wait(5)
            time.sleep(0.3)  # let the runner record B's landing before A's error arrives
            return ConnErr("connection reset")

        def slow(kw):
            time.sleep(1.0)
            return _resp()

        client = FakeClient({"A": [a_fails, ConnErr("reset again")], "B": [b_reply], "C": [slow], "D": [slow],
                             "E": [slow]})
        out = cr.run([_req("A"), _req("B"), _req("C"), _req("D"), _req("E")], cap_usd=100,
                     limits=_limits(calls=2), client=client, sleep=lambda s: None)
        self.assertEqual(out.stop_reason, cr.STOP_SECOND_FAILURE)
        self.assertEqual(out.results["A"].attempts, 2)
        self.assertFalse(out.results["A"].ok)
        # C was in flight when A failed twice (it finishes and is recorded); D and E were never sent
        self.assertTrue(out.results["C"].ok)
        self.assertEqual(out.not_sent, ["D", "E"])
        self.assertNotIn("D", [c[0] for c in client.calls])

    def test_a_retry_that_succeeds_does_not_stop(self):
        landed = threading.Event()

        def b_reply(kw):
            landed.set()
            return _resp()

        def a_fails(kw):
            landed.wait(5)
            time.sleep(0.3)  # let the runner record B's landing before A's error arrives
            return ConnErr("connection reset")

        client = FakeClient({"A": [a_fails, _resp()], "B": [b_reply]})
        out = cr.run([_req("A"), _req("B"), _req("C")], cap_usd=100, limits=_limits(calls=2), client=client,
                     sleep=lambda s: None)
        self.assertIsNone(out.stop_reason)
        self.assertEqual(sorted(out.results), ["A", "B", "C"])


class TestRateAndUsageLimit(FrappeTestCase):

    def test_a_429_stops_at_once_and_names_the_unsent(self):
        client = FakeClient({"A": [HttpErr(429, "rate_limit_error")]})
        sleeps = []
        out = cr.run([_req("A"), _req("B"), _req("C")], cap_usd=100, limits=_limits(calls=1), client=client,
                     sleep=sleeps.append)
        self.assertEqual(out.stop_reason, cr.STOP_RATE_LIMIT)
        self.assertEqual(out.results["A"].attempts, 1)
        self.assertEqual(out.not_sent, ["B", "C"])
        self.assertEqual(sleeps, [])

    def test_a_usage_limit_message_stops_at_once(self):
        client = FakeClient({"A": [HttpErr(400, "Your credit balance is too low")]})
        out = cr.run([_req("A"), _req("B")], cap_usd=100, limits=_limits(calls=1), client=client, sleep=lambda s: None)
        self.assertEqual(out.stop_reason, cr.STOP_USAGE_LIMIT)
        self.assertEqual(out.not_sent, ["B"])

    def test_another_http_error_fails_that_call_and_the_run_goes_on(self):
        client = FakeClient({"A": [HttpErr(500, "overloaded")]})
        out = cr.run([_req("A"), _req("B"), _req("C")], cap_usd=100, limits=_limits(calls=1), client=client,
                     sleep=lambda s: None)
        self.assertIsNone(out.stop_reason)
        self.assertFalse(out.results["A"].ok)
        self.assertEqual(out.results["A"].status, 500)
        self.assertEqual(out.results["A"].attempts, 1)
        self.assertTrue(out.results["B"].ok and out.results["C"].ok)


class TestBurst(FrappeTestCase):

    def test_burst_failures_within_the_window_stop_the_run(self):
        clock = FakeClock()
        client = FakeClient(default=HttpErr(500, "server error"))
        out = cr.run([_req(f"R{i}") for i in range(6)], cap_usd=100, limits=_limits(calls=1, burst=3, window=60),
                     client=client, sleep=lambda s: None, clock=clock)
        self.assertEqual(out.stop_reason, cr.STOP_BURST)
        self.assertEqual(len(client.calls), 3)
        self.assertEqual(out.not_sent, ["R3", "R4", "R5"])

    def test_the_same_failures_spread_wider_than_the_window_do_not_stop(self):
        clock = FakeClock()

        def fail_then_tick(kw):
            clock.advance(31)
            return HttpErr(500, "server error")

        client = FakeClient(default=fail_then_tick)
        out = cr.run([_req(f"R{i}") for i in range(6)], cap_usd=100, limits=_limits(calls=1, burst=3, window=60),
                     client=client, sleep=lambda s: None, clock=clock)
        # failures at +31, +62, +93 ... s: never 3 within 60 s
        self.assertIsNone(out.stop_reason, out.stop_detail)
        self.assertEqual(len(client.calls), 6)


class TestCallsAtOnce(FrappeTestCase):

    def test_calls_at_once_is_never_exceeded_and_is_reached(self):
        client = FakeClient(delay=0.05)
        out = cr.run([_req(f"R{i:02d}") for i in range(12)], cap_usd=100, limits=_limits(calls=3), client=client)
        self.assertIsNone(out.stop_reason)
        self.assertEqual(len(out.results), 12)
        self.assertLessEqual(client.max_now, 3)
        self.assertLessEqual(out.max_in_flight, 3)
        self.assertEqual(client.max_now, 3, "the runner never ran 3 at once: the limit was not exercised")

    def test_one_at_a_time_when_the_setting_is_one(self):
        client = FakeClient(delay=0.02)
        cr.run([_req(f"R{i}") for i in range(5)], cap_usd=100, limits=_limits(calls=1), client=client)
        self.assertEqual(client.max_now, 1)


class TestCostCap(FrappeTestCase):
    # chars 2000 -> 1000 input tokens reserved; max_tokens 1000; 500 USD / million both ways -> 1.00 USD reserved per
    # call. The fake reply costs exactly its reservation, so the cap arithmetic is exact.

    def _reqs(self, n):
        return [_req(f"R{i}", chars=2000, max_tokens=1000, price_in=500, price_out=500) for i in range(n)]

    def test_the_call_that_would_pass_the_cap_is_refused_and_the_unsent_named(self):
        client = FakeClient(default=_resp(tin=1000, tout=1000))
        out = cr.run(self._reqs(4), cap_usd=2.5, limits=_limits(calls=1), client=client)
        self.assertEqual(out.stop_reason, cr.STOP_COST_CAP)
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(out.not_sent, ["R2", "R3"])
        self.assertAlmostEqual(out.spent_usd, 2.0)

    def test_calls_in_flight_count_against_the_cap_before_they_land(self):
        client = FakeClient(default=_resp(tin=1000, tout=1000), delay=0.05)
        out = cr.run(self._reqs(4), cap_usd=2.5, limits=_limits(calls=4), client=client)
        self.assertEqual(out.stop_reason, cr.STOP_COST_CAP)
        self.assertEqual(len(client.calls), 2, "a third call was sent while two reservations already filled the cap")
        self.assertLessEqual(out.spent_usd, 2.5)

    def test_a_cap_that_fits_sends_everything(self):
        client = FakeClient(default=_resp(tin=1000, tout=1000))
        out = cr.run(self._reqs(3), cap_usd=3.0, limits=_limits(calls=1), client=client)
        self.assertIsNone(out.stop_reason)
        self.assertEqual(len(client.calls), 3)
        self.assertEqual(out.not_sent, [])

    def test_the_reservation_is_chars_over_two_plus_max_tokens_at_the_prices(self):
        r = _req("R", chars=2001, max_tokens=300, price_in=3.0, price_out=15.0)
        self.assertAlmostEqual(cr.reservation_usd(r), (1000 * 3.0 + 300 * 15.0) / 1e6)


class TestUsageRecorded(FrappeTestCase):

    def test_tokens_cost_and_seconds_are_recorded_per_call(self):
        clock = FakeClock()

        def reply(kw):
            clock.advance(2.5)
            return _resp(tin=100, tout=40, cache_read=20, cache_create=5)

        client = FakeClient({"A": [reply]})
        out = cr.run([_req("A", price_in=1.0, price_out=5.0)], cap_usd=100, limits=_limits(calls=1),
                     client=client, clock=clock)
        r = out.results["A"]
        self.assertEqual((r.tokens_in, r.tokens_out), (125, 40))
        self.assertAlmostEqual(r.cost_usd, (125 * 1.0 + 40 * 5.0) / 1e6)
        self.assertAlmostEqual(r.seconds, 2.5)
        self.assertEqual(len(out.attempts), 1)
        self.assertEqual(out.attempts[0]["tokens_in"], 125)
        self.assertAlmostEqual(out.spent_usd, r.cost_usd)
        self.assertEqual((out.tokens_in, out.tokens_out), (125, 40))

    def test_model_and_max_tokens_come_from_each_request(self):
        client = FakeClient()
        cr.run([_req("A", model="model-a", max_tokens=111), _req("B", model="model-b", max_tokens=222)],
               cap_usd=100, limits=_limits(calls=1), client=client)
        sent = {name: (kw["model"], kw["max_tokens"]) for name, kw in client.calls}
        self.assertEqual(sent, {"A": ("model-a", 111), "B": ("model-b", 222)})


class TestClient(FrappeTestCase):

    def test_the_client_is_built_with_the_sdk_retries_off(self):
        built = {}

        class FakeAnthropic:
            def __init__(self, **kw):
                built.update(kw)

        with patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings", return_value={"enabled": True}), \
             patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_api_key", return_value="not-a-real-key"), \
             patch("anthropic.Anthropic", FakeAnthropic):
            cr.make_client()
        self.assertEqual(built.get("max_retries"), 0)
        self.assertEqual("set" if built.get("api_key") else "unset", "set")

    def test_no_key_refuses(self):
        with patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings", return_value={"enabled": True}), \
             patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_api_key", return_value=None):
            with self.assertRaises(RuntimeError):
                cr.make_client()

    def test_ai_settings_off_refuses(self):
        with patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings", return_value={"enabled": False}):
            with self.assertRaises(RuntimeError):
                cr.make_client()

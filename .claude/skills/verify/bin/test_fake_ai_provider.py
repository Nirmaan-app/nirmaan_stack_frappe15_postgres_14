"""The fake AI provider of the N-worker check's match flow (#1718): `python3 -m unittest test_fake_ai_provider` from
this folder (standard library only)."""

import http.client
import json
import threading
import unittest

from fake_ai_provider import serve


def post(port, content):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    body = json.dumps({"model": "m", "max_tokens": 10, "messages": [{"role": "user", "content": content}]})
    conn.request("POST", "/v1/messages", body, {"content-type": "application/json"})
    resp = conn.getresponse()
    return resp.status, json.loads(resp.read())


def stats(port):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", "/stats")
    return json.loads(conn.getresponse().read())


class TestFakeAiProvider(unittest.TestCase):
    def start(self, limit, delay):
        server = serve(port=0, limit=limit, delay=delay)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def test_a_judge_request_gets_one_verdict_per_candidate_in_the_messages_shape(self):
        port = self.start(limit=1, delay=0)
        status, reply = post(port, "Judge the target and 3 candidate rows. TARGET: ...")
        self.assertEqual(status, 200)
        self.assertEqual((reply["type"], reply["role"], reply["stop_reason"]), ("message", "assistant", "end_turn"))
        verdicts = json.loads(reply["content"][0]["text"])
        self.assertEqual(sorted(v["c"] for v in verdicts["verdicts"]), [1, 2, 3])
        self.assertEqual(sorted(verdicts["order"]), [1, 2, 3])
        self.assertTrue(all(v["v"] == "DIFFERENT" for v in verdicts["verdicts"]))

    def test_a_call_above_the_limit_in_flight_gets_a_429_and_is_counted(self):
        port = self.start(limit=2, delay=0.5)
        statuses = []
        calls = [threading.Thread(target=lambda: statuses.append(post(port, "card")[0])) for _ in range(4)]
        for t in calls:
            t.start()
        for t in calls:
            t.join()
        self.assertEqual(sorted(statuses), [200, 200, 429, 429])
        self.assertEqual(stats(port), {"calls": 4, "answered": 2, "rate_limited": 2, "max_in_flight": 2, "limit": 2})

    def test_reset_clears_the_counts(self):
        port = self.start(limit=1, delay=0)
        post(port, "card")
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request("POST", "/reset", "")
        conn.getresponse().read()
        self.assertEqual(stats(port)["calls"], 0)


if __name__ == "__main__":
    unittest.main()

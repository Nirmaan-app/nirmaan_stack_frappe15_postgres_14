#!/usr/bin/env python3
"""A fake Anthropic Messages API for the N-worker check's match flow (#1718, spec #1654). It never calls a provider.

    python3 fake_ai_provider.py --port P --limit K [--delay S]

`walk_background_operations.py --fake-provider-limit K` runs it in the frappe container and starts the env's workers
with `ANTHROPIC_BASE_URL=http://127.0.0.1:P`, which every `anthropic.Anthropic()` the app builds reads, so each
model call of those workers reaches this server, never Anthropic. It answers like a provider that allows K calls in
flight: a call that would make K + 1 gets a 429 `rate_limit_error` at once; the others wait `--delay` seconds, then
get a Messages reply. A judge request (its prompt names "and <n> candidate rows") gets one DIFFERENT verdict per
candidate, which the judge parser reads; any other call (a spec card batch) gets `{}`, which the card parser
reports as malformed and the run goes on.

GET /stats -> {"calls", "answered", "rate_limited", "max_in_flight", "limit"}; POST /reset zeroes the counts.
Standard library only.
"""

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_CANDIDATES = re.compile(r"and (\d+) candidate rows")


def reply_text(content: str) -> str:
    found = _CANDIDATES.search(content)
    if not found:
        return "{}"
    n = int(found.group(1))
    return json.dumps({"verdicts": [{"c": c, "v": "DIFFERENT"} for c in range(1, n + 1)],
                       "order": list(range(1, n + 1))})


def _content(body: dict) -> str:
    parts = []
    for message in body.get("messages") or []:
        c = message.get("content")
        parts.append(c if isinstance(c, str) else json.dumps(c))
    return "\n".join(parts)


def serve(port: int, limit: int, delay: float) -> ThreadingHTTPServer:
    """The server, bound to 127.0.0.1:`port` (0 picks a free one), not yet serving."""
    lock = threading.Lock()
    counts = {}

    def reset():
        counts.update(calls=0, answered=0, rate_limited=0, max_in_flight=0, in_flight=0)

    reset()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def _send(self, status: int, payload: dict):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/stats":
                return self._send(404, {"error": "not found"})
            with lock:
                shown = {k: counts[k] for k in ("calls", "answered", "rate_limited", "max_in_flight")}
            self._send(200, {**shown, "limit": limit})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            if self.path == "/reset":
                with lock:
                    reset()
                return self._send(200, {})
            if not self.path.endswith("/v1/messages"):
                return self._send(404, {"error": "not found"})
            with lock:
                counts["calls"] += 1
                over = counts["in_flight"] >= limit
                if over:
                    counts["rate_limited"] += 1
                else:
                    counts["in_flight"] += 1
                    counts["max_in_flight"] = max(counts["max_in_flight"], counts["in_flight"])
            if over:
                return self._send(429, {"type": "error", "error": {
                    "type": "rate_limit_error", "message": f"fake provider: more than {limit} calls in flight"}})
            try:
                time.sleep(delay)
                text = reply_text(_content(body))
                self._send(200, {
                    "id": "msg_fake", "type": "message", "role": "assistant", "model": body.get("model") or "fake",
                    "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
                    "usage": {"input_tokens": len(_content(body)) // 4, "output_tokens": len(text) // 4},
                })
            finally:
                with lock:
                    counts["in_flight"] -= 1
                    counts["answered"] += 1

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--limit", type=int, required=True)
    ap.add_argument("--delay", type=float, default=0.5)
    a = ap.parse_args()
    server = serve(a.port, a.limit, a.delay)
    print(f"fake AI provider on 127.0.0.1:{a.port}, {a.limit} calls in flight at most", flush=True)
    server.serve_forever()

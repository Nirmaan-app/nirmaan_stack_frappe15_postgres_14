"""Record a PR walk as data: one entry per screen, with the click target and pinned notes, for build_page.py.

walk.json shape:
  pr       {number, title, url, author, head, base}
  envs     {after: <task>, before: <task>}
  data_note where the env's data came from, shown on the page
  changes  [{id, title, claim, status: seen|failed|not_walked, reason}]
  steps    [{id, change, side: after|before, role, user, caption, shot, size: [w, h],
             click: box|None, clicked: bool, pins: [{box, text, kind: must|should|nit|info, evidence: seen|guess}]}]
  checks   [{change, role, expect, seen, ok, kind: how bad a failure is}]
A box is {x, y, w, h} in screenshot pixels. clicked says the step clicked a control, so click None with clicked
true is a lost box, which build_page.py refuses.
"""

from __future__ import annotations

import datetime
import json
from pathlib import Path

from playwright.sync_api import Locator, Page

KINDS = ("must", "should", "nit", "info")


def inr(n: int) -> str:
    """Indian digit grouping: 11,58,24,752."""
    s = str(abs(n))
    head, tail = s[:-3], s[-3:]
    while len(head) > 2:
        tail = head[-2:] + "," + tail
        head = head[:-2]
    return ("-" if n < 0 else "") + (head + "," + tail if head else tail)


def box_of(target: Locator | dict) -> dict | None:
    if isinstance(target, dict):
        return target
    try:
        target.first.scroll_into_view_if_needed(timeout=5000)
        b = target.first.bounding_box()
    except Exception:
        return None
    return {"x": round(b["x"]), "y": round(b["y"]), "w": round(b["width"]), "h": round(b["height"])} if b else None


def pin(target: Locator | dict, text: str, kind: str = "nit", evidence: str = "seen") -> dict:
    assert kind in KINDS, kind
    return {"target": target, "text": text, "kind": kind, "evidence": evidence}


class Walk:
    def __init__(self, out: Path, pr: dict, envs: dict, data_note: str):
        self.out = out
        (out / "shots").mkdir(parents=True, exist_ok=True)
        self.data = {"pr": pr, "envs": envs, "data_note": data_note, "walked_at": None, "changes": [], "steps": [], "checks": []}

    def change(self, cid: str, title: str, claim: str) -> None:
        self.data["changes"].append({"id": cid, "title": title, "claim": claim, "status": "not_walked", "reason": ""})

    def _change(self, cid: str) -> dict:
        return next(c for c in self.data["changes"] if c["id"] == cid)

    def status(self, cid: str, status: str, reason: str = "") -> None:
        assert status in ("seen", "failed", "not_walked"), status
        self._change(cid).update(status=status, reason=reason)

    def step(self, page: Page, cid: str, side: str, role: str, user: str, caption: str,
             click: Locator | None = None, pins: list[dict] = (), settle_ms: int = 1200) -> dict:
        page.wait_for_timeout(settle_ms)
        sid = f"s{len(self.data['steps']) + 1:02d}"
        click_box = box_of(click) if click is not None else None
        if click is not None and click_box is None:
            raise RuntimeError(f"step {sid} ({caption!r}): the control to click was not found on screen in 5 s, so its "
                               "box is lost. Fix the locator or wait for the control before this step.")
        resolved = []
        for p in pins:
            b = box_of(p["target"])
            resolved.append({"box": b, "text": p["text"], "kind": p["kind"], "evidence": p["evidence"]})
        shot = f"shots/{sid}.jpg"
        page.screenshot(path=str(self.out / shot), type="jpeg", quality=68)
        vp = page.viewport_size
        step = {"id": sid, "change": cid, "side": side, "role": role, "user": user, "caption": caption,
                "shot": shot, "size": [vp["width"], vp["height"]], "click": click_box, "clicked": click is not None, "pins": resolved,
                "url": page.url}
        self.data["steps"].append(step)
        if click is not None:
            click.first.click()
            page.wait_for_load_state("networkidle")
        return step

    def check(self, cid: str, role: str, expect: str, seen: str, ok: bool, kind: str = "must") -> bool:
        assert kind in KINDS, kind
        self.data["checks"].append({"change": cid, "role": role, "expect": expect, "seen": seen, "ok": bool(ok),
                                    "kind": kind})
        return bool(ok)

    def save(self) -> Path:
        self.data["walked_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        path = self.out / "walk.json"
        path.write_text(json.dumps(self.data, indent=1))
        return path

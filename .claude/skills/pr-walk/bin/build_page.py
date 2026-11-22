"""Build one self-contained review page from a walk folder (walk.json + shots/).

    python3 -I build_page.py <walk dir> <out.html> [--terms terms.json]
"""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path

KIND_LABEL = {"must": "Must fix", "should": "Should fix", "nit": "Nit", "info": "Note"}
STATUS_LABEL = {"seen": "Seen", "failed": "Failed", "not_walked": "Not walked"}


def load(walk_dir: Path) -> tuple[dict, dict]:
    data = json.loads((walk_dir / "walk.json").read_text())
    shots = {s["id"]: "data:image/jpeg;base64," + base64.b64encode((walk_dir / s["shot"]).read_bytes()).decode()
             for s in data["steps"]}
    return data, shots


def bad_boxes(data: dict) -> list[str]:
    """Every click or pin box the page would draw wrong. A box needs numeric x, y and w, h above 0 (a box once saved
    as width/height drew as a dot and the page still built). A pin with box None is fine: the page says "spot not
    found". A click box None is fine only on a step that clicked nothing; with clicked true its box was lost."""
    def wrong(b: dict) -> str:
        if not isinstance(b, dict):
            return f"not a box: {b!r}"
        if any(not isinstance(b.get(k), (int, float)) for k in ("x", "y", "w", "h")):
            return f"needs numeric x, y, w, h, got keys {sorted(b)}"
        return "" if b["w"] > 0 and b["h"] > 0 else f"w={b['w']} h={b['h']}, both must be above 0"
    out = []
    for st in data["steps"]:
        if st.get("click") is None and st.get("clicked"):
            out.append(f"step {st['id']} ({st['caption']!r}): click box lost (clicked, but the control was not found)")
        if st.get("click") is not None and (why := wrong(st["click"])):
            out.append(f"step {st['id']} ({st['caption']!r}): click box {why}")
        for k, p in enumerate(st["pins"], 1):
            if p.get("box") is not None and (why := wrong(p["box"])):
                out.append(f"step {st['id']} ({st['caption']!r}): pin {k} box {why}")
    return out


def summary(data: dict) -> dict:
    pins = [p for s in data["steps"] for p in s["pins"]]
    by_kind = {k: sum(1 for p in pins if p["kind"] == k) for k in KIND_LABEL}
    status = {k: sum(1 for c in data["changes"] if c["status"] == k) for k in STATUS_LABEL}
    checks_ok = sum(1 for c in data["checks"] if c["ok"])
    return {"by_kind": by_kind, "status": status, "checks_ok": checks_ok, "checks": len(data["checks"]),
            "changes": len(data["changes"]), "screens": len(data["steps"])}


def verdict(data: dict, s: dict) -> str:
    n = s["changes"]
    if s["status"]["failed"] or s["by_kind"]["must"]:
        head = f"{s['status']['failed']} of {n} changes failed on screen"
    elif s["status"]["not_walked"]:
        head = f"{n - s['status']['not_walked']} of {n} changes work on screen; {s['status']['not_walked']} not walked"
    else:
        head = f"All {n} changes work on screen as the PR describes"
    tail = []
    if s["by_kind"]["must"]:
        tail.append(f"{s['by_kind']['must']} that must be fixed before merge")
    if s["by_kind"]["should"]:
        tail.append(f"{s['by_kind']['should']} that should be fixed")
    if s["by_kind"]["nit"]:
        tail.append(f"{s['by_kind']['nit']} small polish points")
    return head + (", with " + " and ".join(tail) if tail else ", with nothing to fix") + "."


def page(data: dict, shots: dict, terms: list[list[str]]) -> str:
    s = summary(data)
    pr = data["pr"]
    e = html.escape
    payload = json.dumps({k: data[k] for k in ("changes", "steps", "checks")}).replace("</", "<\\/")
    shots_js = json.dumps(shots).replace("</", "<\\/")
    problems = [(st, i, p) for st in data["steps"] for i, p in enumerate(st["pins"]) if p["kind"] != "info"]
    order = {"must": 0, "should": 1, "nit": 2}
    problems.sort(key=lambda t: order[t[2]["kind"]])
    change_title = {c["id"]: c["title"] for c in data["changes"]}
    prob_rows = "".join(
        f'<li><span class="chip k-{p["kind"]}">{KIND_LABEL[p["kind"]]}</span>'
        f'<div class="ptext"><p>{e(p["text"])}</p><p class="meta">{e(change_title[st["change"]])} · {e(st["role"])} · '
        f'{"seen on screen" if p["evidence"] == "seen" else "a guess"}</p></div>'
        f'<button class="go" data-step="{st["id"]}" data-pin="{i}">Show on screen</button></li>'
        for st, i, p in problems) or "<li><p>No problems were pinned.</p></li>"
    terms_html = "".join(f"<div><dt>{e(t)}</dt><dd>{e(d)}</dd></div>" for t, d in terms)
    v = verdict(data, s)
    first = next((st for st in data["steps"] if st["change"] == data["changes"][0]["id"] and st["side"] == "after"), data["steps"][0])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PR {pr['number']} Walk</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap">
<style>
/* Layout: answer and numbers, the problem list, then a screen viewer (change list left, screen right), then terms. */
:root{{--paper:oklch(0.975 0.008 85);--paper-2:oklch(0.945 0.012 85);--surface:#fff;--rule:oklch(0.85 0.012 85);
--ink:oklch(0.24 0.02 250);--ink-2:oklch(0.42 0.02 250);--ink-3:oklch(0.52 0.015 250);--accent:oklch(0.45 0.11 160);
--focus:oklch(0.85 0.06 160);--s1b:oklch(0.94 0.06 80);--s1f:oklch(0.42 0.1 65);--s3b:oklch(0.93 0.04 245);
--s3f:oklch(0.42 0.12 250);--s4b:oklch(0.93 0.045 195);--s4f:oklch(0.4 0.08 200);--okb:oklch(0.92 0.06 150);
--okf:oklch(0.38 0.11 150);--nob:oklch(0.93 0.045 25);--nof:oklch(0.45 0.16 25);--clk:oklch(0.55 0.2 25);
--serif:"Source Serif 4",Georgia,serif;--sans:"IBM Plex Sans",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,monospace;color-scheme:light}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--paper:oklch(0.19 0.008 85);--paper-2:oklch(0.235 0.01 85);
--surface:oklch(0.225 0.008 85);--rule:oklch(0.36 0.012 85);--ink:oklch(0.93 0.01 85);--ink-2:oklch(0.80 0.012 85);
--ink-3:oklch(0.70 0.012 85);--accent:oklch(0.76 0.11 160);--focus:oklch(0.50 0.08 160);--s1b:oklch(0.32 0.06 80);
--s1f:oklch(0.86 0.10 75);--s3b:oklch(0.32 0.06 250);--s3f:oklch(0.85 0.08 250);--s4b:oklch(0.32 0.05 200);
--s4f:oklch(0.85 0.07 200);--okb:oklch(0.32 0.06 150);--okf:oklch(0.85 0.10 150);--nob:oklch(0.32 0.07 25);
--nof:oklch(0.85 0.09 25);--clk:oklch(0.7 0.18 25);color-scheme:dark}}}}
:root[data-theme="dark"]{{--paper:oklch(0.19 0.008 85);--paper-2:oklch(0.235 0.01 85);--surface:oklch(0.225 0.008 85);
--rule:oklch(0.36 0.012 85);--ink:oklch(0.93 0.01 85);--ink-2:oklch(0.80 0.012 85);--ink-3:oklch(0.70 0.012 85);
--accent:oklch(0.76 0.11 160);--focus:oklch(0.50 0.08 160);--s1b:oklch(0.32 0.06 80);--s1f:oklch(0.86 0.10 75);
--s3b:oklch(0.32 0.06 250);--s3f:oklch(0.85 0.08 250);--s4b:oklch(0.32 0.05 200);--s4f:oklch(0.85 0.07 200);
--okb:oklch(0.32 0.06 150);--okf:oklch(0.85 0.10 150);--nob:oklch(0.32 0.07 25);--nof:oklch(0.85 0.09 25);--clk:oklch(0.7 0.18 25);color-scheme:dark}}
*{{box-sizing:border-box}}
:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}
body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans)}}
.wrap{{max-width:1240px;margin:0 auto;padding-block:40px 96px;padding-left:max(24px,env(safe-area-inset-left,0px));padding-right:max(24px,env(safe-area-inset-right,0px))}}
@media (max-width:600px){{.wrap{{padding-block:28px 72px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}}}
h1,h2,h3{{font-family:var(--serif);font-weight:600;line-height:1.2;text-wrap:balance;margin:0}}
h1{{font-size:clamp(28px,4.6vw,42px);letter-spacing:-.01em;max-width:900px}}
h2{{font-size:clamp(22px,3vw,30px)}} h3{{font-size:19px}}
p{{margin:0;max-width:760px;text-wrap:pretty}} a{{color:var(--accent)}}
code{{font-family:var(--mono);font-size:.88em;background:var(--paper-2);border-radius:3px;padding:1px 5px;overflow-wrap:anywhere}}
.strip{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:22px}}
.strip>div{{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:12px 16px;min-width:0}}
.lbl{{font:600 11.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}}
.val{{font:600 22px var(--mono);font-variant-numeric:tabular-nums}} .val small{{display:block;font:400 13px var(--sans);color:var(--ink-2)}}
.prov{{font-size:12.5px;color:var(--ink-3);margin-top:14px;max-width:none}}
section{{margin-top:56px;border-top:2px solid var(--ink);padding-top:16px;display:grid;gap:14px}}
.eyebrow{{font:12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}}
.sub{{color:var(--ink-2)}}
.chip{{display:inline-flex;align-items:center;gap:6px;font:600 12px var(--mono);border-radius:999px;padding:3px 9px;white-space:nowrap}}
.chip::before{{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}}
.k-must,.st-failed{{background:var(--nob);color:var(--nof)}} .k-should,.st-not_walked{{background:var(--s1b);color:var(--s1f)}}
.k-nit{{background:var(--s3b);color:var(--s3f)}} .k-info{{background:var(--s4b);color:var(--s4f)}} .st-seen{{background:var(--okb);color:var(--okf)}}
.probs{{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--rule);border-radius:10px}}
.probs li{{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:12px;align-items:start;padding:14px 16px;border-top:1px solid var(--rule)}}
.probs li:first-child{{border-top:0}} .ptext p{{font-size:15px}} .meta{{font-size:13px;color:var(--ink-3)}}
@media (max-width:640px){{.probs li{{grid-template-columns:1fr}}.strip{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
button{{font:inherit;color:inherit}}
.go,.btn{{border:1px solid var(--rule);background:var(--surface);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:14px;white-space:nowrap}}
.go:hover,.btn:hover{{border-color:var(--ink-3)}} :focus-visible{{outline:3px solid var(--focus);outline-offset:1px}}
.viewer{{display:grid;grid-template-columns:260px minmax(0,1fr);gap:20px;align-items:start}} .viewer>*{{min-width:0}}
@media (max-width:900px){{.viewer{{grid-template-columns:1fr}}}}
.nav{{display:grid;gap:8px;position:sticky;top:12px}}
@media (max-width:900px){{.nav{{position:static;grid-auto-flow:column;grid-auto-columns:minmax(200px,1fr);overflow-x:auto;padding-bottom:4px}}}}
.navi{{text-align:left;border:1px solid var(--rule);background:var(--surface);border-radius:10px;padding:10px 12px;cursor:pointer;display:grid;gap:6px}}
.navi[aria-current="true"]{{box-shadow:inset 0 0 0 1px var(--ink);border-color:var(--ink)}}
.navi b{{font-weight:600;font-size:15px}} .navi span.n{{font-size:12.5px;color:var(--ink-3)}}
.stage{{display:grid;gap:12px;min-width:0}}
.claim{{background:var(--paper-2);border-radius:8px;padding:12px 16px;font-size:14.5px}}
.bar{{display:flex;flex-wrap:wrap;gap:8px;align-items:center}}
.seg{{display:inline-flex;flex-wrap:wrap;max-width:100%;border:1px solid var(--rule);border-radius:8px;overflow:hidden;background:var(--surface)}}
.seg button{{border:0;background:transparent;padding:6px 12px;cursor:pointer;font-size:14px}}
.seg button[aria-pressed="true"]{{background:var(--ink);color:var(--paper)}}
.seg button:disabled{{opacity:.4;cursor:default}}
.shotwrap{{overflow:auto;border-radius:10px}} .shotwrap.zoom .shot{{width:1200px}} .shot{{cursor:zoom-in;position:relative;border:1px solid var(--rule);border-radius:10px;overflow:hidden;background:var(--surface)}}
.shot img{{display:block;width:100%;height:auto}}
.box{{position:absolute;border-radius:6px;pointer-events:none}}
.box.click{{border:3px solid var(--clk);box-shadow:0 0 0 4px color-mix(in oklch,var(--clk) 25%,transparent)}}
.box.click::after{{content:"Click";position:absolute;top:-26px;left:-3px;background:var(--clk);color:#fff;font:600 12px var(--mono);padding:2px 8px;border-radius:4px}}
.box.pin{{border:2px dashed var(--pc)}}
.box.pin .num{{position:absolute;top:-13px;left:-13px;width:26px;height:26px;border-radius:50%;background:var(--pc);color:#fff;font:600 13px var(--mono);display:grid;place-items:center}}
.box.flash{{animation:fl 1.2s ease 2}}
@keyframes fl{{50%{{box-shadow:0 0 0 10px color-mix(in oklch,var(--pc) 35%,transparent)}}}}
@media (prefers-reduced-motion:reduce){{.box.flash{{animation:none}}}}
.p-must{{--pc:oklch(0.55 0.2 25)}} .p-should{{--pc:oklch(0.6 0.14 65)}} .p-nit{{--pc:oklch(0.5 0.14 250)}} .p-info{{--pc:oklch(0.5 0.09 200)}}
.cap{{display:grid;gap:8px}} .cap .row{{display:flex;flex-wrap:wrap;gap:8px;align-items:center}}
.cap h3{{font-family:var(--sans);font-size:17px;font-weight:600}}
.pins{{list-style:none;margin:0;padding:0;display:grid;gap:6px}}
.pins li{{display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;font-size:14.5px}}
.pins .num{{width:24px;height:24px;border-radius:50%;background:var(--pc);color:#fff;font:600 12px var(--mono);display:grid;place-items:center}}
.dots{{display:flex;flex-wrap:wrap;gap:6px}}
.dots button{{width:12px;height:12px;border-radius:50%;border:1px solid var(--ink-3);background:transparent;padding:0;cursor:pointer}}
.dots button[aria-current="true"]{{background:var(--ink)}}
.tbox{{background:var(--surface);border:1px solid var(--rule);border-radius:10px;overflow-x:auto;padding:4px 12px}}
table{{border-collapse:collapse;width:100%;font-size:14px}}
th{{background:var(--paper-2);color:var(--ink-2);font:600 11.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;text-align:left;padding:10px 12px}}
td{{padding:10px 12px;border-top:1px solid var(--rule);vertical-align:top}}
.ok{{color:var(--okf);font-weight:600}} .bad{{color:var(--nof);font-weight:600}}
.terms{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px;margin:0}}
.terms div{{border-top:1px solid var(--rule);padding:10px 0}} .terms dt{{font-weight:600}} .terms dd{{margin:2px 0 0;color:var(--ink-2);font-size:14.5px}}
@media (max-width:760px){{.terms{{grid-template-columns:1fr}}}}
details{{border-top:1px solid var(--rule);padding:10px 0}} summary{{cursor:pointer;font-weight:600}}
details .body{{padding-top:8px;display:grid;gap:8px;font-size:14.5px}}
.kbd{{font:12px var(--mono);border:1px solid var(--rule);border-radius:4px;padding:0 5px}}
footer{{margin-top:56px;border-top:1px solid var(--rule);padding-top:12px;font-size:13px;color:var(--ink-3)}}
</style></head><body><div class="wrap">
<header>
  <h1>{e(v)}</h1>
  <div class="strip">
    <div><div class="lbl">Changes seen</div><div class="val">{s['status']['seen']} of {s['changes']}<small>walked on the PR's code</small></div></div>
    <div><div class="lbl">Checks</div><div class="val">{s['checks_ok']} of {s['checks']}<small>passed (role and number checks)</small></div></div>
    <div><div class="lbl">To fix</div><div class="val">{s['by_kind']['must'] + s['by_kind']['should']}<small>{s['by_kind']['must']} must · {s['by_kind']['should']} should · {s['by_kind']['nit']} nits</small></div></div>
    <div><div class="lbl">Screens</div><div class="val">{s['screens']}<small>each with its click marked</small></div></div>
  </div>
  <p class="prov">PR <a href="{e(pr['url'])}">#{pr['number']}</a> by {e(pr['author'])} · {e(pr['title'])} · walked {e(data['walked_at'])} on head <code>{e(pr['head'])}</code> (env <code>{e(data['envs']['after'])}</code>) and base <code>{e(pr['base'])}</code> (env <code>{e(data['envs']['before'])}</code>) · data: {e(data.get('data_note') or 'not recorded')}</p>
</header>

<section>
  <div class="eyebrow">Problems</div>
  <h2>What to fix or decide, worst first</h2>
  <p class="sub">Each one is pinned on the screen where it shows. "Show on screen" opens that screen below.</p>
  <ul class="probs">{prob_rows}</ul>
</section>

<section id="walk">
  <div class="eyebrow">The walk</div>
  <h2>Every change, screen by screen, as each role sees it</h2>
  <p class="sub">Pick a change. Use Before and After, the role buttons, Back and Next, or the <span class="kbd">←</span> <span class="kbd">→</span> keys. Play steps through the screens on its own.</p>
  <div class="viewer">
    <nav class="nav" id="nav" aria-label="Changes"></nav>
    <div class="stage">
      <p class="claim" id="claim"></p>
      <div class="bar">
        <div class="seg" id="sides" role="group" aria-label="Before or after"></div>
        <div class="seg" id="roles" role="group" aria-label="Role"></div>
      </div>
      <div class="shotwrap" id="shotwrap"><div class="shot" id="shot"><img id="img" alt="{e(first["caption"])}" src="{shots[first["id"]]}"></div></div><p class="meta" id="zoomhint">Tap the screen to zoom in. Tap again to zoom out.</p>
      <div class="cap">
        <div class="row"><span class="chip k-info" id="who"></span><span class="meta" id="pos"></span></div>
        <h3 id="caption"></h3>
        <ul class="pins" id="pins"></ul>
        <div class="bar"><button class="btn" id="prev">Back</button><button class="btn" id="next">Next</button><button class="btn" id="play">Play</button><div class="dots" id="dots"></div></div>
      </div>
      <div class="tbox" id="checks"></div>
    </div>
  </div>
</section>

<section>
  <div class="eyebrow">Terms</div>
  <h2>Words used on this page</h2>
  <dl class="terms">{terms_html}</dl>
  <details><summary>How this page was made</summary><div class="body">
    <p>A walk script logged in as each role on two test copies of the app: the PR's code and the code before it. At each screen it saved a picture, the box of the button it clicked next, and any note pinned to a spot. Role checks compare what each role should see with what it saw. A script then built this page from that data.</p>
    <p>Numbers on the screens come from the env's data: {e(data.get('data_note') or 'not recorded')}.</p>
  </div></details>
</section>
<footer>Built from <code>walk.json</code>. Nothing here changes the app.</footer>
</div>
<script>
const W = {payload};
const SHOTS = {shots_js};
const KIND = {json.dumps(KIND_LABEL)};
const ST = {json.dumps(STATUS_LABEL)};
const S = {{change: W.changes[0].id, side: "after", role: null, i: 0, timer: null}};
const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}})[c]);
function stepsOf(c, side, role) {{ return W.steps.filter(s => s.change === c && s.side === side && (!role || s.role === role)); }}
function rolesOf(c, side) {{ return [...new Set(W.steps.filter(s => s.change === c && s.side === side).map(s => s.role))]; }}
function sidesOf(c) {{ return ["before", "after"].filter(sd => W.steps.some(s => s.change === c && s.side === sd)); }}
function nav() {{
  $("nav").innerHTML = W.changes.map(c => {{
    const n = W.steps.filter(s => s.change === c.id).length;
    return `<button class="navi" data-c="${{c.id}}" aria-current="${{c.id === S.change}}"><b>${{esc(c.title)}}</b>
      <span><span class="chip st-${{c.status}}">${{ST[c.status]}}</span></span><span class="n">${{n}} screens${{c.reason ? " · " + esc(c.reason) : ""}}</span></button>`;
  }}).join("");
  $("nav").querySelectorAll(".navi").forEach(b => b.onclick = () => go(b.dataset.c, null, null, 0));
}}
function go(c, side, role, i) {{
  S.change = c;
  const sides = sidesOf(c);
  S.side = side && sides.includes(side) ? side : (sides.includes("after") ? "after" : sides[0]);
  const roles = rolesOf(c, S.side);
  S.role = role && roles.includes(role) ? role : null;
  S.i = i || 0;
  draw();
}}
function draw(flashPin) {{
  const c = W.changes.find(x => x.id === S.change);
  nav();
  $("claim").innerHTML = "<b>The PR says:</b> " + esc(c.claim);
  $("sides").innerHTML = ["before", "after"].map(sd => `<button data-s="${{sd}}" aria-pressed="${{sd === S.side}}" ${{sidesOf(c.id).includes(sd) ? "" : "disabled"}}>${{sd === "before" ? "Before" : "After"}}</button>`).join("");
  $("sides").querySelectorAll("button").forEach(b => b.onclick = () => go(S.change, b.dataset.s, S.role, 0));
  const roles = rolesOf(c.id, S.side);
  $("roles").innerHTML = [`<button data-r="" aria-pressed="${{!S.role}}">All roles</button>`].concat(roles.map(r => `<button data-r="${{esc(r)}}" aria-pressed="${{r === S.role}}">${{esc(r)}}</button>`)).join("");
  $("roles").querySelectorAll("button").forEach(b => b.onclick = () => go(S.change, S.side, b.dataset.r || null, 0));
  const list = stepsOf(c.id, S.side, S.role);
  S.i = Math.max(0, Math.min(S.i, list.length - 1));
  const st = list[S.i];
  const shot = $("shot");
  shot.querySelectorAll(".box").forEach(b => b.remove());
  const ch = W.checks.filter(k => k.change === c.id);
  $("checks").innerHTML = ch.length ? `<table><thead><tr><th>Role</th><th>Should</th><th>Saw</th><th>Result</th></tr></thead><tbody>${{ch.map(k => `<tr><td>${{esc(k.role)}}</td><td>${{esc(k.expect)}}</td><td>${{esc(k.seen)}}</td><td class="${{k.ok ? "ok" : "bad"}}">${{k.ok ? "Pass" : "Fail" + (k.kind && k.kind !== "must" ? " (" + KIND[k.kind].toLowerCase() + ")" : "")}}</td></tr>`).join("")}}</tbody></table>` : "<p class='meta'>No role checks for this change.</p>";
  if (!st) {{ $("img").removeAttribute("src"); $("img").alt = ""; $("who").textContent = ""; $("pos").textContent = `${{S.side === "before" ? "Before" : "After"}} · no screens`; $("caption").textContent = "No screens for this choice."; $("pins").innerHTML = ""; $("dots").innerHTML = ""; $("prev").disabled = true; $("next").disabled = true; return; }}
  $("img").src = SHOTS[st.id];
  $("img").alt = st.caption;
  const [w, h] = st.size;
  const place = (b, el) => {{ el.style.left = (b.x / w * 100) + "%"; el.style.top = (b.y / h * 100) + "%"; el.style.width = (b.w / w * 100) + "%"; el.style.height = (b.h / h * 100) + "%"; shot.appendChild(el); }};
  if (st.click) {{ const el = document.createElement("div"); el.className = "box click"; place(st.click, el); }}
  st.pins.forEach((p, k) => {{
    if (!p.box) return;
    const el = document.createElement("div");
    el.className = "box pin p-" + p.kind + (flashPin === k ? " flash" : "");
    el.innerHTML = `<span class="num">${{k + 1}}</span>`;
    place(p.box, el);
  }});
  $("who").textContent = st.role;
  $("pos").textContent = `${{S.side === "before" ? "Before" : "After"}} · screen ${{S.i + 1}} of ${{list.length}}`;
  $("caption").textContent = st.caption;
  $("pins").innerHTML = st.pins.map((p, k) => `<li class="p-${{p.kind}}"><span class="num">${{k + 1}}</span><span><b>${{KIND[p.kind]}}.</b> ${{esc(p.text)}}${{p.evidence === "guess" ? " <i>(a guess)</i>" : ""}}${{p.box ? "" : " <i>(spot not found on screen)</i>"}}</span></li>`).join("");
  $("dots").innerHTML = list.map((s, k) => `<button aria-label="Screen ${{k + 1}}" aria-current="${{k === S.i}}" data-k="${{k}}"></button>`).join("");
  $("dots").querySelectorAll("button").forEach(b => b.onclick = () => {{ S.i = +b.dataset.k; draw(); }});
  $("prev").disabled = S.i === 0; $("next").disabled = S.i === list.length - 1;
}}
function step(d) {{ const n = stepsOf(S.change, S.side, S.role).length; S.i = Math.max(0, Math.min(n - 1, S.i + d)); draw(); }}
$("shot").onclick = () => {{
  const wrap = $("shotwrap"); wrap.classList.toggle("zoom");
  $("shot").style.cursor = wrap.classList.contains("zoom") ? "zoom-out" : "zoom-in";
  const st = stepsOf(S.change, S.side, S.role)[S.i];
  const b = st && (st.click || (st.pins.find(p => p.box) || {{}}).box);
  if (wrap.classList.contains("zoom") && b) wrap.scrollLeft = b.x / st.size[0] * 1200 - wrap.clientWidth / 2;
}};
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("play").onclick = () => {{
  if (S.timer) {{ clearInterval(S.timer); S.timer = null; $("play").textContent = "Play"; return; }}
  $("play").textContent = "Pause";
  S.timer = setInterval(() => {{ const n = stepsOf(S.change, S.side, S.role).length; if (S.i >= n - 1) {{ $("play").click(); return; }} step(1); }}, 2600);
}};
document.addEventListener("keydown", e => {{ if (e.target.closest("input,textarea")) return; if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }});
document.querySelectorAll(".go").forEach(b => b.onclick = () => {{
  const st = W.steps.find(s => s.id === b.dataset.step);
  const list = stepsOf(st.change, st.side, null);
  S.change = st.change; S.side = st.side; S.role = null; S.i = list.indexOf(st);
  draw(+b.dataset.pin);
  $("walk").scrollIntoView({{behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}});
}});
go(S.change, "after", null, 0);
</script></body></html>"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("walk_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--terms", type=Path)
    a = ap.parse_args()
    data, shots = load(a.walk_dir)
    if bad := bad_boxes(data):
        raise SystemExit("refused: these boxes would draw wrong, fix the walk and record again\n  " + "\n  ".join(bad))
    terms = json.loads(a.terms.read_text()) if a.terms else []
    a.out.write_text(page(data, shots, terms))
    print(a.out, f"{a.out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()

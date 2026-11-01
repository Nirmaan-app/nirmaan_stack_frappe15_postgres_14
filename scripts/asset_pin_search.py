#!/usr/bin/env python3
"""Asset-pin search -- after a rate-master mint, list every test pin of the previous latest asset.

WHY THIS EXISTS
---------------
A mint (``rate_master_<discipline>_all_v<N>.json``) breaks tests that pin the asset it replaces. Finding them took
30-40 minutes a slice, by hand, and the hand search kept missing a class: ELR-2's first commit grepped for the old file
name and missed nine latest-asset comparisons; ELR-3a's grepped for the old file name and ``CURRENT_EALL_ASSET`` and
missed ``servedVsStoredPricing.test.ts``, which reads the latest asset by file PREFIX (found only by the scoped
vitest run, a fourth commit). This script searches for every class those slices hit (TOOL-1 P4):

  MUST MOVE (exit 1 while any remains -- each still names the old asset as the current one):
    const       a ``CURRENT_*_ASSET`` / ``CURRENT``/``LATEST`` constant assigned the old file name
    assert      an assertion naming the old file name as the current or latest asset
    scan-max    a scan of the data dir pinned to the old version number (``assertEqual(max(ns), <old>)``)
    not-exists  an assertion that the NEW file does not exist (``assertFalse(os.path.exists(<new file>))``)
    count       a suite constant holding the old item or config count (`EALL_ITEMS = 1402`) when the mint changed it
  LIKELY TO BREAK (listed with the test that holds them; read each):
    compares    a test reading the latest asset that also names an older version (``now`` vs ``was``)
    prefix      a reader of the latest asset by bare file prefix (``latestAsset("rate_master_electrical_all_v")``)
    count-literal  the old count inside an assertion of a file that reads the latest asset
    digest      a hex literal that is a prefix of the old asset file's sha256
    normaliser  a `_without_*` helper those comparisons forgive a declared mint change through (the next one chains in)
  REVIEW:
    reader      any other test reading the latest asset (the CURRENT constant, ``latest_asset``, a prefix scan)
    old-name    any other code line naming the old file or ``v<old>`` (often a deliberate historical pin)

Search space: ``nirmaan_stack/**/test_*.py`` and ``frontend/src/**/*.{test,harness}*.{ts,tsx}`` (+
``frontend/scripts/**/*.test.mjs``), at the working tree or at ``--rev``; the asset files at ``--asset-rev``.

Usage (from anywhere; stdlib only):
    python3 scripts/asset_pin_search.py --discipline Electrical --new-version 70
    python3 scripts/asset_pin_search.py --discipline HVAC --new-version 55 --json
    # a past mint, as it stood before its pins moved: tests from the parent, assets from the mint commit
    python3 scripts/asset_pin_search.py --discipline Electrical --new-version 70 --rev a799c49e0^ --asset-rev a799c49e0
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = "nirmaan_stack/services/boq_rate_master/data"
PREFIX = {"Electrical": "rate_master_electrical_all_v", "HVAC": "rate_master_hvac_all_v"}
MUST = ("const", "assert", "scan-max", "not-exists", "count")
LIKELY = ("compares", "prefix", "count-literal", "digest", "normaliser")
SKIP_DIRS = {"node_modules", "dist", "__pycache__", ".git"}


@dataclass
class Finding:
    cls: str
    path: str
    line: int
    test: str
    text: str


# --- reading the tree: the working copy, or a commit --------------------------------------------------------

class Tree:
    def __init__(self, root: Path, rev: str | None):
        self.root, self.rev = root, rev

    def _git(self, *args: str) -> str:
        return subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, check=True,
                              ).stdout.decode("utf-8", errors="replace")

    def files(self, containing: str | None = None) -> list[str]:
        """Every file (at the rev, or on disk); with `containing` (an extended regex) at a rev, only the files git grep
        finds it in -- the same search, without reading every file of the tree through `git show`."""
        if self.rev and containing:
            r = subprocess.run(["git", "-C", str(self.root), "grep", "-l", "-E", containing, self.rev, "--",
                                "nirmaan_stack", "frontend/src", "frontend/scripts"], capture_output=True)
            if r.returncode not in (0, 1):
                raise SystemExit(r.stderr.decode("utf-8", errors="replace"))
            return [ln.split(":", 1)[1] for ln in r.stdout.decode("utf-8", errors="replace").splitlines()]
        if self.rev:
            return self._git("ls-tree", "-r", "--name-only", self.rev).splitlines()
        out = []
        for base in ("nirmaan_stack", "frontend/src", "frontend/scripts", DATA_DIR):
            for p in (self.root / base).rglob("*"):
                if p.is_file() and not SKIP_DIRS & set(p.parts):
                    out.append(p.relative_to(self.root).as_posix())
        return sorted(set(out))

    def read(self, path: str) -> str:
        if self.rev:
            return self._git("show", f"{self.rev}:{path}").replace("\r\n", "\n")
        return (self.root / path).read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")

    def read_bytes(self, path: str) -> bytes:
        if self.rev:
            return subprocess.run(["git", "-C", str(self.root), "show", f"{self.rev}:{path}"],
                                  capture_output=True, check=True).stdout
        return (self.root / path).read_bytes()


def is_test_file(path: str) -> bool:
    p = PurePosixPath(path)
    if SKIP_DIRS & set(p.parts):
        return False
    if path.startswith("nirmaan_stack/") and p.suffix == ".py":
        return p.name.startswith("test_")
    if path.startswith("frontend/src/") and p.suffix in (".ts", ".tsx"):
        return ".test." in p.name or ".harness." in p.name
    return path.startswith("frontend/scripts/") and p.name.endswith(".test.mjs")


# --- the asset pair -----------------------------------------------------------------------------------------

def versions(names: list[str], prefix: str) -> dict[tuple[int, str], str]:
    rx = re.compile("^" + re.escape(prefix) + r"(\d+)([a-z]*)\.json$")
    out = {}
    for n in names:
        m = rx.match(PurePosixPath(n).name)
        if m and n.startswith(DATA_DIR + "/"):
            out[(int(m.group(1)), m.group(2))] = PurePosixPath(n).name
    return out


def asset_facts(raw: bytes) -> dict:
    data = json.loads(raw)
    items = data.get("items") or []
    pi = [i for i in items if str(i.get("kind") or "").endswith("_pricing_input")]
    return {"sha256": hashlib.sha256(raw).hexdigest(), "items": len(items),
            "configs": len(data.get("category_configs") or []), "items_without_inputs": len(items) - len(pi)}


# --- Python: which tests read the latest asset (AST, two levels of taint) ------------------------------------

def _enclosing_map(tree: ast.AST) -> dict[int, str]:
    """line -> 'Class.method' / 'function' / '<module>' for every line of every def."""
    out: dict[int, str] = {}

    def walk(node, scope):
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = f"{scope}.{ch.name}" if scope else ch.name
                for ln in range(ch.lineno, (ch.end_lineno or ch.lineno) + 1):
                    out[ln] = name
                walk(ch, name)
            else:
                walk(ch, scope)
    walk(tree, "")
    return out


def python_readers(src: str, seeds: set[str], seed_rx: re.Pattern) -> dict[str, list[int]]:
    """{test or helper name: [seed lines]} for every def that reads the latest asset, directly (a seed name or a
    prefix scan) or through a module-level helper / a class's setUp / class attribute that does."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return {}
    encl = _enclosing_map(tree)
    lines = src.splitlines()
    direct: dict[str, list[int]] = {}
    for node in ast.walk(tree):
        hit = (isinstance(node, ast.Name) and node.id in seeds) or \
              (isinstance(node, ast.Attribute) and node.attr in ("latest_asset", "latest_in")) or \
              (isinstance(node, ast.Constant) and isinstance(node.value, str) and seed_rx.search(node.value))
        if hit:
            direct.setdefault(encl.get(node.lineno, "<module>"), []).append(node.lineno)
    # what each def refers to: bare names (module-level helpers, aliases) and self./cls. attributes (its class's own)
    names: dict[str, set[str]] = {}
    attrs: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            q = encl.get(node.lineno)
            names[q] = {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
            attrs[q] = {n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute)
                        and isinstance(n.value, ast.Name) and n.value.id in ("self", "cls")}
    tainted = dict(direct)
    # a module-level alias (`EALL = CURRENT_EALL_ASSET`) is a bare-name seed; a class-level one (`_ASSET = ...` in the
    # class body) or an attribute set from it (`cls.now = ...`) is an attribute seed of THAT class only
    mod_names: set[str] = set()
    cls_attrs: dict[str, set[str]] = {}
    for scope, lns in direct.items():
        for ln in lns:
            m = re.match(r"\s*(?:(?:self|cls)\.)?(\w+)\s*=", lines[ln - 1])
            if not m:
                continue
            if scope == "<module>":
                mod_names.add(m.group(1))
            elif "." not in scope:
                cls_attrs.setdefault(scope, set()).add(m.group(1))
            else:
                cls_attrs.setdefault(scope.rsplit(".", 1)[0], set()).add(m.group(1))
    lifecycle = {"setUp", "setUpClass", "tearDown", "tearDownClass"}
    for _ in range(4):                                   # helpers of helpers of helpers
        grew = False
        mod_funcs = {q for q in tainted if "." not in q and q != "<module>" and not q[:1].isupper()}
        for q in names:
            if q in tainted:
                continue
            cls = q.rsplit(".", 1)[0] if "." in q else ""
            own = {t.rsplit(".", 1)[1] for t in tainted if "." in t and t.rsplit(".", 1)[0] == cls} - lifecycle
            if names[q] & (mod_funcs | mod_names) or attrs[q] & (own | cls_attrs.get(cls, set())):
                tainted[q] = [-1]
                grew = True
        if not grew:
            break
    # a class whose setUp / setUpClass reads it: every test of that class reads it
    for q in list(tainted):
        parts = q.split(".")
        if len(parts) >= 2 and parts[-1] in ("setUp", "setUpClass"):
            cls = ".".join(parts[:-1])
            for t in names:
                if t.startswith(cls + ".test") and t not in tainted:
                    tainted[t] = [-1]
    return tainted


# --- TypeScript: prefix readers and the identifiers they feed -----------------------------------------------

_TS_TEST = re.compile(r"""^\s*(?:it|test|describe)(?:\.each\([^)]*\))?\(\s*(["'`])(.+?)\1""")


def ts_enclosing(lines: list[str], idx: int) -> str:
    for j in range(idx, -1, -1):
        m = _TS_TEST.match(lines[j])
        if m:
            return m.group(2)[:80]
    return "<module>"


def _code(line: str) -> str:
    """The line with a trailing // or # comment removed (good enough for a pin search; strings with // are rare)."""
    s = line.strip()
    if s.startswith(("#", "//", "*", "/*")):
        return ""
    return re.split(r"\s(?://|#)\s", line, maxsplit=1)[0]


# --- the search -----------------------------------------------------------------------------------------------

def search(root: Path, discipline: str, new_version: int, rev: str | None = None,
           asset_rev: str | None = None) -> tuple[dict, list[Finding]]:
    prefix = PREFIX[discipline]
    tests_tree, assets_tree = Tree(root, rev), Tree(root, asset_rev if asset_rev is not None else rev)
    asset_names = [n for n in assets_tree.files() if n.startswith(DATA_DIR + "/")]
    vers = versions(asset_names, prefix)
    news = [k for k in vers if k[0] == new_version]
    if not news:
        raise SystemExit(f"{prefix}{new_version}.json is not in {DATA_DIR} (asset rev {asset_rev or rev or 'worktree'})")
    new_key = max(news)
    olds = [k for k in vers if k < new_key]
    if not olds:
        raise SystemExit(f"{prefix}{new_version}.json has no earlier version to search for")
    old_key = max(olds)
    old_file, new_file = vers[old_key], vers[new_key]
    old_v, new_v = f"{old_key[0]}{old_key[1]}", f"{new_key[0]}{new_key[1]}"
    old_f = asset_facts(assets_tree.read_bytes(f"{DATA_DIR}/{old_file}"))
    new_f = asset_facts(assets_tree.read_bytes(f"{DATA_DIR}/{new_file}"))
    head = {"discipline": discipline, "old": old_file, "new": new_file, "old_facts": old_f, "new_facts": new_f}

    stem = prefix.split("rate_master_")[1]                    # "electrical_all_v"
    files = [f for f in tests_tree.files(f"{stem}|CURRENT_|latest_asset") if is_test_file(f)]
    srcs = {f: tests_tree.read(f) for f in files}
    srcs = {f: s for f, s in srcs.items() if stem in s or "CURRENT_" in s or "latest_asset" in s}

    # the CURRENT constants of this discipline, wherever they are defined (test_rate_master: CURRENT_EALL_ASSET)
    const_rx = re.compile(r"^\s*(?:export\s+)?(?:const\s+)?((?:CURRENT|LATEST)\w*)\s*[:=][^=\n]*?[\"']"
                          + re.escape(prefix) + r"\d+[a-z]*\.json", re.M | re.I)
    consts = {m.group(1) for s in srcs.values() for m in const_rx.finditer(s)}
    seed_rx = re.compile(re.escape(prefix) + r"(?:[\"'`]|%d|%s|\(\\d|\$\{|\*)")   # bare prefix / a scan of it
    bare_rx = re.compile(re.escape(prefix) + r"[\"'`]")
    old_name_rx = re.compile(re.escape(old_file) + r"|\b" + re.escape(stem) + re.escape(old_v) + r"\b"
                             + r"|(?<![\w.])v" + re.escape(old_v) + r"(?![\w.])")
    older_rx = re.compile(re.escape(stem) + r"(\d+)|(?<![\w.])[vV](\d+)\b")
    count_changed = {k: (old_f[k], new_f[k]) for k in ("items", "configs", "items_without_inputs")
                     if old_f[k] != new_f[k]}
    sha_prefixes = {old_f["sha256"][:n] for n in range(8, 65)}

    found: list[Finding] = []
    for path, src in sorted(srcs.items()):
        lines = src.split("\n")
        py = path.endswith(".py")
        readers = python_readers(src, consts, seed_rx) if py else {}
        encl = _enclosing_map(ast.parse(src)) if py and _parses(src) else {}
        reads_latest = bool(readers) or bool(bare_rx.search(src)) or any(c in src for c in consts)
        ts_taint: set[str] = set()
        if not py:
            for ln in lines:
                m = re.match(r"\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=.*", ln)
                if m and (bare_rx.search(ln) or any(re.search(r"\b%s\b" % c, ln) for c in consts)):
                    ts_taint.add(m.group(1))
        for i, raw in enumerate(lines):
            code = _code(raw)
            if not code.strip():
                continue
            n = i + 1
            test = encl.get(n, "<module>") if py else ts_enclosing(lines, i)
            text = raw.strip()[:200]

            def add(c):
                found.append(Finding(c, path, n, test, text))
            names_const = any(re.search(r"\b%s\b" % re.escape(c), code) for c in consts)
            if const_rx.match(raw) and old_file in code:
                add("const"); continue
            if old_file in code and (names_const or re.search(r"latest|current", code, re.I)) and \
                    re.search(r"assert|expect\(|==", code):
                add("assert"); continue
            if re.search(r"max\(\w+\)\s*(?:,|==)\s*%d(?![\w.])|(?<![\w.])%d\s*==\s*max\(" % (old_key[0], old_key[0]), code):
                add("scan-max"); continue
            if new_file in code and re.search(r"assertFalse|\bnot\b|toBe\(false\)|\.not\.", code):
                add("not-exists"); continue
            if count_changed and reads_latest:
                nums = {str(v[0]) for v in count_changed.values()}
                if any(re.search(r"(?<![\w.])%s(?![\w.])" % x, code) for x in nums):
                    # a suite-wide constant (`EALL_ITEMS = 1402`) must move; a literal inside one assertion may be
                    # about something else of the same size (the served fixture's own length), so it is read, not forced
                    if re.match(r"\s*(?:export\s+)?(?:const\s+)?[A-Z][A-Z0-9_]*\s*(?::[^=]+)?=\s*\d", raw):
                        add("count"); continue
                    if re.search(r"assert|expect\(|toBe|toEqual|toHaveLength", code):
                        add("count-literal"); continue
            if any(p in code for p in re.findall(r"[0-9a-f]{8,64}", code) if p in sha_prefixes):
                add("digest"); continue
            if bare_rx.search(code) and not py:
                add("prefix"); continue
            if old_name_rx.search(code):
                add("old-name"); continue
            if not py and ts_taint and any(re.search(r"\b%s\b" % t, code) for t in ts_taint):
                add("prefix"); continue
        if py:
            called: set[str] = set()
            for q, seed_lines in readers.items():
                if q == "<module>" or not q.split(".")[-1].startswith(("test", "setUp")):
                    continue
                node_lines = [ln for ln, s in encl.items() if s == q]
                body = "\n".join(lines[min(node_lines) - 1:max(node_lines)]) if node_lines else ""
                cls_name = ".".join(q.split(".")[:-1])
                # the class's setUp counts only when the setUp itself reads the latest asset (`now` beside `was`)
                setup = "\n".join(lines[ln - 1] for ln, s in encl.items()
                                  if s.startswith(cls_name + ".setUp") and s in readers)
                older = {int(a or b) for a, b in older_rx.findall(body + "\n" + setup)
                         if int(a or b) < old_key[0] and int(a or b) > 0}
                first = min(node_lines) if node_lines else (seed_lines[0] if seed_lines[0] > 0 else 1)
                if older:
                    found.append(Finding("compares", path, first, q,
                                         "reads the latest asset and names older v%s" % ",".join(map(str, sorted(older)[-3:]))))
                    called |= set(re.findall(r"\b(_without_\w+)\(", body))
                else:
                    found.append(Finding("reader", path, first, q, "reads the latest asset"))
            # the named normalisers those comparisons forgive a mint's declared change through: the next one chains here
            for fn in sorted(called):
                m = re.search(r"^def %s\(" % re.escape(fn), src, re.M)
                if m:
                    found.append(Finding("normaliser", path, src.count("\n", 0, m.start()) + 1, fn,
                                         "a latest-asset comparison forgives a declared mint change through this"))
    return head, found


def _parses(src: str) -> bool:
    try:
        ast.parse(src)
        return True
    except SyntaxError:
        return False


def report(head: dict, found: list[Finding]) -> str:
    out = [f"{head['discipline']}: {head['old']} -> {head['new']}  "
           f"(items {head['old_facts']['items']} -> {head['new_facts']['items']}, "
           f"configs {head['old_facts']['configs']} -> {head['new_facts']['configs']})"]
    for title, classes in (("MUST MOVE", MUST), ("LIKELY TO BREAK", LIKELY), ("REVIEW", ("reader", "old-name"))):
        rows = [f for f in found if f.cls in classes]
        out.append(f"\n{title}: {len(rows)}")
        for f in sorted(rows, key=lambda f: (f.path, f.line)):
            out.append(f"  [{f.cls}] {f.path}:{f.line}  ({f.test})  {f.text}")
    must = sum(1 for f in found if f.cls in MUST)
    out.append(f"\n{must} pin(s) still name {head['old']} as the current asset" if must else
               f"\n0 pins name {head['old']} as the current asset")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="List every test pin of the previous latest rate-master asset.")
    ap.add_argument("--discipline", required=True, choices=sorted(PREFIX))
    ap.add_argument("--new-version", required=True, type=int, help="the version just minted, e.g. 70")
    ap.add_argument("--rev", help="read the TEST files at this commit (default: the working tree)")
    ap.add_argument("--asset-rev", help="read the ASSET files at this commit (default: --rev, else the working tree)")
    ap.add_argument("--json", action="store_true", help="print JSON instead of the report")
    ap.add_argument("--root", default=str(REPO_ROOT), help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    head, found = search(Path(a.root), a.discipline, a.new_version, a.rev, a.asset_rev)
    if a.json:
        print(json.dumps({"head": head, "findings": [asdict(f) for f in found]}, indent=1))
    else:
        print(report(head, found))
    return 1 if any(f.cls in MUST for f in found) else 0


if __name__ == "__main__":
    sys.exit(main())

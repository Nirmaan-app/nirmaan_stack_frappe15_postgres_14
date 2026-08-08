#!/usr/bin/env python3
"""Mint-completeness gate -- prove a rate-master asset mint carried everything forward.

WHY THIS EXISTS
---------------
``loader._load_multi`` replaces a config WHOLESALE: the prior row is flipped
``active = 0`` and a brand-new document is inserted from the payload alone. Nothing is
merged, nothing is diffed. **Any key absent from the asset is gone from the active
config -- intended or not, and with no signal of any kind.** So the losable set is a
config's ENTIRE key space, not a short list. ``pipelines`` is the sharpest case: an
empty ``{}`` is LEGAL (``loader._validate_one_config``), so a mint that empties it
imports clean and the category silently stops pricing.

It has already happened. The ``dbu3`` golden was lost at the EA-4d mint and repaired by
hand three days later, found while investigating something else.

*** THIS GATE COMPARES COMMITS, NOT WORKING-COPY FILES -- and that is the whole point.
Comparing ``v16c`` and ``v17`` AS THEY SIT ON DISK shows ``dbu3`` merely CHANGED,
because the repair edited ``v17`` IN PLACE. The loss is visible ONLY when diffing
``v17`` as it was ORIGINALLY COMMITTED. A gate that compared files would have missed
the one loss we know about. Whenever an operand is a working-copy path whose file has
more than one commit, this script emits a BLIND-SPOT warning naming the commits it
cannot see, rather than reporting a comforting "clean". ***

WHAT IT REPORTS
---------------
Every ATOM that disappeared between two asset versions, at sub-config granularity,
because that is where the real exposure sits (each of these has moved in a past mint):

    top:<key>                     a top-level payload key
    cat:<cid>                     a category
    cfgkey:<cid>:<key>            a config key
    attr:<cid>:<id>               an attribute-definition id
    pipe:<cid>:<id>               a pipeline id
    rule:<cid>:<id>               a rule id
    extdef:<cid>:<key>            an extraction_defaults key
    syn:<cid>:<attr>:<variant>    a synonyms entry
    golden:<cid>:<gid>            a golden id (EFFECTIVE -- see the merge note below)
    expect:<cid>:<gid>:<key>      an output key INSIDE a golden's `expect`
    kind:<k>                      an item kind
    retkind:<k> / retcat:<cid>    a retired_* entry (losing one UN-supersedes it)
    excl:<cid>                    an excluded_categories entry

Goldens are read EFFECTIVELY, exactly as ``_load_multi:358-360`` resolves them: the
top-level ``goldens`` dict wins where it has an entry for the category, else the
config's own ``goldens``. So removing a redundant config-level copy is reported as a
lost CONFIG KEY and NOT as a lost golden -- which is the honest distinction.

INTENT -- telling a deliberate removal from an accidental one
-------------------------------------------------------------
Machine-readable declarations exist TODAY at exactly two granularities:
``retired_category_ids`` and ``retired_kinds``. This gate treats a removal as DECLARED
when the new asset ADDS the matching entry, and cascades that to every atom beneath a
declared-retired category (its attrs, pipelines, goldens, defaults and config keys all
go with it, by definition).

Below that granularity NOTHING can express "this golden was removed on purpose".
``slice_note`` and ``excluded_categories`` are prose with ZERO code consumers -- and a
note nobody verifies is not a declaration. They are echoed here as UNVERIFIED CONTEXT,
never as a clearance.

The MINIMUM declaration that would close the gap is one optional top-level asset key:

    "intentional_removals": ["golden:db_switchgear:dbu2",
                             "extdef:point_wiring:circuit_length_m"]

a flat list of the atom strings this script already prints. It is minimal because the
vocabulary is the gate's own output (copy the line, paste it in), it travels WITH the
asset so it is reviewed in the same diff, and ABSENT means today's behaviour exactly.
This script reads it when present. No asset carries it yet; adoption is a mint-time
choice needing no code change.

Everything not declared is printed in full, one line each, for a human to confirm. The
gate does not decide; it refuses to let a removal pass unseen.

USAGE
-----
    # compare two asset versions (each operand: "<rev>:<repo-path>" or a plain path)
    python3 scripts/mint_completeness_check.py OLD NEW

    # walk EVERY commit of one asset -- catches in-place edits, which is how dbu3 hid
    python3 scripts/mint_completeness_check.py --history <repo-path>

    # the built-in calibration on known-answer pairs (T1-T5)
    python3 scripts/mint_completeness_check.py --self-test

Stdlib only, ASCII-only output. No bench context, no DB, no network -- like
scripts/residence_check.py. Exit code 0 when every removal is declared, 1 when any is
not. This gate is INVOKED, not automatic: nothing in this repo runs it for you.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = "nirmaan_stack/services/boq_rate_master/data"

# The E-ALL series filename shape, used to derive which mints are UNINSPECTABLE.
EALL_RE = re.compile(r"^rate_master_electrical_all_v(\d+)([a-z]*)\.json$")


# --- git access ---------------------------------------------------------------


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        encoding="utf-8",
    ).stdout


def commits_for(path: str) -> list[tuple[str, str, str]]:
    """Every commit touching `path`, OLDEST first: (sha, iso-date, subject)."""
    out = _git("log", "--reverse", "--format=%H%x1f%ad%x1f%s", "--date=short", "--", path)
    rows = []
    for line in out.splitlines():
        if line.strip():
            sha, date, subject = line.split("\x1f", 2)
            rows.append((sha, date, subject))
    return rows


class Ref:
    """An asset operand: either a git blob (`rev:path`) or a working-copy file."""

    def __init__(self, spec: str):
        if ":" in spec and not Path(spec).exists():
            rev, path = spec.split(":", 1)
            self.rev, self.path, self.from_git = rev, path, True
        else:
            p = Path(spec)
            try:
                rel = p.resolve().relative_to(REPO_ROOT).as_posix()
            except ValueError:
                rel = spec
            self.rev, self.path, self.from_git = None, rel, False

    @property
    def label(self) -> str:
        base = Path(self.path).name
        return f"{self.rev[:8]}:{base}" if self.from_git else f"{base} (WORKING COPY)"

    def load(self) -> dict:
        if self.from_git:
            return json.loads(_git("show", f"{self.rev}:{self.path}"))
        return json.loads((REPO_ROOT / self.path).read_text(encoding="utf-8"))

    def blind_spot(self) -> list[tuple[str, str, str]]:
        """Commits this operand cannot distinguish. A working-copy file with more than
        one commit HIDES whatever an in-place edit repaired -- the dbu3 shape."""
        if self.from_git:
            return []
        cs = commits_for(self.path)
        return cs if len(cs) > 1 else []


# --- asset normalisation ------------------------------------------------------


def _configs(payload: dict) -> list[dict]:
    """Both asset shapes: the E-ALL `category_configs` LIST and wiring's single
    `category_config`. Wiring uses loader's single-config path and has no top-level
    goldens dict, so it must not be silently skipped."""
    if isinstance(payload.get("category_configs"), list):
        return payload["category_configs"]
    one = payload.get("category_config")
    return [one] if isinstance(one, dict) else []


def _effective_goldens(payload: dict, cfg: dict) -> list:
    """Mirror loader._load_multi:358-360 -- top-level wins WHERE IT HAS AN ENTRY."""
    top = payload.get("goldens")
    if isinstance(top, dict):
        merged = top.get((cfg.get("category_id") or "").strip())
        if merged is not None:
            return merged
    return cfg.get("goldens") or []


def atoms(payload: dict) -> dict[str, str]:
    """atom -> a short human description, for the confirmation list."""
    a: dict[str, str] = {}
    for k in payload:
        a[f"top:{k}"] = "top-level payload key"
    for x in payload.get("retired_kinds") or []:
        a[f"retkind:{x}"] = "retired-kind declaration"
    for x in payload.get("retired_category_ids") or []:
        a[f"retcat:{x}"] = "retired-category declaration"
    for e in payload.get("excluded_categories") or []:
        if isinstance(e, dict) and e.get("category_id"):
            a[f"excl:{e['category_id']}"] = "excluded-categories entry (prose)"
    for it in payload.get("items") or []:
        if it.get("kind"):
            a[f"kind:{it['kind']}"] = "item kind"

    for cfg in _configs(payload):
        cid = (cfg.get("category_id") or "").strip()
        if not cid:
            continue
        a[f"cat:{cid}"] = "CATEGORY"
        for k in cfg:
            a[f"cfgkey:{cid}:{k}"] = "config key"
        for d in cfg.get("attribute_definitions") or []:
            if d.get("id"):
                a[f"attr:{cid}:{d['id']}"] = "attribute definition"
        for pid in cfg.get("pipelines") or {}:
            a[f"pipe:{cid}:{pid}"] = "pipeline"
        for r in cfg.get("rules") or []:
            if r.get("id"):
                a[f"rule:{cid}:{r['id']}"] = "estimator rule (reaches the AI prompt)"
        for k in cfg.get("extraction_defaults") or {}:
            a[f"extdef:{cid}:{k}"] = "extraction default (reaches the AI prompt)"
        for attr, m in (cfg.get("synonyms") or {}).items():
            for variant in m or {}:
                a[f"syn:{cid}:{attr}:{variant}"] = "synonym (reaches the AI prompt + coercion)"
        for g in _effective_goldens(payload, cfg):
            gid = g.get("id")
            if not gid:
                continue
            a[f"golden:{cid}:{gid}"] = "GOLDEN (a standing regression pin)"
            for ok in (g.get("expect") or {}):
                a[f"expect:{cid}:{gid}:{ok}"] = "golden expect-output key"
    return a


# --- intent -------------------------------------------------------------------


def classify(lost: dict[str, str], old: dict, new: dict) -> tuple[dict, dict]:
    """Split lost atoms into (declared, undeclared) using ONLY real declarations."""
    newly_retired_cats = (set(new.get("retired_category_ids") or [])
                          - set(old.get("retired_category_ids") or []))
    newly_retired_kinds = (set(new.get("retired_kinds") or [])
                           - set(old.get("retired_kinds") or []))
    explicit = set(new.get("intentional_removals") or [])

    declared, undeclared = {}, {}
    for atom, desc in sorted(lost.items()):
        why = None
        parts = atom.split(":")
        if atom in explicit:
            why = "listed in the new asset's `intentional_removals`"
        elif parts[0] in ("cat", "cfgkey", "attr", "pipe", "rule", "extdef", "syn",
                          "golden", "expect") and len(parts) > 1:
            # a category and EVERYTHING beneath it cascade from ONE retired_category_ids entry
            if parts[1] in newly_retired_cats:
                why = f"category '{parts[1]}' added to `retired_category_ids`"
        elif parts[0] == "kind" and len(parts) > 1 and parts[1] in newly_retired_kinds:
            why = f"kind '{parts[1]}' added to `retired_kinds`"
        (declared if why else undeclared)[atom] = (desc, why)
    return declared, undeclared


# --- uninspectable window -----------------------------------------------------


def uninspectable_versions() -> list[str]:
    """Which E-ALL mints cannot be inspected at all -- DERIVED from the files present,
    not hardcoded. A bare integer gap is a missing mint; a suffix beyond 'a' implies
    the earlier suffixed attempts existed and are gone."""
    present, seen = set(), []
    d = REPO_ROOT / DATA_DIR
    if d.is_dir():
        for f in sorted(p.name for p in d.iterdir()):
            m = EALL_RE.match(f)
            if m:
                seen.append((int(m.group(1)), m.group(2)))
                present.add(f"v{m.group(1)}{m.group(2)}")
    if not seen:
        return []
    missing, lo, hi = [], min(n for n, _ in seen), max(n for n, _ in seen)
    for n in range(lo, hi + 1):
        if not any(x == n for x, _ in seen):
            missing.append(f"v{n}")
            continue
        for suf in sorted({s for x, s in seen if x == n and s}):
            if f"v{n}" not in present:
                missing.append(f"v{n}")
            for c in range(ord("a"), ord(suf)):
                cand = f"v{n}{chr(c)}"
                if cand not in present:
                    missing.append(cand)
    out, dedup = [], set()
    for v in missing:
        if v not in dedup:
            dedup.add(v)
            out.append(v)
    return out


# --- reporting ----------------------------------------------------------------


def _wrap(text: str, width: int) -> list[str]:
    words, line, out = str(text).split(), "", []
    for w in words:
        if len(line) + len(w) + 1 > width:
            out.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    if line:
        out.append(line)
    return out


def compare(old_ref: Ref, new_ref: Ref) -> tuple[dict, dict, list]:
    old, new = old_ref.load(), new_ref.load()
    new_atoms = atoms(new)
    lost = {k: v for k, v in atoms(old).items() if k not in new_atoms}
    declared, undeclared = classify(lost, old, new)
    blind = old_ref.blind_spot() + new_ref.blind_spot()

    print("=" * 78)
    print(f"MINT COMPLETENESS  {old_ref.label}  ->  {new_ref.label}")
    print("=" * 78)

    if blind:
        print()
        print("  !! BLIND SPOT -- this comparison uses a WORKING-COPY file that has more")
        print("     than one commit. An in-place edit hides the very loss it repaired")
        print("     (this is exactly how dbu3 stayed invisible). Re-run against the")
        print("     commits below before trusting a clean result:")
        for sha, date, subj in blind:
            print(f"       {sha[:8]}  {date}  {subj[:62]}")

    print()
    if not lost:
        print("  No atoms disappeared.")
    else:
        print(f"  {len(lost)} atom(s) disappeared: "
              f"{len(declared)} DECLARED, {len(undeclared)} UNDECLARED")

    if declared:
        print()
        print(f"  -- DECLARED ({len(declared)}) -- covered by a machine-readable declaration")
        by_reason: dict[str, list[str]] = {}
        for atom, (_d, why) in declared.items():
            by_reason.setdefault(why, []).append(atom)
        for why, items in sorted(by_reason.items()):
            print(f"     [{why}]  {len(items)} atom(s)")
            for atom in items:
                print(f"        {atom}")

    if undeclared:
        print()
        print(f"  ** UNDECLARED ({len(undeclared)}) -- CONFIRM EACH ONE BY HAND **")
        print("     Nothing in the asset says these were removed on purpose.")
        for atom, (desc, _why) in undeclared.items():
            print(f"        {atom}")
            print(f"            ({desc})")

    note_old, note_new = old.get("slice_note"), new.get("slice_note")
    if note_new and note_new != note_old:
        print()
        print("  -- UNVERIFIED CONTEXT: the new asset's `slice_note` (prose; ZERO code")
        print("     consumers; nothing checks it against what actually changed) --")
        for line in _wrap(note_new, 70):
            print(f"       {line}")

    miss = uninspectable_versions()
    if miss:
        print()
        print("  -- UNINSPECTABLE WINDOW --")
        print(f"     These E-ALL mints have no asset on disk and CANNOT be inspected: "
              f"{', '.join(miss)}.")
        print("     Anything lost in those mints is invisible to this gate. The one known")
        print("     loss from that era (the dbu3 golden, lost at EA-4d and repaired by")
        print("     hand) is recorded and repaired -- but it was found by accident.")

    print()
    print("  RESULT: " + ("PASS -- every removal is declared" if not undeclared
                          else "REVIEW REQUIRED -- undeclared removals above"))
    print()
    return declared, undeclared, blind


def do_history(path: str) -> int:
    """Walk every commit of one asset. This is what catches an in-place edit."""
    cs = commits_for(path)
    print("=" * 78)
    print(f"HISTORY WALK  {path}")
    print("=" * 78)
    if not cs:
        print("  no commits found")
        return 1
    for sha, date, subj in cs:
        print(f"  {sha[:8]}  {date}  {subj}")
    if len(cs) == 1:
        print("\n  Single commit -- nothing to compare, and no in-place edit can hide here.")
        return 0
    print(f"\n  {len(cs)} commits -- comparing each consecutive pair.\n")
    rc = 0
    for (a, _d1, _s1), (b, _d2, _s2) in zip(cs, cs[1:]):
        _dec, und, _bl = compare(Ref(f"{a}:{path}"), Ref(f"{b}:{path}"))
        if und:
            rc = 1
    return rc


# --- self-test ----------------------------------------------------------------

EALL = f"{DATA_DIR}/rate_master_electrical_all_%s.json"
WIRING = f"{DATA_DIR}/rate_master_wiring_cabling_v3.json"


def _first_commit(path: str) -> str:
    return commits_for(path)[0][0]


def do_self_test() -> int:
    """Known-answer calibration. A gate unproven on known answers is not a gate."""
    failures = []

    print("#" * 78)
    print("# T1  v16c -> v17 AS COMMITTED   MUST report the dbu3 loss")
    print("#" * 78)
    _d, und, _b = compare(Ref(f"{_first_commit(EALL % 'v16c')}:{EALL % 'v16c'}"),
                          Ref(f"{_first_commit(EALL % 'v17')}:{EALL % 'v17'}"))
    if "golden:db_switchgear:dbu3" in und:
        print("  T1 PASS -- dbu3 reported as an UNDECLARED removal.\n")
    else:
        print("  T1 **FAIL** -- dbu3 not reported. The gate is not finished.\n")
        failures.append("T1")

    print("#" * 78)
    print("# T2  v16c -> v17 AS ON DISK   must NOT report it, and must SAY it is blind")
    print("#" * 78)
    _d, und2, blind2 = compare(Ref(EALL % "v16c"), Ref(EALL % "v17"))
    ok2 = "golden:db_switchgear:dbu3" not in und2 and bool(blind2)
    print(f"  dbu3 reported here: {'golden:db_switchgear:dbu3' in und2}  (expected False)")
    print(f"  blind-spot warning emitted: {bool(blind2)}  (expected True)")
    print("  T2 " + ("PASS -- the working-copy comparison declares itself blind.\n"
                     if ok2 else "**FAIL**\n"))
    if not ok2:
        failures.append("T2")

    print("#" * 78)
    print("# T3  v25 -> v26 AS MINTED   exactly the switches_point retirement, nothing else")
    print("#" * 78)
    print("  NB: both operands are COMMITS. Comparing working copies here would fold in")
    print("      any later edit to v26 and misattribute it to the mint (see T5).")
    dec3, und3, _b = compare(Ref(f"{_first_commit(EALL % 'v25')}:{EALL % 'v25'}"),
                             Ref(f"{_first_commit(EALL % 'v26')}:{EALL % 'v26'}"))
    counts: dict[str, int] = {}
    for atom in dec3:
        counts[atom.split(":")[0]] = counts.get(atom.split(":")[0], 0) + 1
    print(f"  declared breakdown: {counts}")
    ok3 = (not und3 and counts.get("cat") == 1 and counts.get("attr") == 12
           and counts.get("pipe") == 3 and counts.get("golden") == 1)
    print(f"  undeclared: {len(und3)} (expected 0); "
          f"1 category / 12 attrs / 3 pipelines / 1 golden: {ok3}")
    print("  T3 " + ("PASS\n" if ok3 else "**FAIL**\n"))
    if not ok3:
        failures.append("T3")

    print("#" * 78)
    print("# T4  the wiring asset -- its commits ARE its only history")
    print("#" * 78)
    rc4 = do_history(WIRING)
    print("  T4 " + ("PASS -- history walk completed\n" if rc4 in (0, 1) else "**FAIL**\n"))

    print("#" * 78)
    print("# T5  v26 AS COMMITTED -> v26 WORKING COPY   this slice's own CP1b repair")
    print("#" * 78)
    print("  The stale config-level goldens copy on switches_sockets was removed. The gate")
    print("  must report the lost CONFIG KEY and must NOT report a lost GOLDEN -- the")
    print("  top-level dict still supplies ss1, so the EFFECTIVE goldens never moved.")
    _d5, und5, _b5 = compare(Ref(f"{_first_commit(EALL % 'v26')}:{EALL % 'v26'}"),
                             Ref(EALL % "v26"))
    lost_g = [a for a in und5 if a.startswith(("golden:", "expect:"))]
    ok5 = sorted(und5) == ["cfgkey:switches_sockets:goldens"] and not lost_g
    print(f"  undeclared: {sorted(und5)}")
    print(f"  goldens/expect keys lost: {lost_g or 'none'}  (expected none)")
    print("  T5 " + ("PASS\n" if ok5 else "**FAIL**\n"))
    if not ok5:
        failures.append("T5")

    print("=" * 78)
    print("SELF-TEST: " + ("ALL PASS" if not failures else "FAILED: " + ", ".join(failures)))
    print("=" * 78)
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Rate-master mint-completeness gate.")
    ap.add_argument("old", nargs="?", help='OLD asset: "<rev>:<repo-path>" or a path')
    ap.add_argument("new", nargs="?", help='NEW asset: "<rev>:<repo-path>" or a path')
    ap.add_argument("--history", metavar="PATH", help="walk every commit of one asset")
    ap.add_argument("--self-test", action="store_true", help="run the T1-T5 calibration")
    args = ap.parse_args()

    if args.self_test:
        return do_self_test()
    if args.history:
        return do_history(args.history)
    if not (args.old and args.new):
        ap.print_help()
        return 2
    _d, und, _b = compare(Ref(args.old), Ref(args.new))
    return 1 if und else 0


if __name__ == "__main__":
    sys.exit(main())

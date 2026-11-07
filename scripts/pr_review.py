"""The plumbing of .github/workflows/claude-review.yml: the review's two Claude steps, and the owner's $0 commands.

The owner comments a command on a PR:

  /claude-review                       review the PR (a rerun reviews only the commits since the last review)
  /claude-review dismiss F3 <reason>   rule a finding out; it never blocks and is never reported again
  /claude-decide                       post the options (A merge into develop, B send back, C close), one recommended
  /claude-merge A|B|C                  carry out the chosen option, then lock the PR (one more decision after a B)

Only the review uses Claude, inside BUDGET_USD per PR. The workflow runs these subcommands from the root checkout:

  route     reads the command and the state and prints the action: review, or one the act job does for $0
            (a rerun whose new commits change none of the PR's files only refreshes)
  prepare   writes .pr-review-run/brief.md (and new-changes.diff on a rerun), the schemas and step 1's budget
  cost      adds one Claude step's measured cost, and why it failed, to .pr-review-run/costs.json and gives step
            2's budget
  number    gives step 1's new findings their ids and writes .pr-review-run/verify-brief.md for step 2
  publish   posts or edits the one review comment and rewrites the PR description
  fail      marks that comment as failed with the reason `cost` found, keeping the last checklist
  act       carries out refresh, dismiss, decide, merge, or a stop with its reason

The review comment is edited in place, and GitHub notifies nobody of an edit, so a send-back, or a rerun that adds
must or should findings to an existing comment, also posts one short new comment that tags the author.

Stdlib only. Environment: GITHUB_REPOSITORY and PR_NUMBER; COMMENT_BODY for route and act; REVIEW_OUTPUT (step 1)
for number and publish; VERIFY_OUTPUT (step 2) for publish; EXECUTION_FILE and STEP_CAP for cost.
ANTHROPIC_API_KEY, where set, is only read to keep it out of what is printed or posted. With --dry-run
nothing is written to GitHub: the comment and the body go to .pr-review-run/ and stdout, and a merge or close is
printed instead of run. --state-from <file> reads the state from a saved comment instead of the PR's.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, NamedTuple, TypedDict

RUN_DIR = Path(".pr-review-run")
PROMPT_DIR = Path(__file__).resolve().parent.parent / ".github" / "pr-review"
WORKFLOW_NAME = "Claude review"
BOT_LOGIN = "github-actions[bot]"
# abhishek0010's GitHub user id. A login can be renamed and later taken by someone else; the id cannot.
OWNER_ID = 8597417
MERGE_BASE = "develop"
MAX_NEW_FINDINGS = 7
# An open finding measured 2.5k to 3.1k characters in the dry runs (its list line plus its copy in the hidden
# state), so 10 open take about 31k of GitHub's 65,536-character comment limit. The rest holds about 50 fixed
# findings, which keep only their title.
MAX_OPEN_FINDINGS = 10
MAX_COMMENT_CHARS = 65536

BUDGET_USD = 2.50
# A Claude step given less is cut off before it can finish: the cheapest measured verify step took $0.23.
MIN_STEP_USD = 0.40
MAX_DECISIONS = 2

SECRET_ENV_VARS = ("ANTHROPIC_API_KEY", "GH_TOKEN", "GITHUB_TOKEN")
SECRET_PATTERNS = {
    "an Anthropic key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "a GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"),
}

COMMENT_MARKER = "<!-- claude-review -->"
STATE_PREFIX = "<!-- claude-review-state "
WALK_PREFIX = "<!-- claude-walk-report "
FOLD_MARKER = "<!-- claude-review-fold -->"
ORIGINAL_START = "<!-- claude-review-original -->"
ORIGINAL_END = "<!-- /claude-review-original -->"


class Tier(NamedTuple):
    key: str
    label: str
    blocking: bool


TIERS = (
    Tier("must", "Must fix", True),
    Tier("should", "Should fix", True),
    Tier("pre", "Pre-existing", False),
)
TIER_BY_KEY = {t.key: t for t in TIERS}
TIER_RANK = {t.key: rank for rank, t in enumerate(TIERS)}


class Finding(TypedDict):
    """A review finding. status is "open", "fixed" or "dismissed"; a dismissed one also has dismiss_reason."""
    id: str
    tier: str
    file: str
    line: int | None
    title: str
    why: str
    fix: str
    could_be_wrong_if: str
    status: str


CHECK_LABELS = {"merge": "Merge", "ci": "CI"}


class Check(TypedDict):
    name: str
    ok: bool
    detail: str


class Option(TypedDict):
    key: str
    action: str
    available: bool
    why: str


class Decision(TypedDict):
    """status is "proposed" until /claude-merge carries out `choice`, then "executed"."""
    status: str
    head_sha: str
    options: list[Option]
    recommended: str
    choice: str | None


class ReviewState(TypedDict):
    """Hidden in the review comment. spent_usd adds up every Claude step run on the PR, failed runs included."""
    version: int
    run: int
    spent_usd: float
    reviewed_sha: str | None
    findings: list[Finding]
    decision: Decision | None
    decisions_used: int
    locked: bool


class WalkRow(TypedDict):
    change: str
    seen: int
    failed: int
    not_walked: int


class WalkReport(TypedDict):
    """The owner's browser walk of a PR's screens, posted from his laptop by scripts/pr_walk_report.py."""
    head_sha: str
    url: str
    rows: list[WalkRow]
    walked_at: str


class ReviewOutput(TypedDict):
    description: str
    previous: list[dict]
    findings: list[dict]


class StepCost(TypedDict):
    """basis is "measured" (the log's result), "cap" (Claude answered but the log holds no cost) or "not_started"
    (no log, or one where Claude never answered: charged nothing, and the comment says the cost is unknown)."""
    step: str
    usd: float
    basis: str
    cut_off: bool


class RecordedCost(StepCost):
    """A StepCost as `cost` writes it to costs.json: reason is why the step failed, redacted, or ""."""
    reason: str


class Command(NamedTuple):
    """A parsed command. kind is review, dismiss, decide, merge or none; target is a finding id or an option key."""
    kind: str
    target: str = ""
    text: str = ""


class Route(NamedTuple):
    """What a command does now. action is review, refresh, dismiss, decide, merge or stop."""
    action: str
    reason: str = ""


def empty_state() -> ReviewState:
    """The state before the first review of a PR."""
    return {"version": 2, "run": 0, "spent_usd": 0.0, "reviewed_sha": None, "findings": [], "decision": None,
            "decisions_used": 0, "locked": False}


def upgrade_state(state: dict) -> ReviewState:
    """A version-1 state (run and findings only) read as version 2: nothing spent, reviewed or decided."""
    return {**empty_state(), **state, "version": 2}


def _read_hidden_json(body: str | None, prefix: str) -> object:
    """The JSON in the last hidden comment that starts with prefix, or None."""
    body = body or ""
    start = body.rfind(prefix)
    end = body.find("-->", start + len(prefix))
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(body[start + len(prefix):end])
    except json.JSONDecodeError:
        return None


def parse_state(comment_body: str | None) -> ReviewState:
    """Read the ReviewState hidden in a review comment; an absent or unreadable one is a fresh start."""
    state = _read_hidden_json(comment_body, STATE_PREFIX)
    if not isinstance(state, dict) or state.get("version") not in (1, 2):
        return empty_state()
    return upgrade_state(state)


def _hidden_json(prefix: str, value: dict) -> str:
    # A raw "-->" in a value would close the HTML comment early. "--" occurs in JSON text only inside strings,
    # where escaping the second hyphen leaves the decoded value unchanged.
    payload = json.dumps(value, separators=(",", ":")).replace("--", "-\\u002d")
    return f"{prefix}{payload} -->"


def state_marker(state: ReviewState) -> str:
    """The hidden comment that carries the state to the next run."""
    return _hidden_json(STATE_PREFIX, state)


def parse_review_output(raw: str) -> ReviewOutput:
    """Parse step 1's structured output, refusing a finding with an unknown tier."""
    review = json.loads(raw)
    for key in ("description", "previous", "findings"):
        if key not in review:
            raise ValueError(f"step 1 output has no {key!r}")
    for finding in review["findings"]:
        if finding.get("tier") not in TIER_BY_KEY:
            raise ValueError(f"step 1 finding has an unknown tier: {finding.get('tier')!r}")
    return review


def parse_verdicts(raw: str | None) -> dict[str, bool]:
    """Map each finding id to step 2's keep verdict; step 2 is skipped when there is nothing new."""
    if not raw:
        return {}
    return {v["id"]: bool(v["keep"]) for v in json.loads(raw)["verdicts"]}


def _id_number(finding_id: str) -> int:
    return int(finding_id.lstrip("F"))


def number_findings(new: list[dict], state: ReviewState) -> list[Finding]:
    """Give new findings ids after the last run's, most severe first."""
    first = 1 + max((_id_number(f["id"]) for f in state["findings"]), default=0)
    ordered = sorted(new, key=lambda f: TIER_RANK[f["tier"]])
    return [
        {
            "id": f"F{first + i}",
            "tier": f["tier"],
            "file": f["file"],
            "line": f.get("line"),
            "title": f["title"],
            "why": f["why"],
            "fix": f["fix"],
            "could_be_wrong_if": f["could_be_wrong_if"],
            "status": "open",
        }
        for i, f in enumerate(ordered)
    ]


def _with_status(f: Finding, status: str) -> Finding:
    # A closed finding renders as its title alone, so its long text leaves the state and the comment stays under
    # GitHub's 65,536-character limit across reruns.
    if status in ("fixed", "dismissed"):
        return {**f, "status": status, "why": "", "fix": "", "could_be_wrong_if": ""}
    return {**f, "status": status}


def merge(state: ReviewState, previous: list[dict], numbered: list[Finding], keep: dict[str, bool]) -> ReviewState:
    """The next state: the last run's findings with their new status, plus the new findings step 2 kept, at most 7
    and only while fewer than 10 are open. A finding left out is found again on a later run."""
    status = {p["id"]: p["status"] for p in previous}
    carried = [_with_status(f, status.get(f["id"], "open")) if f["status"] == "open" else f for f in state["findings"]]
    room = MAX_OPEN_FINDINGS - sum(1 for f in carried if f["status"] == "open")
    kept = [f for f in numbered if keep.get(f["id"], False)][:max(0, min(MAX_NEW_FINDINGS, room))]
    return {**state, "run": state["run"] + 1, "findings": carried + kept}


def _executed_decision(state: ReviewState) -> Decision | None:
    decision = state["decision"]
    return decision if decision and decision["status"] == "executed" else None


def after_review(state: ReviewState, reviewed_sha: str) -> ReviewState:
    """A finished review covers reviewed_sha. A proposed decision was made on an older head, so it goes."""
    return {**state, "reviewed_sha": reviewed_sha, "decision": _executed_decision(state)}


def add_spent(state: ReviewState, costs: list[StepCost]) -> ReviewState:
    """The state with this run's Claude steps paid for."""
    return {**state, "spent_usd": round(state["spent_usd"] + sum(c["usd"] for c in costs), 6)}


def dismiss(state: ReviewState, finding_id: str, reason: str) -> ReviewState:
    """Rule an open finding out. A proposed decision was built with it open, so it goes."""
    findings = [{**_with_status(f, "dismissed"), "dismiss_reason": reason} if f["id"] == finding_id else f
                for f in state["findings"]]
    return {**state, "findings": findings, "decision": _executed_decision(state)}


def open_blocking_ids(state: ReviewState) -> list[str]:
    """The ids of open must and should findings."""
    return [f["id"] for f in state["findings"] if f["status"] == "open" and TIER_BY_KEY[f["tier"]].blocking]


COMMAND_PATTERNS = (
    ("review", re.compile(r"/claude-review")),
    ("dismiss", re.compile(r"/claude-review\s+dismiss\s+([Ff]\d+)(?:\s+(.*))?", re.S)),
    ("decide", re.compile(r"/claude-decide")),
    ("merge", re.compile(r"/claude-merge\s+([ABCabc])(?:\s+(.*))?", re.S)),
)
USAGE = ("unknown command. The commands are `/claude-review`, `/claude-review dismiss F<n> <reason>`, "
         "`/claude-decide` and `/claude-merge A|B|C`")


def parse_command(body: str | None) -> Command:
    """The command a comment gives. Anything but an exact command is `none`, so a typo never starts a paid run."""
    text = (body or "").strip()
    for kind, pattern in COMMAND_PATTERNS:
        match = pattern.fullmatch(text)
        if match:
            groups = match.groups()
            return Command(kind, groups[0].upper() if groups else "", _one_line(groups[1] or "") if groups else "")
    return Command("none")


def remaining_budget(state: ReviewState) -> float:
    """What the PR may still spend on Claude."""
    return BUDGET_USD - state["spent_usd"]


def step_cap(remaining: float) -> str:
    """The --max-budget-usd for a Claude step, rounded down to the cent, or "" when too little is left to run one."""
    cents = math.floor(round(remaining * 100, 6))
    return f"{cents / 100:.2f}" if cents >= round(MIN_STEP_USD * 100) else ""


def budget_used_text(state: ReviewState) -> str:
    return f"budget used: ${state['spent_usd']:.2f} of ${BUDGET_USD:.2f}"


def _route_review(cmd: Command, state: ReviewState, head_sha: str, files_since_review: int | None) -> Route:
    if state["reviewed_sha"] == head_sha or files_since_review == 0:
        return Route("refresh")
    if not step_cap(remaining_budget(state)):
        return Route("stop", budget_used_text(state))
    return Route("review")


def _route_dismiss(cmd: Command, state: ReviewState, head_sha: str, files_since_review: int | None) -> Route:
    finding = next((f for f in state["findings"] if f["id"] == cmd.target), None)
    if not finding or finding["status"] != "open":
        return Route("stop", f"{cmd.target} is not an open finding")
    if not cmd.text:
        return Route("stop", f"give a reason: `/claude-review dismiss {cmd.target} <reason>`")
    return Route("dismiss")


def _route_decide(cmd: Command, state: ReviewState, head_sha: str, files_since_review: int | None) -> Route:
    return Route("decide")


def _route_merge(cmd: Command, state: ReviewState, head_sha: str, files_since_review: int | None) -> Route:
    decision = state["decision"]
    if not decision or decision["status"] != "proposed":
        return Route("stop", "there is no decision to carry out, comment `/claude-decide` first")
    if decision["head_sha"] != head_sha:
        return Route("stop", "new commits since the decision, run `/claude-decide` again")
    option = next(o for o in decision["options"] if o["key"] == cmd.target)
    if not option["available"]:
        return Route("stop", f"option {cmd.target} is not available: {option['why']}")
    return Route("merge")


ROUTERS: dict[str, Callable[[Command, ReviewState, str, int | None], Route]] = {
    "review": _route_review,
    "dismiss": _route_dismiss,
    "decide": _route_decide,
    "merge": _route_merge,
}


def route(cmd: Command, state: ReviewState, head_sha: str, pr_open: bool,
          files_since_review: int | None = None) -> Route:
    """What the command does on this PR now. Only `review` runs Claude. files_since_review counts the PR's own
    files changed since the reviewed commit (None when unknown); 0, as after merging in the base, only refreshes."""
    if cmd.kind == "none":
        return Route("stop", USAGE)
    if state["locked"]:
        return Route("stop", "this PR is locked, its decision was carried out")
    if not pr_open:
        return Route("stop", "the PR is not open")
    return ROUTERS[cmd.kind](cmd, state, head_sha, files_since_review)


def _log_messages(log: str) -> list[dict] | None:
    """The messages in an execution file's text, or None when it is not JSON."""
    try:
        parsed = json.loads(log)
    except json.JSONDecodeError:
        return None
    return [m for m in (parsed if isinstance(parsed, list) else [parsed]) if isinstance(m, dict)]


def step_cost(step: str, log: str | None, cap: float) -> StepCost:
    """One Claude step's cost from the text of the action's execution file (the run's messages, ending in a
    result), or None when the step wrote none."""
    # The action writes the file only after Claude ends or errors. No file means the step failed before Claude
    # (a bad flag, a failed install, a missing key) or its timeout killed it; charging the cap would use up the
    # PR's budget for a step that may have cost nothing, so it is charged 0 and the comment says so.
    not_started: StepCost = {"step": step, "usd": 0.0, "basis": "not_started", "cut_off": False}
    charged_cap: StepCost = {"step": step, "usd": cap, "basis": "cap", "cut_off": False}
    if log is None:
        return not_started
    messages = _log_messages(log)
    if messages is None:
        return charged_cap
    results = [m for m in messages if m.get("type") == "result" and isinstance(m.get("total_cost_usd"), (int, float))]
    if results:
        last = results[-1]
        return {"step": step, "usd": float(last["total_cost_usd"]), "basis": "measured",
                "cut_off": last.get("subtype") == "error_max_budget_usd"}
    return charged_cap if any(m.get("type") in ("assistant", "result") for m in messages) else not_started


MAX_REASON_CHARS = 300
API_ERROR_TEXT = re.compile(r"API Error|API key|x-api-key|credit balance|_error\b", re.I)


def _assistant_text(message: dict) -> str:
    content = (message.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    return " ".join(b["text"] for b in content or [] if isinstance(b, dict) and isinstance(b.get("text"), str))


def _failure_text(messages: list[dict]) -> str:
    results = [m for m in messages if m.get("type") == "result"]
    last = results[-1] if results else {}
    if results and last.get("is_error") is not True:
        return ""
    if isinstance(last.get("result"), str) and last["result"].strip():
        return last["result"]
    assistants = [m for m in messages if m.get("type") == "assistant"]
    if assistants and API_ERROR_TEXT.search(text := _assistant_text(assistants[-1])):
        return text
    return "; ".join(e for e in last.get("errors") or [] if isinstance(e, str))


def redact(text: str, env: dict[str, str]) -> str:
    """text with this job's credentials and anything shaped like a token replaced by [redacted]."""
    for name in SECRET_ENV_VARS:
        if len(env.get(name) or "") >= 8:
            text = text.replace(env[name], "[redacted]")
    for pattern in SECRET_PATTERNS.values():
        text = pattern.sub("[redacted]", text)
    return text


def failure_reason(log: str | None, env: dict[str, str]) -> str:
    """Why a Claude step failed, from its execution file: the error result's text, else the last assistant message
    when it reads as an API error, else the result's errors. One line, redacted, at most 300 characters; "" when
    the step did not fail or the file says nothing."""
    # The action logs only a summary of the result message, without its text, and the repo's logs are public.
    messages = _log_messages(log) if log else None
    reason = redact(_one_line(_failure_text(messages or [])), env)
    return reason if len(reason) <= MAX_REASON_CHARS else reason[:MAX_REASON_CHARS - 1] + "…"


def cost_notices(costs: list[StepCost]) -> list[str]:
    """A footer notice for each step whose cost is unknown."""
    return [f"cost unknown: the {c['step']} step did not start, or its timeout stopped it"
            for c in costs if c["basis"] == "not_started"]


class CiTally(NamedTuple):
    failed: list[str]
    pending: int
    passed: int


def ci_tally(pr: dict) -> CiTally:
    """The PR's checks other than this workflow's, sorted into failed (by name), still running and passed."""
    failed, pending, passed = [], 0, 0
    for run in pr.get("statusCheckRollup") or []:
        if run.get("workflowName") == WORKFLOW_NAME:
            continue
        name = run.get("name") or run.get("context") or "unnamed check"
        if run.get("workflowName"):
            name = f"{run['workflowName']} / {name}"
        outcome = run.get("conclusion") or run.get("state") or ""
        if outcome in ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"):
            failed.append(name)
        elif run.get("status", "COMPLETED") != "COMPLETED" or outcome in ("PENDING", "EXPECTED", ""):
            pending += 1
        else:
            passed += 1
    return CiTally(failed, pending, passed)


def checks_from_pr(pr: dict) -> list[Check]:
    """The plain checks, read from `gh pr view --json mergeable,statusCheckRollup,...`."""
    base = pr.get("baseRefName", "the base branch")
    mergeable = pr.get("mergeable")
    if mergeable == "CONFLICTING":
        merge_check = Check(name="merge", ok=False, detail=f"Conflicts with `{base}`. Merge `{base}` in and resolve them.")
    elif mergeable == "MERGEABLE":
        behind = " The branch is behind it." if pr.get("mergeStateStatus") == "BEHIND" else ""
        merge_check = Check(name="merge", ok=True, detail=f"No conflicts with `{base}`.{behind}")
    else:
        merge_check = Check(name="merge", ok=True, detail="GitHub has not finished checking for conflicts.")

    failed, pending, passed = ci_tally(pr)
    if failed:
        ci_detail = f"{len(failed)} failed: {', '.join(failed)}."
    elif pending:
        ci_detail = f"{pending} still running, {passed} passed."
    elif passed:
        ci_detail = f"All {passed} passed."
    else:
        ci_detail = "No checks reported."
    return [merge_check, Check(name="ci", ok=not failed, detail=ci_detail)]


def _is_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_walk_row(row: object) -> bool:
    return (isinstance(row, dict) and isinstance(row.get("change"), str)
            and all(_is_count(row.get(k)) for k in ("seen", "failed", "not_walked")))


def parse_walk_report(body: str | None) -> WalkReport | None:
    """The WalkReport hidden in a comment, or None when it has none or it is malformed."""
    report = _read_hidden_json(body, WALK_PREFIX)
    if not isinstance(report, dict) or not isinstance(report.get("head_sha"), str):
        return None
    rows = report.get("rows")
    if not isinstance(rows, list) or not rows or not all(_is_walk_row(row) for row in rows):
        return None
    return report


def trusted_walk_reports(comments: list[dict]) -> list[WalkReport]:
    """The walk reports the owner posted, oldest first. Anyone else's are ignored."""
    reports = []
    for comment in comments:
        if (comment.get("user") or {}).get("id") != OWNER_ID:
            continue
        report = parse_walk_report(comment.get("body"))
        if report:
            reports.append(report)
    return reports


def walk_blocker(reports: list[WalkReport], head_sha: str, changes_frontend: bool,
                 frontend_changed_since: Callable[[str], bool | None]) -> str:
    """Why the owner's walk does not cover the PR's screens, or "" when it does or the PR changes none.
    frontend_changed_since(sha) says whether commits after sha change frontend/, or None when sha is not behind
    the head (the branch was rewritten)."""
    if not changes_frontend:
        return ""
    if not reports:
        return "no walk report for the frontend changes"
    latest = reports[-1]
    failed = sum(row["failed"] for row in latest["rows"])
    if failed:
        return f"the walk report has {failed} failed {'row' if failed == 1 else 'rows'}"
    if latest["head_sha"] == head_sha:
        return ""
    changed = frontend_changed_since(latest["head_sha"])
    if changed is None:
        return "the walked commit is not in the branch's history any more"
    return "frontend files changed since the walk" if changed else ""


def render_walk_report(report: WalkReport) -> str:
    """The walk report comment: the hidden marker the bot reads, and a table for people."""
    totals = {k: sum(row[k] for row in report["rows"]) for k in ("seen", "failed", "not_walked")}
    lines = [
        _hidden_json(WALK_PREFIX, report),
        f"**Walk report** for `{report['head_sha'][:9]}` · [evidence]({report['url']}) · {report['walked_at']}",
        "",
        "| Change | Seen | Failed | Not walked |",
        "|---|---|---|---|",
        *[f"| {_one_line(row['change']).replace('|', '/')} | {row['seen']} | {row['failed']} | {row['not_walked']} |"
          for row in report["rows"]],
        f"| **Total** | {totals['seen']} | {totals['failed']} | {totals['not_walked']} |",
    ]
    return "\n".join(lines)


class OptionSpec(NamedTuple):
    key: str
    action: str
    label: str
    done: str


OPTIONS = (
    OptionSpec("A", "merge", f"Merge into `{MERGE_BASE}`", f"merged into `{MERGE_BASE}`"),
    OptionSpec("B", "send_back", "Send back to the author", "sent back to the author"),
    OptionSpec("C", "close", "Close without merging", "closed without merging"),
)
OPTION_BY_KEY = {o.key: o for o in OPTIONS}
LOCKING_ACTIONS = {"merge", "close"}


class MergeFacts(NamedTuple):
    """What decides whether option A is open, read from GitHub and the state."""
    base: str
    mergeable: str
    ci: CiTally
    open_blocking: list[str]
    reviewed_head: bool
    walk: str


def _base_rule(f: MergeFacts) -> str:
    return "" if f.base == MERGE_BASE else f"the base is `{f.base}`, not `{MERGE_BASE}`"


def _conflict_rule(f: MergeFacts) -> str:
    if f.mergeable == "MERGEABLE":
        return ""
    if f.mergeable == "CONFLICTING":
        return "conflicts with the base"
    return "GitHub has not finished checking for conflicts"


def _ci_rule(f: MergeFacts) -> str:
    if f.ci.failed:
        return f"CI failing: {', '.join(f.ci.failed)}"
    if f.ci.pending:
        return f"CI still running ({f.ci.pending})"
    return "" if f.ci.passed else "no CI results"


def _findings_rule(f: MergeFacts) -> str:
    return f"open findings: {', '.join(f.open_blocking)}" if f.open_blocking else ""


def _review_rule(f: MergeFacts) -> str:
    return "" if f.reviewed_head else "no review of the current head"


def _walk_rule(f: MergeFacts) -> str:
    return f.walk


MERGE_RULES = (_base_rule, _conflict_rule, _ci_rule, _findings_rule, _review_rule, _walk_rule)


def merge_blockers(facts: MergeFacts) -> list[str]:
    """Each reason option A is closed, in MERGE_RULES order."""
    return [reason for rule in MERGE_RULES if (reason := rule(facts))]


def build_options(facts: MergeFacts, author: str, decisions_used: int) -> list[Option]:
    """Options A, B and C with why each is or is not the move. B and C are always open while the PR is unlocked."""
    blockers = merge_blockers(facts)
    last = decisions_used + 1 >= MAX_DECISIONS
    back = (f"Tag @{author} with what is left. The last decision: the PR locks after it."
            if last else f"Tag @{author} with what is left; one more decision after their fixes.")
    return [
        {"key": "A", "action": "merge", "available": not blockers,
         "why": "; ".join(blockers) if blockers else "CI passing, nothing blocking, reviewed at this head."},
        {"key": "B", "action": "send_back", "available": True, "why": back},
        {"key": "C", "action": "close", "available": True, "why": "The PR closes with a one-line reason."},
    ]


def recommend(options: list[Option]) -> str:
    """A when it is open, else B."""
    return "A" if options[0]["available"] else "B"


def propose(state: ReviewState, head_sha: str, options: list[Option]) -> ReviewState:
    """The state with a proposed decision. Proposing again before a choice only refreshes it."""
    decision: Decision = {"status": "proposed", "head_sha": head_sha, "options": options,
                          "recommended": recommend(options), "choice": None}
    return {**state, "decision": decision}


def locks_after(action: str, decisions_used: int) -> bool:
    """A merge or a close locks the PR, and so does the last decision allowed."""
    return action in LOCKING_ACTIONS or decisions_used >= MAX_DECISIONS


def carry_out(state: ReviewState, key: str, options: list[Option]) -> ReviewState:
    """The state after the chosen option was carried out, with the options as they stood then."""
    used = state["decisions_used"] + 1
    decision: Decision = {**state["decision"], "status": "executed", "choice": key, "options": options}
    return {**state, "decision": decision, "decisions_used": used,
            "locked": locks_after(OPTION_BY_KEY[key].action, used)}


def _one_line(text: str) -> str:
    return " ".join(str(text).split())


def _location(f: Finding) -> str:
    return f"`{f['file']}:{f['line']}`" if f.get("line") else f"`{f['file']}`"


def _render_finding(f: Finding) -> str:
    head = f"**{TIER_BY_KEY[f['tier']].label}** · {f['id']} · {_location(f)} · {_one_line(f['title'])}"
    if f["status"] == "fixed":
        return f"- [x] ~~{head}~~ Fixed."
    if f["status"] == "dismissed":
        return f"- [x] ~~{head}~~ Dismissed: {_one_line(f.get('dismiss_reason', ''))}"
    return (
        f"- [ ] {head}<br>**Why:** {_one_line(f['why'])}<br>**Fix:** {_one_line(f['fix'])}"
        f"<br>**Could be wrong if:** {_one_line(f['could_be_wrong_if'])}"
    )


def _display_order(f: Finding) -> tuple:
    return (f["status"] != "open", TIER_RANK[f["tier"]], _id_number(f["id"]))


def author_items(state: ReviewState, checks: list[Check]) -> list[str]:
    """What the author can fix: failing plain checks (a conflict, failed CI) and open must and should findings.
    The owner's own blockers (no review of the head, no walk report, CI still running) are not the author's."""
    items = [f"{CHECK_LABELS[c['name']]}: {c['detail']}" for c in checks if not c["ok"]]
    blocking = [f for f in state["findings"] if f["status"] == "open" and TIER_BY_KEY[f["tier"]].blocking]
    items += [f"{f['id']} · {TIER_BY_KEY[f['tier']].label} · {_one_line(f['title'])}"
              for f in sorted(blocking, key=_display_order)]
    return items


def _sent_back(state: ReviewState) -> bool:
    decision = _executed_decision(state)
    return bool(decision) and OPTION_BY_KEY[decision["choice"]].action == "send_back"


def _after_send_back(state: ReviewState) -> str:
    if state["locked"]:
        return "That was the last decision: the PR is locked."
    return "Push the fixes, and the owner decides once more."


def _render_decision(state: ReviewState, author: str, items: list[str]) -> list[str]:
    decision = state["decision"]
    if not decision:
        return []
    if decision["status"] == "proposed":
        lines = [f"**Decision** for `{decision['head_sha'][:9]}` "
                 f"(decision {state['decisions_used'] + 1} of {MAX_DECISIONS})", ""]
        for option in decision["options"]:
            pick = " **Recommended.**" if option["key"] == decision["recommended"] else ""
            why = option["why"] if option["available"] else f"Not available: {option['why']}."
            lines.append(f"- **{option['key']}** · {OPTION_BY_KEY[option['key']].label}.{pick} {why}")
        replies = " or ".join(f"`/claude-merge {o['key']}`" for o in decision["options"] if o["available"])
        return lines + ["", f"Reply {replies}.", ""]
    spec = OPTION_BY_KEY[decision["choice"]]
    lines = [f"**Decision {state['decisions_used']} of {MAX_DECISIONS}:** {spec.key}, {spec.done} "
             f"at `{decision['head_sha'][:9]}`."]
    if spec.action == "send_back" and items:
        lines.append(f"@{author}, to fix: {'; '.join(item.rstrip('.') for item in items)}. {_after_send_back(state)}")
    elif spec.action == "send_back":
        lines.append(f"@{author}, the owner sent this back. See his comments. {_after_send_back(state)}")
    return lines + [""]


def _checklist_link(url: str | None) -> str:
    return f"[the review checklist]({url})" if url else "the review checklist"


def author_notice(before: ReviewState, after: ReviewState, author: str, checks: list[Check],
                  checklist: dict | None) -> str:
    """The one new comment a run posts to tag the author, or "" when it needs none. checklist is the review
    comment as it was before the run, None when the run creates it."""
    # GitHub notifies nobody of an edited comment, so a send-back or a rerun's new findings written only into the
    # existing checklist would never reach the author. A newly created checklist notifies by itself.
    link = _checklist_link((checklist or {}).get("html_url"))
    if after["decisions_used"] > before["decisions_used"] and _sent_back(after):
        items = author_items(after, checks)
        if not items:
            return f"@{author}, the owner sent this PR back. See his comments and {link}. {_after_send_back(after)}"
        return "\n".join([f"@{author}, the owner sent this PR back. To fix:", "",
                          *[f"- {item}" for item in items], "",
                          f"{_after_send_back(after)} The full list is in {link}."])
    known = {f["id"] for f in before["findings"]}
    added = [i for i in open_blocking_ids(after) if i not in known]
    if not added or not checklist:
        return ""
    noun = "item" if len(added) == 1 else "items"
    return f"@{author}, review run {after['run']} found {len(added)} new {noun} to fix: {', '.join(added)}. See {link}."


def _headline(author: str, state: ReviewState, blocking: int, head_sha: str | None, failed: bool,
              out_of_budget: bool, run_url: str, reason: str) -> str:
    if out_of_budget:
        return f"This review run stopped: the ${BUDGET_USD:.2f} budget ran out, [see the log]({run_url})."
    if failed:
        earlier = f" The list below is from run {state['run']}." if state["run"] else ""
        if reason:
            return f'This review run failed: Anthropic said "{reason}". [See the log]({run_url}).{earlier}'
        return f"This review run failed, [see the log]({run_url}).{earlier}"
    if state["locked"]:
        return f"This PR is locked: {OPTION_BY_KEY[state['decision']['choice']].done} by the owner's decision."
    if _sent_back(state) and state["decision"]["head_sha"] == head_sha:
        if not blocking:
            return f"@{author}, the owner sent this PR back. See the decision below."
        noun = "item needs" if blocking == 1 else "items need"
        return f"@{author}, the owner sent this PR back: {blocking} {noun} your attention."
    if blocking:
        noun = "item needs" if blocking == 1 else "items need"
        return f"@{author}, {blocking} {noun} your attention."
    if head_sha and state["reviewed_sha"] == head_sha:
        return f"@{author}, nothing blocking: ready to merge. The owner can comment `/claude-decide`."
    return f"@{author}, nothing blocking from this review."


def _footer(state: ReviewState, run_url: str, failed: bool, notice: str) -> str:
    if failed:
        parts = ["Comment `/claude-review` to try again"]
    elif state["run"]:
        parts = [f"Review run {state['run']}", f"[log]({run_url})"]
    else:
        parts = ["No review yet"]
    parts.append(f"spent ${state['spent_usd']:.2f} of ${BUDGET_USD:.2f}")
    if notice:
        parts.append(notice)
    if not state["locked"] and not failed:
        parts.append("Commands: `/claude-review`, `/claude-review dismiss F<n> <reason>`, `/claude-decide`")
    return f"<sub>{' · '.join(parts)}</sub>"


def render_comment(author: str, state: ReviewState, checks: list[Check], run_url: str, failed: bool = False, *,
                   head_sha: str | None = None, notice: str = "", out_of_budget: bool = False, reason: str = "") -> str:
    """The one review comment: headline, plain checks, findings, decision, footer and the hidden state. reason is
    why a failed run's Claude step failed, already redacted."""
    items = author_items(state, checks)
    failed = failed or out_of_budget

    lines = [COMMENT_MARKER, _headline(author, state, len(items), head_sha, failed, out_of_budget, run_url, reason), ""]
    if checks:
        lines += ["**Checks**", ""]
        lines += [f"- [{'x' if c['ok'] else ' '}] {CHECK_LABELS[c['name']]}: {c['detail']}" for c in checks]
        lines.append("")
    if state["findings"]:
        lines += ["**Findings**", ""]
        lines += [_render_finding(f) for f in sorted(state["findings"], key=_display_order)]
        lines.append("")
    elif not failed:
        lines += ["No findings.", ""]
    lines += _render_decision(state, author, items)
    lines.append(_footer(state, run_url, failed, notice))
    lines.append(state_marker(state))
    return "\n".join(lines)


def split_body(body: str | None) -> tuple[str, str]:
    """Split a PR body into (the description above the fold, the author's original description)."""
    body = body or ""
    fold = body.find(FOLD_MARKER)
    start = body.find(ORIGINAL_START, fold)
    end = body.rfind(ORIGINAL_END)
    if fold == -1 or start == -1 or end < start:
        return body, body
    return body[:fold].rstrip(), body[start + len(ORIGINAL_START):end].strip("\n")


def rewrite_body(description: str, current_body: str | None) -> str:
    """Claude's description, with the author's first original folded under it. A rerun never nests the fold."""
    _, original = split_body(current_body)
    note = "" if original.strip() else "_The author left no description._\n"
    return (
        f"{description.rstrip()}\n\n{FOLD_MARKER}\n<details><summary>Original description</summary>\n\n"
        f"{ORIGINAL_START}\n{original}\n{ORIGINAL_END}\n{note}\n</details>\n"
    )


def fence(text: str) -> str:
    """Fence untrusted text so no backtick run inside it can close the block."""
    longest = max((len(m) for m in re.findall(r"`+", text)), default=0)
    ticks = "`" * max(3, longest + 1)
    return f"{ticks}text\n{text}\n{ticks}"


def _finding_brief(f: Finding) -> str:
    return (
        f"- **{f['id']}** [{f['tier']}] {_location(f)}: {_one_line(f['title'])}\n"
        f"  Why: {_one_line(f['why'])}\n  Fix: {_one_line(f['fix'])}\n"
        f"  Could be wrong if: {_one_line(f['could_be_wrong_if'])}"
    )


class Rerun(NamedTuple):
    since_sha: str
    files: int


def incremental_diff(compare: dict | None, pr_files: set[str]) -> tuple[str, Rerun] | None:
    """The PR's changes since the last review, from GitHub's compare of the reviewed commit to the head, kept to
    the files the PR changes (a merge of the base brings others). None asks for a full review: the branch was
    rewritten, or the compare is missing or cut at GitHub's 300 files."""
    if not compare or compare.get("status") != "ahead":
        return None
    files = compare.get("files") or []
    if len(files) >= 300:
        return None
    parts = []
    for f in files:
        if f["filename"] not in pr_files:
            continue
        old = f.get("previous_filename") or f["filename"]
        patch = f.get("patch") or "(no text diff: binary or too large; read the file in pr-head/)"
        parts.append(f"diff --git a/{old} b/{f['filename']}\n--- a/{old}\n+++ b/{f['filename']}\n{patch}\n")
    return "".join(parts), Rerun(compare["base_commit"]["sha"], len(parts))


def render_brief(repo: str, pr: dict, state: ReviewState, checks: list[Check], rerun: Rerun | None = None) -> str:
    """Step 1's brief: the PR, the plain checks, the open findings and the description(s), as data."""
    number = pr["number"]
    current, original = split_body(pr.get("body"))
    open_findings = [f for f in state["findings"] if f["status"] == "open"]
    dismissed = [f for f in state["findings"] if f["status"] == "dismissed"]
    lines = [
        f"# Review brief for PR #{number}",
        "",
        f"- Repository: `{repo}`",
        f"- Title: {_one_line(pr.get('title', ''))}",
        f"- Author: @{pr['author']['login']}",
        f"- Base branch: `{pr.get('baseRefName')}`, head branch: `{pr.get('headRefName')}`",
        f"- Size: +{pr.get('additions', 0)} -{pr.get('deletions', 0)} in {pr.get('changedFiles', 0)} files",
        f"- Diff: run `gh pr diff {number} --repo {repo}`",
        "- The PR's code, read-only: `pr-head/`. The rules and prompts: this folder (the default branch).",
        "",
    ]
    if rerun:
        lines += [
            "## Changes since the last review",
            "",
            f"This is a rerun. The last review covered commit `{rerun.since_sha[:9]}`. The PR's changes since then, "
            f"in {rerun.files} {'file' if rerun.files == 1 else 'files'}, are in `.pr-review-run/new-changes.diff`. "
            "Follow the prompt's \"A rerun\" section.",
            "",
        ]
    lines += [
        "## Plain checks (already shown to the author; do not repeat them as findings)",
        "",
        *[f"- {c['name']}: {'ok' if c['ok'] else 'NOT OK'}. {c['detail']}" for c in checks],
        "",
        f"## Open findings from the last review (run {state['run']})",
        "",
    ]
    if open_findings:
        lines += [_finding_brief(f) for f in open_findings]
    else:
        lines.append("None. Return an empty `previous` list.")
    if dismissed:
        lines += ["", "## Dismissed findings (the owner ruled these out; never report them again, even reworded)", ""]
        lines += [f"- **{f['id']}** {_location(f)}: {_one_line(f['title'])} "
                  f"Reason: {_one_line(f.get('dismiss_reason', ''))}" for f in dismissed]
    if current != original:
        lines += ["", "## Current description (written by the last review run; the author may have edited it)", "",
                  fence(current)]
    lines += ["", "## Original description (the author's, verbatim)", "", fence(original or "(empty)"), ""]
    return "\n".join(lines)


def render_verify_brief(repo: str, number: int, findings: list[Finding]) -> str:
    """Step 2's brief: the new findings to check, with their ids."""
    return "\n".join([
        f"# Verify brief for PR #{number}",
        "",
        f"- Diff: run `gh pr diff {number} --repo {repo}`",
        "- The PR's code, read-only: `pr-head/`.",
        "",
        "## New findings to check",
        "",
        *[_finding_brief(f) for f in findings],
        "",
    ])


def compact_schema(name: str) -> str:
    """A schema file as one line, safe inside the single quotes of the workflow's claude_args."""
    text = json.dumps(json.loads((PROMPT_DIR / name).read_text()), separators=(",", ":"))
    if "'" in text:
        raise ValueError(f"{name} must not contain a single quote")
    return text


def refuse_secrets(text: str, env: dict[str, str]) -> None:
    """Refuse text for GitHub that holds this job's credentials or anything shaped like a token."""
    # Claude's text comes from a run that read untrusted PR content; an injected instruction could make it copy a
    # credential into what this script posts publicly. The message names what matched, never the value.
    found = [name for name in SECRET_ENV_VARS if len(env.get(name) or "") >= 8 and env[name] in text]
    found += [label for label, pattern in SECRET_PATTERNS.items() if pattern.search(text)]
    if found:
        raise ValueError(f"refusing to post to GitHub: the text holds {', '.join(found)}")


def check_comment_size(body: str) -> None:
    """Refuse a comment GitHub would reject for its length."""
    if len(body) >= MAX_COMMENT_CHARS:
        raise ValueError(f"the review comment is {len(body)} characters; GitHub takes fewer than {MAX_COMMENT_CHARS}")


def gh(args: list[str], payload: dict | None = None, check: bool = True) -> str | None:
    """Run gh. A failure ends the step with gh's own message, or returns None when check is False. Every write
    to GitHub with Claude's text sends it as a payload through here."""
    if payload is not None:
        refuse_secrets(json.dumps(payload, ensure_ascii=False), dict(os.environ))
    result = subprocess.run(["gh", *args], input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True)
    if result.returncode != 0:
        if not check:
            return None
        sys.exit(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result.stdout


PR_FIELDS = ("number,title,body,author,baseRefName,headRefName,headRefOid,state,additions,deletions,changedFiles,"
             "mergeable,mergeStateStatus,statusCheckRollup")


def fetch_pr(repo: str, number: int) -> dict:
    """The PR, waiting a little while GitHub works out whether it merges."""
    for attempt in range(5):
        pr = json.loads(gh(["pr", "view", str(number), "--repo", repo, "--json", PR_FIELDS]))
        if pr.get("mergeable") != "UNKNOWN":
            break
        time.sleep(3 * (attempt + 1))
    return pr


def fetch_comments(repo: str, number: int) -> list[dict]:
    """Every comment on the PR's conversation, oldest first."""
    pages = json.loads(gh(["api", "--paginate", "--slurp", f"repos/{repo}/issues/{number}/comments"]))
    return [c for page in pages for c in page]


def review_comment(comments: list[dict]) -> dict | None:
    """The bot's review comment, if it has one."""
    mine = [c for c in comments
            if (c.get("user") or {}).get("login") == BOT_LOGIN and (c.get("body") or "").startswith(COMMENT_MARKER)]
    return mine[-1] if mine else None


def fetch_pr_files(repo: str, number: int) -> set[str]:
    """The paths the PR changes."""
    pages = json.loads(gh(["api", "--paginate", "--slurp", f"repos/{repo}/pulls/{number}/files"]))
    return {f["filename"] for page in pages for f in page}


def fetch_compare(repo: str, base: str, head: str) -> dict | None:
    """GitHub's compare of two commits, or None when it has no such base (a force push dropped it)."""
    raw = gh(["api", f"repos/{repo}/compare/{base}...{head}"], check=False)
    return json.loads(raw) if raw else None


def post_comment(repo: str, number: int, body: str) -> None:
    """Add a new comment to the PR."""
    gh(["api", "--method", "POST", f"repos/{repo}/issues/{number}/comments", "--input", "-"], {"body": body})


def save_comment(repo: str, number: int, existing: dict | None, body: str) -> None:
    """Edit the review comment, or create it on the first run."""
    check_comment_size(body)
    if existing:
        gh(["api", "--method", "PATCH", f"repos/{repo}/issues/comments/{existing['id']}", "--input", "-"], {"body": body})
    else:
        post_comment(repo, number, body)


def save_pr_body(repo: str, number: int, body: str) -> None:
    """Replace the PR description."""
    gh(["api", "--method", "PATCH", f"repos/{repo}/pulls/{number}", "--input", "-"], {"body": body})


class Context(NamedTuple):
    repo: str
    number: int
    run_url: str
    pr: dict
    comments: list[dict]
    comment: dict | None
    state: ReviewState


def load(state_from: str | None) -> Context:
    """The PR, its comments, the review comment and the state."""
    repo = os.environ["GITHUB_REPOSITORY"]
    number = int(os.environ["PR_NUMBER"])
    run_id = os.environ.get("GITHUB_RUN_ID")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    run_url = f"{server}/{repo}/actions/runs/{run_id}" if run_id else "about:blank"
    pr = fetch_pr(repo, number)
    comments = fetch_comments(repo, number)
    comment = review_comment(comments)
    body = Path(state_from).read_text() if state_from else comment and comment["body"]
    return Context(repo, number, run_url, pr, comments, comment, parse_state(body))


def _set_outputs(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a") as out:
        for key, value in values.items():
            out.write(f"{key}={value}\n")


def _write_dry_run(comment_body: str, pr_body: str | None) -> None:
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / "comment.md").write_text(comment_body)
    print(f"--- comment ({RUN_DIR / 'comment.md'}) ---\n{comment_body}")
    if pr_body is not None:
        (RUN_DIR / "body.md").write_text(pr_body)
        print(f"--- PR body ({RUN_DIR / 'body.md'}) ---\n{pr_body}")


def _publish_comment(ctx: Context, body: str, dry_run: bool) -> None:
    if dry_run:
        _write_dry_run(body, None)
    else:
        save_comment(ctx.repo, ctx.number, ctx.comment, body)


def _notify_author(ctx: Context, notice: str, dry_run: bool) -> None:
    if not notice:
        return
    if dry_run:
        RUN_DIR.mkdir(exist_ok=True)
        (RUN_DIR / "notify.md").write_text(notice)
        print(f"--- new comment for the author ({RUN_DIR / 'notify.md'}) ---\n{notice}")
    else:
        post_comment(ctx.repo, ctx.number, notice)


def files_since_review(ctx: Context) -> int | None:
    """How many of the PR's files changed since the reviewed commit, or None when no earlier review covers part of
    the head (none yet, or the branch was rewritten)."""
    since, head = ctx.state["reviewed_sha"], ctx.pr["headRefOid"]
    if not since or since == head:
        return None
    found = incremental_diff(fetch_compare(ctx.repo, since, head), fetch_pr_files(ctx.repo, ctx.number))
    return found[1].files if found else None


def route_now(ctx: Context, cmd: Command) -> Route:
    """route() with the facts it needs read from GitHub."""
    files = files_since_review(ctx) if cmd.kind == "review" else None
    return route(cmd, ctx.state, ctx.pr["headRefOid"], ctx.pr.get("state") == "OPEN", files)


def _reviewed_head(pr: dict) -> str:
    """The commit the review reads: the pr-head checkout's, which can trail a push made during the run."""
    result = subprocess.run(["git", "-C", "pr-head", "rev-parse", "HEAD"], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else pr["headRefOid"]


def _read_costs() -> list[RecordedCost]:
    path = RUN_DIR / "costs.json"
    return json.loads(path.read_text()) if path.exists() else []


def cmd_route(args: argparse.Namespace) -> None:
    ctx = load(args.state_from)
    result = route_now(ctx, parse_command(os.environ.get("COMMENT_BODY")))
    print(f"action={result.action}" + (f" ({result.reason})" if result.reason else ""))
    _set_outputs(action=result.action)


def cmd_prepare(args: argparse.Namespace) -> None:
    ctx = load(args.state_from)
    head = _reviewed_head(ctx.pr)
    budget = step_cap(remaining_budget(ctx.state))
    if not budget:
        sys.exit(f"prepare: {budget_used_text(ctx.state)}")
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / "head-sha").write_text(head)
    since = ctx.state["reviewed_sha"]
    found = incremental_diff(fetch_compare(ctx.repo, since, head), fetch_pr_files(ctx.repo, ctx.number)) \
        if since and since != head else None
    rerun = None
    if found:
        diff, rerun = found
        (RUN_DIR / "new-changes.diff").write_text(diff)
    brief = render_brief(ctx.repo, ctx.pr, ctx.state, checks_from_pr(ctx.pr), rerun)
    (RUN_DIR / "brief.md").write_text(brief)
    _set_outputs(review_schema=compact_schema("review-output.schema.json"),
                 verify_schema=compact_schema("verify-output.schema.json"), budget=budget)
    kind = f"rerun since {rerun.since_sha[:9]}, changed files: {rerun.files}" if rerun else "full review"
    print(f"wrote {RUN_DIR / 'brief.md'} ({kind}); review budget ${budget}")


def cmd_cost(args: argparse.Namespace) -> None:
    cap = float(os.environ["STEP_CAP"])
    path = Path(os.environ.get("EXECUTION_FILE") or "")
    log = None
    if path.name and path.is_file():
        try:
            log = path.read_text()
        except OSError:
            log = ""
    cost: RecordedCost = {**step_cost(args.step, log, cap), "reason": failure_reason(log, dict(os.environ))}
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / "costs.json").write_text(json.dumps(_read_costs() + [cost]))
    _set_outputs(next_cap=step_cap(cap - cost["usd"]))
    basis = {"measured": "", "cap": " (no cost in the log: charged its cap)",
             "not_started": " (no log: cost unknown, charged nothing)"}[cost["basis"]]
    print(f"{args.step}: ${cost['usd']:.4f}{basis}" + (" (cut off by its cap)" if cost["cut_off"] else ""))
    if cost["reason"]:
        print(f"{args.step} failed: {cost['reason']}")


def cmd_number(args: argparse.Namespace) -> None:
    ctx = load(args.state_from)
    review = parse_review_output(os.environ["REVIEW_OUTPUT"])
    numbered = number_findings(review["findings"], ctx.state)
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / "verify-brief.md").write_text(render_verify_brief(ctx.repo, ctx.number, numbered))
    _set_outputs(has_new="true" if numbered else "false")
    print(f"{len(numbered)} new findings: {', '.join(f['id'] for f in numbered) or 'none'}")


def cmd_publish(args: argparse.Namespace) -> None:
    ctx = load(args.state_from)
    review = parse_review_output(os.environ["REVIEW_OUTPUT"])
    verify_raw = os.environ.get("VERIFY_OUTPUT")
    numbered = number_findings(review["findings"], ctx.state)
    head_file = RUN_DIR / "head-sha"
    head = head_file.read_text().strip() if head_file.exists() else ctx.pr["headRefOid"]
    costs = _read_costs()
    state = merge(ctx.state, review["previous"], numbered, parse_verdicts(verify_raw))
    state = add_spent(after_review(state, head), costs)
    unchecked = len(numbered) if numbered and not verify_raw else 0
    notices = [f"{unchecked} new findings went unchecked and are not shown: the budget ran out"] if unchecked else []
    author, checks = ctx.pr["author"]["login"], checks_from_pr(ctx.pr)
    comment_body = render_comment(author, state, checks, ctx.run_url, head_sha=ctx.pr["headRefOid"],
                                  notice=" · ".join(notices + cost_notices(costs)))
    pr_body = rewrite_body(review["description"], ctx.pr.get("body"))
    tell_author = author_notice(ctx.state, state, author, checks, ctx.comment)
    refuse_secrets(comment_body + pr_body + tell_author, dict(os.environ))
    check_comment_size(comment_body)
    if args.dry_run:
        _write_dry_run(comment_body, pr_body)
        _notify_author(ctx, tell_author, True)
        return
    # The body goes first: if it fails, the comment (and the cost it records) is left for `fail` to write once.
    save_pr_body(ctx.repo, ctx.number, pr_body)
    save_comment(ctx.repo, ctx.number, ctx.comment, comment_body)
    _notify_author(ctx, tell_author, False)


def cmd_fail(args: argparse.Namespace) -> None:
    ctx = load(args.state_from)
    costs = _read_costs()
    body = render_comment(ctx.pr["author"]["login"], add_spent(ctx.state, costs), checks_from_pr(ctx.pr),
                          ctx.run_url, failed=True, notice=" · ".join(cost_notices(costs)),
                          out_of_budget=any(c["cut_off"] for c in costs),
                          reason=next((c["reason"] for c in costs if c["reason"]), ""))
    _publish_comment(ctx, body, args.dry_run)


def merge_facts(ctx: Context) -> MergeFacts:
    """Read what option A needs from GitHub: the checks, the changed files and the owner's walk reports."""
    head = ctx.pr["headRefOid"]
    changes_frontend = any(path.startswith("frontend/") for path in fetch_pr_files(ctx.repo, ctx.number))

    def frontend_changed_since(sha: str) -> bool | None:
        compare = fetch_compare(ctx.repo, sha, head)
        if not compare or compare.get("status") not in ("ahead", "identical"):
            return None
        files = compare.get("files") or []
        return len(files) >= 300 or any(f["filename"].startswith("frontend/") for f in files)

    walk = walk_blocker(trusted_walk_reports(ctx.comments), head, changes_frontend, frontend_changed_since)
    return MergeFacts(base=ctx.pr.get("baseRefName", ""), mergeable=ctx.pr.get("mergeable", ""), ci=ci_tally(ctx.pr),
                      open_blocking=open_blocking_ids(ctx.state), reviewed_head=ctx.state["reviewed_sha"] == head,
                      walk=walk)


def _run_or_print(args: list[str], dry_run: bool) -> str:
    """Run a gh write and return "" on success or GitHub's refusal; a dry run prints it instead."""
    if dry_run:
        print(f"WOULD RUN: gh {' '.join(args)}")
        return ""
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    return "" if result.returncode == 0 else _one_line(result.stderr) or f"gh exited {result.returncode}"


def _act_merge(ctx: Context, cmd: Command, dry_run: bool) -> tuple[ReviewState, str]:
    author = ctx.pr["author"]["login"]
    options = build_options(merge_facts(ctx), author, ctx.state["decisions_used"])
    option = next(o for o in options if o["key"] == cmd.target)
    if not option["available"]:
        return ctx.state, (f"Not run: option {cmd.target} is no longer available ({option['why']}). "
                           "Comment `/claude-decide` again")
    head = ctx.pr["headRefOid"]
    action = OPTION_BY_KEY[cmd.target].action
    refused = ""
    if action == "merge":
        refused = _run_or_print(["pr", "merge", str(ctx.number), "--repo", ctx.repo, "--merge",
                                 "--match-head-commit", head], dry_run)
    elif action == "close":
        reason = cmd.text or "the owner chose to close it"
        refused = _run_or_print(["pr", "close", str(ctx.number), "--repo", ctx.repo, "--comment",
                                 f"Closed by the owner's decision (`/claude-merge C`): {reason}."], dry_run)
    if refused:
        return ctx.state, f"Not run: GitHub refused ({refused})"
    return carry_out(ctx.state, cmd.target, options), ""


def act(ctx: Context, cmd: Command, result: Route, dry_run: bool) -> tuple[ReviewState, str]:
    """Carry out a $0 action; returns the new state and the footer notice."""
    state = ctx.state
    if result.action == "stop":
        return state, f"Not run: {result.reason}"
    if result.action == "refresh":
        head = ctx.pr["headRefOid"]
        if state["reviewed_sha"] == head:
            return state, f"No new commits since the review of `{head[:9]}`: checks refreshed, no AI run"
        # Routed here because the new commits change none of the PR's files, so the review still covers the head.
        return after_review(state, head), (f"No change to the PR's files since the review of "
                                           f"`{state['reviewed_sha'][:9]}`: the review now covers `{head[:9]}`, "
                                           "checks refreshed, no AI run")
    if result.action == "dismiss":
        return dismiss(state, cmd.target, cmd.text), f"{cmd.target} dismissed"
    if result.action == "decide":
        options = build_options(merge_facts(ctx), ctx.pr["author"]["login"], state["decisions_used"])
        return propose(state, ctx.pr["headRefOid"], options), ""
    if result.action == "merge":
        return _act_merge(ctx, cmd, dry_run)
    raise ValueError(f"the act job does not run {result.action!r}")


def cmd_act(args: argparse.Namespace) -> None:
    ctx = load(args.state_from)
    cmd = parse_command(os.environ.get("COMMENT_BODY"))
    result = route_now(ctx, cmd)
    print(f"action={result.action}" + (f" ({result.reason})" if result.reason else ""))
    state, notice = act(ctx, cmd, result, args.dry_run)
    author, checks = ctx.pr["author"]["login"], checks_from_pr(ctx.pr)
    body = render_comment(author, state, checks, ctx.run_url, head_sha=ctx.pr["headRefOid"], notice=notice)
    _publish_comment(ctx, body, args.dry_run)
    _notify_author(ctx, author_notice(ctx.state, state, author, checks, ctx.comment), args.dry_run)


COMMANDS = {
    "route": cmd_route,
    "prepare": cmd_prepare,
    "cost": cmd_cost,
    "number": cmd_number,
    "publish": cmd_publish,
    "fail": cmd_fail,
    "act": cmd_act,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("step", nargs="?", choices=("review", "verify"), help="cost only: which Claude step")
    parser.add_argument("--dry-run", action="store_true", help="write nothing to GitHub")
    parser.add_argument("--state-from", help="read the state from this saved comment instead of the PR's")
    args = parser.parse_args()
    if args.command == "cost" and not args.step:
        parser.error("cost needs the step: review or verify")
    try:
        COMMANDS[args.command](args)
    except ValueError as error:
        sys.exit(f"{args.command}: {error}")


if __name__ == "__main__":
    main()

"""The plumbing around the two Claude steps of .github/workflows/claude-review.yml.

A maintainer comments `/claude-review` on a PR. The workflow runs these subcommands from the root checkout:

  prepare   writes .pr-review-run/brief.md for step 1, and both JSON schemas as step outputs
  number    gives step 1's new findings their ids and writes .pr-review-run/verify-brief.md for step 2
  publish   posts or edits the one review comment and rewrites the PR description
  fail      marks that comment as failed, keeping the last checklist

Stdlib only. Environment: GITHUB_REPOSITORY and PR_NUMBER; REVIEW_OUTPUT (step 1) for number and publish;
VERIFY_OUTPUT (step 2) for publish. With --dry-run nothing is written to GitHub: the comment and the body go to
.pr-review-run/ and stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple, TypedDict

RUN_DIR = Path(".pr-review-run")
PROMPT_DIR = Path(__file__).resolve().parent.parent / ".github" / "pr-review"
WORKFLOW_NAME = "Claude review"
BOT_LOGIN = "github-actions[bot]"
MAX_NEW_FINDINGS = 7
# An open finding measured 2.5k to 3.1k characters in the dry runs (its list line plus its copy in the hidden
# state), so 10 open take about 31k of GitHub's 65,536-character comment limit. The rest holds about 50 fixed
# findings, which keep only their title.
MAX_OPEN_FINDINGS = 10
MAX_COMMENT_CHARS = 65536

SECRET_ENV_VARS = ("ANTHROPIC_API_KEY", "GH_TOKEN", "GITHUB_TOKEN")
SECRET_PATTERNS = {
    "an Anthropic key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "a GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"),
}

COMMENT_MARKER = "<!-- claude-review -->"
STATE_PREFIX = "<!-- claude-review-state "
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


class ReviewState(TypedDict):
    version: int
    run: int
    findings: list[Finding]


class ReviewOutput(TypedDict):
    description: str
    previous: list[dict]
    findings: list[dict]


def empty_state() -> ReviewState:
    """The state before the first review of a PR."""
    return {"version": 1, "run": 0, "findings": []}


def parse_state(comment_body: str | None) -> ReviewState:
    """Read the ReviewState hidden in a review comment; an absent or unreadable one is a fresh start."""
    if not comment_body:
        return empty_state()
    start = comment_body.rfind(STATE_PREFIX)
    end = comment_body.find("-->", start + len(STATE_PREFIX))
    if start == -1 or end == -1:
        return empty_state()
    try:
        state = json.loads(comment_body[start + len(STATE_PREFIX):end])
    except json.JSONDecodeError:
        return empty_state()
    if not isinstance(state, dict) or state.get("version") != 1:
        return empty_state()
    return state


def state_marker(state: ReviewState) -> str:
    """The hidden comment that carries the state to the next run."""
    # A raw "-->" in a finding would close the HTML comment early. "--" occurs in JSON text only inside strings,
    # where escaping the second hyphen leaves the decoded value unchanged.
    payload = json.dumps(state, separators=(",", ":")).replace("--", "-\\u002d")
    return f"{STATE_PREFIX}{payload} -->"


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
    # A fixed finding renders as its title alone, so its long text leaves the state and the comment stays under
    # GitHub's 65,536-character limit across reruns.
    if status == "fixed":
        return {**f, "status": "fixed", "why": "", "fix": "", "could_be_wrong_if": ""}
    return {**f, "status": status}


def merge(state: ReviewState, previous: list[dict], numbered: list[Finding], keep: dict[str, bool]) -> ReviewState:
    """The next state: the last run's findings with their new status, plus the new findings step 2 kept, at most 7
    and only while fewer than 10 are open. A finding left out is found again on a later run."""
    status = {p["id"]: p["status"] for p in previous}
    carried = [_with_status(f, status.get(f["id"], "open")) if f["status"] == "open" else f for f in state["findings"]]
    room = MAX_OPEN_FINDINGS - sum(1 for f in carried if f["status"] == "open")
    kept = [f for f in numbered if keep.get(f["id"], False)][:max(0, min(MAX_NEW_FINDINGS, room))]
    return {"version": 1, "run": state["run"] + 1, "findings": carried + kept}


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
    if failed:
        ci_detail = f"{len(failed)} failed: {', '.join(failed)}."
    elif pending:
        ci_detail = f"{pending} still running, {passed} passed."
    elif passed:
        ci_detail = f"All {passed} passed."
    else:
        ci_detail = "No checks reported."
    return [merge_check, Check(name="ci", ok=not failed, detail=ci_detail)]


def _one_line(text: str) -> str:
    return " ".join(str(text).split())


def _location(f: Finding) -> str:
    return f"`{f['file']}:{f['line']}`" if f.get("line") else f"`{f['file']}`"


def _render_finding(f: Finding) -> str:
    head = f"**{TIER_BY_KEY[f['tier']].label}** · {f['id']} · {_location(f)} · {_one_line(f['title'])}"
    if f["status"] == "fixed":
        return f"- [x] ~~{head}~~ Fixed."
    return (
        f"- [ ] {head}<br>**Why:** {_one_line(f['why'])}<br>**Fix:** {_one_line(f['fix'])}"
        f"<br>**Could be wrong if:** {_one_line(f['could_be_wrong_if'])}"
    )


def _display_order(f: Finding) -> tuple:
    return (f["status"] == "fixed", TIER_RANK[f["tier"]], _id_number(f["id"]))


def render_comment(author: str, state: ReviewState, checks: list[Check], run_url: str, failed: bool = False) -> str:
    """The one review comment: headline, plain checks, findings, footer and the hidden state."""
    open_findings = [f for f in state["findings"] if f["status"] == "open"]
    blocking = sum(1 for f in open_findings if TIER_BY_KEY[f["tier"]].blocking)
    blocking += sum(1 for c in checks if not c["ok"])

    if failed:
        earlier = f" The list below is from run {state['run']}." if state["run"] else ""
        headline = f"This review run failed, [see the log]({run_url}).{earlier}"
    elif blocking:
        noun = "item needs" if blocking == 1 else "items need"
        headline = f"@{author}, {blocking} {noun} your attention."
    else:
        headline = f"@{author}, nothing blocking from this review."

    lines = [COMMENT_MARKER, headline, ""]
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
    if failed:
        lines.append("<sub>Comment `/claude-review` to try again.</sub>")
    else:
        lines.append(f"<sub>Review run {state['run']} · [log]({run_url}) · Comment `/claude-review` to review again.</sub>")
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


def render_brief(repo: str, pr: dict, state: ReviewState, checks: list[Check]) -> str:
    """Step 1's brief: the PR, the plain checks, the open findings and the description(s), as data."""
    number = pr["number"]
    current, original = split_body(pr.get("body"))
    open_findings = [f for f in state["findings"] if f["status"] == "open"]
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


def gh(args: list[str], payload: dict | None = None) -> str:
    """Run gh; a failure ends the step with gh's own message. Every write to GitHub sends a payload through here."""
    if payload is not None:
        refuse_secrets(json.dumps(payload, ensure_ascii=False), dict(os.environ))
    result = subprocess.run(["gh", *args], input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result.stdout


PR_FIELDS = ("number,title,body,author,baseRefName,headRefName,additions,deletions,changedFiles,"
             "mergeable,mergeStateStatus,statusCheckRollup")


def fetch_pr(repo: str, number: int) -> dict:
    """The PR, waiting a little while GitHub works out whether it merges."""
    for attempt in range(5):
        pr = json.loads(gh(["pr", "view", str(number), "--repo", repo, "--json", PR_FIELDS]))
        if pr.get("mergeable") != "UNKNOWN":
            break
        time.sleep(3 * (attempt + 1))
    return pr


def fetch_review_comment(repo: str, number: int) -> dict | None:
    """The bot's review comment on the PR, if it has one."""
    pages = json.loads(gh(["api", "--paginate", "--slurp", f"repos/{repo}/issues/{number}/comments"]))
    mine = [c for page in pages for c in page
            if (c.get("user") or {}).get("login") == BOT_LOGIN and (c.get("body") or "").startswith(COMMENT_MARKER)]
    return mine[-1] if mine else None


def save_comment(repo: str, number: int, existing: dict | None, body: str) -> None:
    """Edit the review comment, or create it on the first run."""
    check_comment_size(body)
    if existing:
        gh(["api", "--method", "PATCH", f"repos/{repo}/issues/comments/{existing['id']}", "--input", "-"], {"body": body})
    else:
        gh(["api", "--method", "POST", f"repos/{repo}/issues/{number}/comments", "--input", "-"], {"body": body})


def save_pr_body(repo: str, number: int, body: str) -> None:
    """Replace the PR description."""
    gh(["api", "--method", "PATCH", f"repos/{repo}/pulls/{number}", "--input", "-"], {"body": body})


def _env() -> tuple[str, int, str]:
    repo = os.environ["GITHUB_REPOSITORY"]
    number = int(os.environ["PR_NUMBER"])
    run_id = os.environ.get("GITHUB_RUN_ID")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    run_url = f"{server}/{repo}/actions/runs/{run_id}" if run_id else "about:blank"
    return repo, number, run_url


def _set_outputs(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a") as out:
        for key, value in values.items():
            out.write(f"{key}={value}\n")


def cmd_prepare(dry_run: bool) -> None:
    repo, number, _ = _env()
    pr = fetch_pr(repo, number)
    comment = fetch_review_comment(repo, number)
    RUN_DIR.mkdir(exist_ok=True)
    brief = render_brief(repo, pr, parse_state(comment and comment["body"]), checks_from_pr(pr))
    (RUN_DIR / "brief.md").write_text(brief)
    _set_outputs(review_schema=compact_schema("review-output.schema.json"),
                 verify_schema=compact_schema("verify-output.schema.json"))
    print(f"wrote {RUN_DIR / 'brief.md'}")


def cmd_number(dry_run: bool) -> None:
    repo, number, _ = _env()
    review = parse_review_output(os.environ["REVIEW_OUTPUT"])
    comment = fetch_review_comment(repo, number)
    numbered = number_findings(review["findings"], parse_state(comment and comment["body"]))
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / "verify-brief.md").write_text(render_verify_brief(repo, number, numbered))
    _set_outputs(has_new="true" if numbered else "false")
    print(f"{len(numbered)} new findings: {', '.join(f['id'] for f in numbered) or 'none'}")


def cmd_publish(dry_run: bool) -> None:
    repo, number, run_url = _env()
    review = parse_review_output(os.environ["REVIEW_OUTPUT"])
    keep = parse_verdicts(os.environ.get("VERIFY_OUTPUT"))
    pr = fetch_pr(repo, number)
    comment = fetch_review_comment(repo, number)
    state = parse_state(comment and comment["body"])
    new_state = merge(state, review["previous"], number_findings(review["findings"], state), keep)
    comment_body = render_comment(pr["author"]["login"], new_state, checks_from_pr(pr), run_url)
    pr_body = rewrite_body(review["description"], pr.get("body"))
    refuse_secrets(comment_body + pr_body, dict(os.environ))
    check_comment_size(comment_body)
    if dry_run:
        _write_dry_run(comment_body, pr_body)
        return
    save_comment(repo, number, comment, comment_body)
    save_pr_body(repo, number, pr_body)


def cmd_fail(dry_run: bool) -> None:
    repo, number, run_url = _env()
    pr = fetch_pr(repo, number)
    comment = fetch_review_comment(repo, number)
    body = render_comment(pr["author"]["login"], parse_state(comment and comment["body"]), checks_from_pr(pr), run_url,
                          failed=True)
    if dry_run:
        _write_dry_run(body, None)
        return
    save_comment(repo, number, comment, body)


def _write_dry_run(comment_body: str, pr_body: str | None) -> None:
    RUN_DIR.mkdir(exist_ok=True)
    (RUN_DIR / "comment.md").write_text(comment_body)
    print(f"--- comment ({RUN_DIR / 'comment.md'}) ---\n{comment_body}")
    if pr_body is not None:
        (RUN_DIR / "body.md").write_text(pr_body)
        print(f"--- PR body ({RUN_DIR / 'body.md'}) ---\n{pr_body}")


COMMANDS = {"prepare": cmd_prepare, "number": cmd_number, "publish": cmd_publish, "fail": cmd_fail}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--dry-run", action="store_true", help="write nothing to GitHub")
    args = parser.parse_args()
    try:
        COMMANDS[args.command](args.dry_run)
    except ValueError as error:
        sys.exit(f"{args.command}: {error}")


if __name__ == "__main__":
    main()

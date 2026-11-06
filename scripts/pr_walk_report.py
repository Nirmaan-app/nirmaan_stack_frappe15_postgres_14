"""Post the owner's browser walk of a PR as a walk report comment, from his laptop.

  python3 scripts/pr_walk_report.py --pr 1617 --sha a2650c859 --url <evidence link> --rows rows.json [--dry-run]

rows.json is a list of {"change": str, "seen": int, "failed": int, "not_walked": int}, one per change walked.
The comment is posted with `gh` as the logged-in user. The review bot trusts only reports posted by the owner
(user id 8597417), and offers "merge" for a PR that changes frontend/ only when the latest one has no failed row
and was walked on the head, or on a commit after which no frontend/ file changed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pr_review import OWNER_ID, WalkReport, parse_walk_report, render_walk_report  # noqa: E402

REPO = "Nirmaan-app/nirmaan_stack_frappe15_postgres_14"


def gh(args: list[str]) -> str:
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--sha", required=True, help="the commit the walk ran on")
    parser.add_argument("--url", required=True, help="where the walk's evidence is")
    parser.add_argument("--rows", type=Path, required=True, help="the rows as a JSON file")
    parser.add_argument("--repo", default=REPO)
    parser.add_argument("--dry-run", action="store_true", help="print the comment instead of posting it")
    args = parser.parse_args()

    head_sha = gh(["api", f"repos/{args.repo}/commits/{args.sha}", "--jq", ".sha"])
    report: WalkReport = {"head_sha": head_sha, "url": args.url, "rows": json.loads(args.rows.read_text()),
                          "walked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    body = render_walk_report(report)
    if parse_walk_report(body) != report:
        sys.exit("the rows are malformed: each needs a change and whole numbers seen, failed and not_walked")
    if int(gh(["api", "user", "--jq", ".id"])) != OWNER_ID:
        print(f"warning: gh is not logged in as user {OWNER_ID}; the review bot will ignore this report",
              file=sys.stderr)
    if args.dry_run:
        print(body)
        return
    print(gh(["pr", "comment", str(args.pr), "--repo", args.repo, "--body", body]))


if __name__ == "__main__":
    main()

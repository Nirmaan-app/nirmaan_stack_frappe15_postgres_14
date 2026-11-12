#!/bin/sh
# The checks .githooks/pre-commit and .githooks/pre-merge-commit both run (ADR-0049), so a merge meets the same
# gate as a commit:
#
#   1. the residence ratchet (scripts/residence_check.py, about 5 s): file size, rupee formatters, payment sums,
#      test-data rules, ADR-0010 residence -- every check, tightening the baseline when a count falls;
#   2. typed ESLint (frontend/eslint.config.js) on the staged .ts/.tsx files under frontend/src, against
#      frontend/eslint-suppressions.json, so a new `any` is refused here instead of in CI.
#
# Usage: sh .githooks/checks.sh <hook name>      (git runs a hook from the root of the working tree)
#
# ESLint reads the files as they are in the working tree, not as staged. It is skipped, with a note, where the
# frontend is not installed (no frontend/node_modules): CI runs `yarn lint` on every pull request anyway.

hook="${1:-pre-commit}"
failed=0

if [ -f scripts/residence_check.py ]; then
    out=$(python3 scripts/residence_check.py 2>&1)
    if [ $? -ne 0 ]; then
        echo "✘ $hook rejected: scripts/residence_check.py counts a new violation." >&2
        printf '%s\n' "$out" | grep -v '^✓' >&2
        failed=1
    elif printf '%s' "$out" | grep -q '^Tightened baseline'; then
        # A count that fell rewrites the baseline after the change's files were staged.
        echo "⚠ $hook: a count fell, so scripts/residence_baseline.json was tightened -- commit it too." >&2
    fi
fi

# Added, copied, modified or renamed files, as paths relative to frontend/ (NUL-separated: folder names have spaces).
staged() {
    git diff --cached --name-only -z --diff-filter=ACMR --relative=frontend/ -- 'frontend/src/*.ts' 'frontend/src/*.tsx'
}

if [ "$(staged | tr -cd '\000' | wc -c)" -gt 0 ]; then
    if [ -x frontend/node_modules/.bin/eslint ]; then
        # --no-warn-ignored: a staged file under an ignored folder (src/components/ui/) is not a warning.
        if ! staged | (cd frontend && xargs -0 node_modules/.bin/eslint --no-warn-ignored); then
            echo "✘ $hook rejected: ESLint (frontend/eslint.config.js) found a violation in a staged file." >&2
            echo "    A rule broken anew: fix it. 'unused suppression': you fixed old ones -- run" >&2
            echo "    'yarn lint --prune-suppressions' in frontend/ and stage eslint-suppressions.json." >&2
            failed=1
        fi
    else
        echo "⚠ $hook: frontend/node_modules is missing, so ESLint was skipped (run 'yarn install' in frontend/)." >&2
    fi
fi

if [ $failed -ne 0 ]; then
    echo "    (bypass a one-off with: git commit --no-verify / git merge --no-verify)" >&2
    exit 1
fi
exit 0

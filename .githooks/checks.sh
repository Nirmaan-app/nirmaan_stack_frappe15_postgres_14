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
# ESLint lints the staged copy, never the working tree's: git's index is copied (git checkout-index) into a temporary
# folder -- frontend/src, the ESLint and TypeScript configs and eslint-suppressions.json, all as staged -- and
# ESLint runs there with the real frontend/node_modules linked in. The CLI is used as `yarn lint` uses it, because
# `eslint --stdin` ignores the suppressions file. No `git stash`: the stash is shared with every other checkout.
# It is skipped, with a note, where the frontend is not installed (no frontend/node_modules): CI runs `yarn lint`
# on every pull request anyway.

hook="${1:-pre-commit}"
failed=0

if [ -f scripts/residence_check.py ]; then
    out=$(python3 scripts/residence_check.py 2>&1)
    rc=$?
    if [ $rc -eq 127 ] || ! command -v python3 >/dev/null 2>&1; then
        echo "✘ $hook rejected: python3 was not found, so scripts/residence_check.py could not run." >&2
        echo "    Install Python 3 so 'python3' is on PATH." >&2
        failed=1
    elif [ $rc -ne 0 ]; then
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
    if [ -f frontend/node_modules/eslint/bin/eslint.js ]; then
        # Set before mktemp, so no signal falls between the two. EXIT alone misses a signal under dash (Linux
        # /bin/sh): Ctrl-C mid-lint would leave the folder. `rm -rf ""` removes nothing.
        index_copy=""
        trap 'rm -rf "$index_copy"' EXIT
        trap 'rm -rf "$index_copy"; exit 130' INT
        trap 'rm -rf "$index_copy"; exit 143' TERM
        trap 'rm -rf "$index_copy"; exit 129' HUP
        # No temp folder, no lint: an empty $index_copy would copy the index under /.
        if ! index_copy=$(mktemp -d "${TMPDIR:-/tmp}/nirmaan-staged-lint.XXXXXX") || [ ! -d "$index_copy" ]; then
            index_copy=""
            echo "✘ $hook rejected: no temporary folder could be made under ${TMPDIR:-/tmp} for ESLint's staged copy." >&2
            exit 1
        fi
        git ls-files -z -- frontend/src frontend/eslint.config.js frontend/eslint-suppressions.json \
            'frontend/tsconfig*.json' frontend/package.json | git checkout-index -z --stdin --prefix="$index_copy/"
        ln -s "$PWD/frontend/node_modules" "$index_copy/frontend/node_modules"
        # --no-warn-ignored: a staged file under an ignored folder (src/components/ui/) is not a warning.
        # The heap is yarn lint's (package.json): typed linting outgrows node's default.
        if ! staged | (cd "$index_copy/frontend" && xargs -0 node --max-old-space-size=3072 node_modules/eslint/bin/eslint.js --no-warn-ignored); then
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

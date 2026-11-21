#!/bin/sh
# The checks .githooks/pre-commit and .githooks/pre-merge-commit both run (ADR-0049), so a merge meets the same
# gate as a commit:
#
#   1. the residence ratchet (scripts/residence_check.py, about 5 s): file size, rupee formatters, payment sums,
#      test-data rules, `.json()` calls, lint disable comments, ADR-0010 residence -- every check, tightening the
#      baseline when a count falls. J1 and D1 are frozen per file instead: a file under its frozen count fails until
#      the frozen file is lowered in the same change (D1: residence_check.py --prune-disable-comments);
#   2. type-aware oxlint (frontend/.oxlintrc.json) on the staged .ts/.tsx files under frontend/src, against
#      frontend/oxlint-suppressions.json, so a new `any` is refused here instead of in CI.
#
# Usage: sh .githooks/checks.sh <hook name>      (git runs a hook from the root of the working tree)
#
# oxlint lints the staged copy, never the working tree's: git's index is copied (git checkout-index) into a temporary
# folder -- frontend/src, the oxlint and TypeScript configs and oxlint-suppressions.json, all as staged -- and oxlint
# runs there with the real frontend/node_modules linked in, as `yarn lint` runs it (it reads the suppressions file
# from the folder it runs in). No `git stash`: the stash is shared with every other checkout.
#
# oxlint is a native binary, installed for the machine that ran `yarn install`. Where it is:
#   - it runs here (a native install: CI, a teammate's Windows machine): it lints here;
#   - it does not (on the Mac, where frontend/ is installed inside the Linux dev container, "Cannot find native
#     binding"): the staged copy is lint inside that container ($NIRMAAN_LINT_CONTAINER, default
#     frappe_docker_devcontainer-frappe-1), with frontend/node_modules at its path there (from the container's mounts);
#   - neither, or no frontend/node_modules: skipped with a note. CI runs `yarn lint` on every pull request anyway.

hook="${1:-pre-commit}"
failed=0

if [ -f scripts/residence_check.py ]; then
    out=$(python3 scripts/residence_check.py --hook 2>&1)
    rc=$?
    if [ $rc -eq 127 ] || ! command -v python3 >/dev/null 2>&1; then
        echo "✘ $hook rejected: python3 was not found, so scripts/residence_check.py could not run." >&2
        echo "    Install Python 3 so 'python3' is on PATH." >&2
        failed=1
    elif [ $rc -ne 0 ]; then
        echo "✘ $hook rejected: scripts/residence_check.py counts a new violation." >&2
        printf '%s\n' "$out" | grep -v '^✓' >&2
        failed=1
    else
        # A check that could not run here (J1 or D1 with no node) says so and passes; CI runs it on every pull
        # request. (A J1 or D1 count that fell is not here: it failed above, naming how to lower its frozen count.)
        printf '%s\n' "$out" | grep '^⚠' | sed "s/^⚠ /⚠ $hook: /" >&2
    fi
    if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q '^Tightened baseline'; then
        # A count that fell rewrites the baseline after the change's files were staged.
        echo "⚠ $hook: a count fell, so scripts/residence_baseline.json was tightened -- commit it too." >&2
    fi
fi

# Added, copied, modified or renamed files, as paths relative to frontend/ (NUL-separated: folder names have spaces).
staged() {
    git diff --cached --name-only -z --diff-filter=ACMR --relative=frontend/ -- 'frontend/src/*.ts' 'frontend/src/*.tsx'
}

container="${NIRMAAN_LINT_CONTAINER:-frappe_docker_devcontainer-frappe-1}"

# The container's path for a host path, from the container's bind mounts; nothing when no mount holds it.
container_path() {
    docker inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' "$container" 2>/dev/null |
        while IFS='|' read -r src dst; do
            case "$1/" in "$src"/*) printf '%s%s\n' "$dst" "${1#"$src"}"; break ;; esac
        done
}

# Where oxlint can run: "here", "container", or nothing.
lint_runner() {
    if frontend/node_modules/.bin/oxlint --version >/dev/null 2>&1; then
        echo here
    elif command -v docker >/dev/null 2>&1 \
        && [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" = true ] \
        && [ -n "$(container_path "$(pwd -P)")" ] \
        && docker exec "$container" test -x "$(container_path "$(pwd -P)")/frontend/node_modules/.bin/oxlint"; then
        echo container
    fi
}

if [ "$(staged | tr -cd '\000' | wc -c)" -gt 0 ]; then
    runner=""
    [ -d frontend/node_modules ] && runner=$(lint_runner)
    if [ -n "$runner" ]; then
        # Set before mktemp, so no signal falls between the two. EXIT alone misses a signal under dash (Linux
        # /bin/sh): Ctrl-C mid-lint would leave the folder. `rm -rf ""` removes nothing.
        index_copy=""
        container_copy=""
        cleanup() {
            rm -rf "$index_copy"
            [ -z "$container_copy" ] || docker exec "$container" rm -rf "$container_copy" >/dev/null 2>&1
        }
        trap 'cleanup' EXIT
        trap 'cleanup; exit 130' INT
        trap 'cleanup; exit 143' TERM
        trap 'cleanup; exit 129' HUP
        # No temp folder, no lint: an empty $index_copy would copy the index under /.
        if ! index_copy=$(mktemp -d "${TMPDIR:-/tmp}/nirmaan-staged-lint.XXXXXX") || [ ! -d "$index_copy" ]; then
            index_copy=""
            echo "✘ $hook rejected: no temporary folder could be made under ${TMPDIR:-/tmp} for oxlint's staged copy." >&2
            exit 1
        fi
        # No pipes below: /bin/sh (dash) has no pipefail, and a pipe's status is its last command's only, so a stage
        # that failed would leave a partial copy to lint. Each stage writes a file and is checked on its own.
        # $index_copy holds the list and the tarball beside frontend/, so neither is linted or copied.
        if ! git ls-files -z -- frontend/src frontend/.oxlintrc.json frontend/oxlint-suppressions.json \
            'frontend/tsconfig*.json' frontend/package.json >"$index_copy/files"; then
            echo "✘ $hook rejected: git ls-files could not list the files for oxlint's staged copy." >&2
            exit 1
        fi
        if ! git checkout-index -z --stdin --prefix="$index_copy/" <"$index_copy/files"; then
            echo "✘ $hook rejected: git checkout-index could not copy the staged files for oxlint." >&2
            exit 1
        fi
        lint_ok=1
        if [ "$runner" = here ]; then
            ln -s "$PWD/frontend/node_modules" "$index_copy/frontend/node_modules"
            staged | (cd "$index_copy/frontend" && xargs -0 node_modules/.bin/oxlint --type-aware --no-error-on-unmatched-pattern) || lint_ok=0
        elif ! container_copy=$(docker exec "$container" mktemp -d /tmp/nirmaan-staged-lint.XXXXXX) \
            || [ -z "$container_copy" ]; then
            container_copy=""
            echo "✘ $hook rejected: no temporary folder could be made in container $container for oxlint's staged copy." >&2
            exit 1
        # Copied in through tar: the host's temporary folder is not mounted in the container. Without macOS's
        # metadata: each file checkout-index writes there carries the com.apple.provenance xattr, and bsdtar would
        # add a ._<name> AppleDouble file beside it (COPYFILE_DISABLE stops those, inside tsconfig's include) and
        # an xattr header the container's tar warns about (--no-xattrs; GNU tar takes it too).
        elif ! COPYFILE_DISABLE=1 tar --no-xattrs -C "$index_copy" -cf "$index_copy/staged.tar" frontend; then
            echo "✘ $hook rejected: the staged files could not be packed (tar) for container $container, so oxlint did not run." >&2
            exit 1
        elif ! { docker exec -i "$container" tar -C "$container_copy" -xf - <"$index_copy/staged.tar" \
            && docker exec "$container" ln -s "$(container_path "$(pwd -P)/frontend/node_modules")" \
                "$container_copy/frontend/node_modules"; }; then
            echo "✘ $hook rejected: the staged files could not be copied into container $container, so oxlint did not run." >&2
            exit 1
        else
            staged | docker exec -i -w "$container_copy/frontend" "$container" xargs -0 node_modules/.bin/oxlint --type-aware --no-error-on-unmatched-pattern \
                || lint_ok=0
        fi
        if [ $lint_ok -eq 0 ]; then
            echo "✘ $hook rejected: oxlint (frontend/.oxlintrc.json) failed on the staged files: a violation, or oxlint itself" >&2
            echo "    (its output is above)." >&2
            echo "    A rule broken anew: fix it. 'suppressions that do not occur anymore': you fixed old ones -- run" >&2
            echo "    'yarn lint --prune-suppressions' in frontend/ and stage oxlint-suppressions.json." >&2
            failed=1
        fi
    elif [ -d frontend/node_modules ]; then
        echo "⚠ $hook: oxlint does not run here (its native binary does not load, and container $container is not" >&2
        echo "    running, does not mount this checkout, or has no oxlint installed: run 'yarn install' in frontend/" >&2
        echo "    inside it), so oxlint was skipped. CI lints every pull request." >&2
    else
        echo "⚠ $hook: frontend/node_modules is missing, so oxlint was skipped (run 'yarn install' in frontend/)." >&2
    fi
fi

if [ $failed -ne 0 ]; then
    echo "    (bypass a one-off with: git commit --no-verify / git merge --no-verify)" >&2
    exit 1
fi
exit 0

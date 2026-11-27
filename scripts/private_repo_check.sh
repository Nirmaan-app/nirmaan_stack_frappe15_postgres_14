#!/usr/bin/env bash
# Checks that the repo, its release build and the dev boxes work with the repo's current visibility.
# Usage: bash scripts/private_repo_check.sh --expect public|private [--tag <release tag>] [--deep]
#   --tag   the release tag whose build and image to check (default: the newest build_push run)
#   --deep  also pull that image and search its files for a clone token
# Exits 1 when any check fails. Run it from the laptop: it reaches contabo and air over SSH.
set -uo pipefail

REPO=Nirmaan-app/nirmaan_stack_frappe15_postgres_14
URL=https://github.com/$REPO.git
GAR=asia-south1-docker.pkg.dev/nirmaan-stack/nirmaan-project-stack/nirmaan-project-stack
BOXES=$HOME/.config/devbox/boxes.conf
TRIAGE_DEVS="nirmaan-techadmin madhubalan17js Niru9196"
TOKEN_RE='x-access-token:[a-z]{3}_|gh[sp]_[A-Za-z0-9]{30}|github_pat_[A-Za-z0-9_]{30}'
expect="" tag="" deep=0 fails=0

while [ $# -gt 0 ]; do
  case "$1" in
    --expect) expect="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --deep) deep=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$expect" in public|private) ;; *) echo "pass --expect public or --expect private" >&2; exit 2 ;; esac

pass() { echo "PASS  $1: $2"; }
fail() { echo "FAIL  $1: $2"; fails=$((fails + 1)); }
info() { echo "INFO  $1: $2"; }
check() { if [ "$2" = "$3" ]; then pass "$1" "$2"; else fail "$1" "got $2, want $3"; fi; }

visibility=$(gh api "repos/$REPO" -q .visibility | tr 'A-Z' 'a-z')
check visibility "$visibility" "$expect"

if GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c core.askPass=/usr/bin/false ls-remote "$URL" HEAD >/dev/null 2>&1; then
  anon=reads
else
  anon=refused
fi
if [ "$expect" = private ]; then check "anonymous clone" "$anon" refused; else check "anonymous clone" "$anon" reads; fi

if git ls-remote "git@github.com:$REPO.git" HEAD >/dev/null 2>&1; then pass "laptop ssh clone" reads; else fail "laptop ssh clone" refused; fi

for box in $(git config -f "$BOXES" --get-regexp '^box\..*\.ssh$' 2>/dev/null | sed 's/^box\.\(.*\)\.ssh .*/\1/'); do
  dest=$(git config -f "$BOXES" "box.$box.ssh")
  co=$(git config -f "$BOXES" "box.$box.checkout")
  if ssh -o ConnectTimeout=10 -o BatchMode=yes "$dest" "GIT_TERMINAL_PROMPT=0 git -C '$co' ls-remote '$URL' HEAD" >/dev/null 2>&1; then
    pass "$box reads $REPO" "over https from $co"
  else
    fail "$box reads $REPO" "git ls-remote $URL failed (no git login on the box, or box down)"
  fi
  origin=$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$dest" "git -C '$co' remote get-url origin" 2>/dev/null)
  case "$origin" in
    *"$REPO"*) pass "$box origin" "$origin" ;;
    *) fail "$box origin" "$origin is not $REPO (a fork stays public after the switch)" ;;
  esac
done

if [ "$expect" = private ]; then
  fork_pr=$(gh api "repos/$REPO/actions/permissions/fork-pr-workflows-private-repos" -q .run_workflows_from_fork_pull_requests 2>/dev/null)
  check "CI runs on PRs from forks" "${fork_pr:-unknown}" true
  check "default branch" "$(gh api "repos/$REPO" -q .default_branch)" develop
  check "devs can fork the private repo" "$(gh api "repos/$REPO" -q .allow_forking)" true
fi

collabs=$(gh api "repos/$REPO/collaborators" -q '[.[] | .login + "=" + .role_name] | join(" ")')
info collaborators "$collabs"
if [ "$expect" = private ]; then
  for dev in $TRIAGE_DEVS; do
    role=$(printf '%s\n' $collabs | sed -n "s/^$dev=//p")
    check "$dev role (pushes only to their own fork)" "${role:-not a collaborator}" triage
  done
fi
info "public forks" "$(gh api "repos/$REPO/forks" --paginate -q '.[] | select(.visibility == "public") | .full_name' | wc -l | tr -d ' ')"

if [ -z "$tag" ]; then
  tag=$(gh run list -R "$REPO" -w build_push.yml --limit 1 --json headBranch -q '.[0].headBranch')
fi
run=$(gh run list -R "$REPO" -w build_push.yml --branch "$tag" --limit 1 --json conclusion,databaseId -q '.[0] | "\(.conclusion) \(.databaseId)"')
check "release build $tag" "${run%% *}" success

image="$GAR:$tag"
if ! docker buildx imagetools inspect "$image" >/dev/null 2>&1; then
  fail "image $tag" "not in the registry (or no registry login)"
else
  pass "image $tag" "in the registry"
  if meta=$(docker buildx imagetools inspect "$image" --format '{{json .Provenance}} {{json .Image}}' 2>/dev/null) &&
    apps=$(printf '%s' "$meta" | python3 -I -c 'import sys,re,base64; t=sys.stdin.read(); print(t); [print(base64.b64decode(v).decode()) for v in re.findall(r"APPS_JSON_BASE64\":\s*\"([A-Za-z0-9+/=]+)", t)]'); then
    if printf '%s' "$apps" | grep -qE "$TOKEN_RE"; then
      fail "image $tag metadata" "its provenance or config holds a clone token"
    else
      pass "image $tag metadata" "no clone token in its provenance or config"
    fi
  else
    fail "image $tag metadata" "could not read its provenance and config"
  fi
fi

if [ "$deep" = 1 ]; then
  docker pull -q --platform linux/amd64 "$image" >/dev/null
  out=$(docker run --rm --platform linux/amd64 --entrypoint sh "$image" -c \
    "grep -rIlE '$TOKEN_RE' /home/frappe /opt /etc 2>/dev/null; echo grep-ran")
  rc=$?
  hits=$(printf '%s\n' "$out" | grep -v '^grep-ran$')
  if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -q '^grep-ran$'; then
    fail "image $tag files" "could not scan the image (docker exit $rc)"
  elif [ -n "$hits" ]; then
    fail "image $tag files" "$(printf '%s' "$hits" | head -5 | tr '\n' ' ')"
  else
    pass "image $tag files" "no clone token in /home/frappe, /opt, /etc"
  fi
fi

echo "$fails failed"
[ "$fails" -eq 0 ]

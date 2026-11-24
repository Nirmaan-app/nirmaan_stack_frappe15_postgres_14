#!/bin/bash
# Tests join.sh, a developer's one setup step for a shared box: on a fresh Mac it makes the key, the Host block, the
# registry entry and the org repo's remote with pushing off, and prints the people.sh add command for the owner; a
# rerun changes nothing; an org remote under another name is kept, never renamed; a registry value or Host block that
# differs is reported, not overwritten; a missing git identity is a FIX.
# A temp HOME and checkout, stub tailscale and ssh (ssh -G runs the real ssh on the temp config). Real ssh-keygen.
# No network, nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_join.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/test_join.XXXXXX")" && pwd -P)"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
lacks() { case "$OUT" in *"$1"*) fail "$2 (output has: $1)" ;; *) pass "$2" ;; esac; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }

mkdir -p "$T/bin"
cat > "$T/bin/tailscale" <<'EOF'
#!/bin/bash
echo "tailscale $*" >> "$STUB_LOG"
[ "${STUB_TS:-ok}" = ok ] && echo "pong" || { echo "no reply" >&2; exit 1; }
EOF
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
for a in "$@"; do [ "$a" = -G ] && exec /usr/bin/ssh "$@"; done
echo "ssh $*" >> "$STUB_LOG"
[ "${STUB_SSH:-refused}" = ok ] || { echo "Permission denied (publickey)." >&2; exit 255; }
EOF
chmod +x "$T/bin/tailscale" "$T/bin/ssh"
export PATH="$T/bin:/usr/bin:/bin:/usr/sbin:/sbin" STUB_LOG="$T/stub.log"
unset DEVBOX_REGISTRY
: > "$STUB_LOG"
ORG=https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git

# mkco <dir> <remote name> <url> ...: a developer's checkout holding join.sh, with those remotes and a git identity.
mkco() {
  local d="$1"; shift
  mkdir -p "$d/scripts/devenv"; cp "$HERE/join.sh" "$HERE/develop.sh" "$d/scripts/devenv/"
  git -C "$d" init -q -b develop
  while [ $# -gt 1 ]; do git -C "$d" remote add "$1" "$2"; shift 2; done
  git -C "$d" config user.name "Madhu Balan"; git -C "$d" config user.email madhu@example.com
}
join() { local co="$1"; shift; run env HOME="$H" /bin/bash "$co/scripts/devenv/join.sh" "$@"; }
sums() { cat "$H/.ssh/config" "$H/.ssh/id_ed25519_r7" "$H/.ssh/id_ed25519_r7.pub" "$H/.config/devbox/boxes.conf" "$1/.git/config" | shasum | cut -c1-12; }
reg() { git config -f "$H/.config/devbox/boxes.conf" "$1" || true; }

# ---- a fresh Mac: a fork as origin, nothing else
H="$T/fresh"; CO="$T/fresh-co"; mkdir -p "$H"
mkco "$CO" origin https://github.com/madhu/nirmaan_stack_frappe15_postgres_14.git
join "$CO" --name madhu
rc_is 0 "a fresh Mac exits 0 (only the owner's steps wait)"
has "  ok    Tailscale reaches r7 (100.80.71.39)" "Tailscale is checked"
grep -q "tailscale ping -c 1 --until-direct=false --timeout 5s 100.80.71.39" "$STUB_LOG" || fail "tailscale pings the box"; pass "tailscale pings the box"
has "  made  key $H/.ssh/id_ed25519_r7 (ed25519, comment madhu-to-r7)" "the key is made"
PUB="$(cat "$H/.ssh/id_ed25519_r7.pub")"
case "$PUB" in "ssh-ed25519 AAAA"*" madhu-to-r7") pass "the key is ed25519 with comment madhu-to-r7" ;; *) fail "the key is ed25519 with comment madhu-to-r7: $PUB" ;; esac
same "$(sed -n '/^Host r7$/,$p' "$H/.ssh/config")" "$(printf 'Host r7\n  HostName 100.80.71.39\n  User abhishek_nirmaan\n  IdentityFile ~/.ssh/id_ed25519_r7\n  IdentitiesOnly yes')" "the Host r7 block is written"
has "  WAIT  ssh r7 does not log in yet: the owner adds your key" "a refused login waits for the owner"
grep -q "ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new r7 true" "$STUB_LOG" || fail "the login test accepts a new host key"; pass "the login test accepts a new host key"
same "$(git -C "$CO" remote get-url upstream)" "$ORG" "the org repo is added as upstream"
same "$(git -C "$CO" config remote.upstream.pushurl)" DISABLED-push-to-your-fork "pushing to the org repo is off"
same "$(git -C "$CO" config remote.origin.pushurl || echo none)" none "the fork keeps its push URL"
same "$(reg box.r7.ssh)|$(reg box.r7.checkout)|$(reg box.r7.launch)|$(reg box.r7.agents)|$(reg devbox.default)" \
  "abhishek_nirmaan@r7|work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master|box|2|r7" "the registry entry is written"
has "public key: $PUB" "the block carries the public key"
has "  scripts/devenv/people.sh add madhu --key '$PUB' --account '<Orca account id or email, or system>' \\" "the block carries the people.sh add command"
has "    --git-name 'Madhu Balan' --git-email 'madhu@example.com' --prefix madhu- --box r7" "the command carries the developer's git identity"
has "Send the block to the owner" "it says what to do next"

# ---- a rerun changes nothing; once the owner added the key, every line is ok
before="$(sums "$CO")"
STUB_SSH=ok join "$CO" --name madhu
rc_is 0 "a rerun exits 0"
same "$(sums "$CO")" "$before" "a rerun changes no file"
lacks "  made  " "a rerun makes nothing"
has "  ok    ssh r7 logs in" "the login works once the owner added the key"
has "Ready: start a task with scripts/devenv/task.sh start madhu-<task>" "every line ok says ready"
same "$(grep -c '^Host r7$' "$H/.ssh/config")" 1 "the Host block is never written twice"

# ---- the org repo already a remote under another name; a registry that differs
H="$T/second"; CO="$T/second-co"; mkdir -p "$H/.config/devbox"
mkco "$CO" origin https://github.com/madhu/fork.git nirmaan git@github.com:Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git
git config -f "$H/.config/devbox/boxes.conf" box.r7.agents 4
git -C "$CO" config --add remote.nirmaan.pushurl git@github.com:Nirmaan-app/a.git
git -C "$CO" config --add remote.nirmaan.pushurl git@github.com:Nirmaan-app/b.git
git config -f "$H/.config/devbox/boxes.conf" devbox.default air
join "$CO" --name madhu
rc_is 0 "a differing registry value exits 0"
same "$(git -C "$CO" remote | sort | tr '\n' ' ')" "nirmaan origin " "an org remote under another name is kept, and no upstream is added"
same "$(git -C "$CO" config --get-all remote.nirmaan.pushurl)" DISABLED-push-to-your-fork "pushing to it is off, even from several push URLs"
has "  DIFF  registry box.r7.agents is 4, not 2: left as is" "a differing value is reported"
has "  DIFF  registry devbox.default is air, not r7: left as is" "a differing default is reported"
same "$(reg box.r7.agents)|$(reg devbox.default)|$(reg box.r7.launch)" "4|air|box" "differing values are kept, missing ones written"

# ---- upstream taken by something else; a Host block that differs; no git identity; Tailscale down
H="$T/third"; CO="$T/third-co"; mkdir -p "$H/.ssh"
mkco "$CO" upstream https://github.com/someone/else.git
git -C "$CO" config --unset user.email
printf 'Host r7\n  HostName 10.0.0.9\n' > "$H/.ssh/config"
STUB_TS=down join "$CO" --name madhu
rc_is 1 "a FIX exits 1"
has "  FIX   no remote points at github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14, and upstream is https://github.com/someone/else.git" "a taken upstream is a FIX"
same "$(git -C "$CO" remote | tr '\n' ' ')" "upstream " "no remote is added or renamed"
same "$(cat "$H/.ssh/config")" "$(printf 'Host r7\n  HostName 10.0.0.9')" "an existing Host block is left as is"
has "  FIX   ssh r7 goes to '10.0.0.9', not 100.80.71.39" "a Host block that differs is a FIX"
has "  WAIT  Tailscale does not reach r7 (100.80.71.39)" "an unreachable box waits for the share"
has "  WAIT  ssh r7: not tried until Tailscale reaches it" "the login is not tried"
has "  FIX   no git user.name or user.email" "a missing git identity is a FIX"
has "--git-email '<your email>'" "the command shows a placeholder for it"

join "$CO" --name Madhu
rc_is 1 "a name with capitals STOPs"; has "STOP  --name Madhu" "the STOP names the flag"

echo; echo "all $N checks passed"

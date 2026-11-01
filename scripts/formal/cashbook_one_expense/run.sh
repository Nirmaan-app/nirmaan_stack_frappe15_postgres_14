#!/usr/bin/env bash
# Model-check the Cashbook one-expense-per-Txn-Id property. One command:
#
#   scripts/formal/cashbook_one_expense/run.sh              # every config
#   scripts/formal/cashbook_one_expense/run.sh phase1 today # only these configs
#
# Each <name>.cfg starts with "# EXPECTED: PASS" or "# EXPECTED: FAIL". The script exits 0 when every
# config came out as expected, and 1 when any did not. A FAIL prints the shortest bad sequence of steps.
#
# FizzBee is pinned (version and SHA-256) and cached in ~/.cache/fizzbee/<version>. It needs bash,
# curl and python3 (FizzBee's parser is a Python program). Nothing is written inside the repo.
set -euo pipefail

FIZZBEE_VERSION="v0.5.4"
sha_for() {
  case "$1" in
    macos_arm) echo "2091d0a1bf5acc41015f8644cbaf5ec853ed0c88283a7f94d615135a6c8a441c" ;;
    macos_x86) echo "e9133999d2e647dc54ae6cc7160ce11c21581bf859b559aaa6d3409f3fd59fe3" ;;
    linux_arm) echo "bd85836bdba66eadfdcd5f610ef27177d51db97e29fdc726bf8243152887256a" ;;
    linux_x86) echo "8a1d0900f9ad920002151922337912e11f9e588a2f1196249fe40bf75370f782" ;;
  esac
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEC="CashbookOneExpense.fizz"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=macos_arm ;;
  Darwin-x86_64) PLATFORM=macos_x86 ;;
  Linux-aarch64 | Linux-arm64) PLATFORM=linux_arm ;;
  Linux-x86_64) PLATFORM=linux_x86 ;;
  *) echo "run.sh: no FizzBee build for $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/fizzbee/$FIZZBEE_VERSION"
FIZZ="$CACHE/fizzbee-$FIZZBEE_VERSION-$PLATFORM/fizz"
if [[ ! -x "$FIZZ" ]]; then
  mkdir -p "$CACHE"
  tarball="$CACHE/fizzbee-$FIZZBEE_VERSION-$PLATFORM.tar.gz"
  echo "Downloading FizzBee $FIZZBEE_VERSION ($PLATFORM) into $CACHE"
  curl -fsSL -o "$tarball" \
    "https://github.com/fizzbee-io/fizzbee/releases/download/$FIZZBEE_VERSION/fizzbee-$FIZZBEE_VERSION-$PLATFORM.tar.gz"
  got="$(shasum -a 256 "$tarball" 2>/dev/null || sha256sum "$tarball")"
  if [[ "${got%% *}" != "$(sha_for "$PLATFORM")" ]]; then
    echo "run.sh: checksum mismatch for $tarball -- refusing to run it" >&2
    exit 2
  fi
  tar -xzf "$tarball" -C "$CACHE"
fi

if [[ $# -gt 0 ]]; then
  CONFIGS=("$@")
else
  CONFIGS=()
  for cfg in "$HERE"/*.cfg; do CONFIGS+=("$(basename "$cfg" .cfg)"); done
fi

# FizzBee writes a .json and an out/ folder next to the spec, so it runs on a copy.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cashbook-fv.XXXXXX")"
cp "$HERE/$SPEC" "$HERE"/*.cfg "$WORK/"

# All configs at once; each is single-threaded. --experimental_no_graph keeps memory and time down
# (it still checks `always` and `exists` assertions and still prints the failing trace).
for name in "${CONFIGS[@]}"; do
  [[ -f "$WORK/$name.cfg" ]] || { echo "run.sh: no config $name.cfg" >&2; exit 2; }
  (
    mkdir -p "$WORK/$name" && cp "$WORK/$SPEC" "$WORK/$name.cfg" "$WORK/$name/"
    cd "$WORK/$name"
    start=$SECONDS
    "$FIZZ" --experimental_no_graph --preinit-hook-file "$name.cfg" "$SPEC" > log.txt 2>&1 || true
    echo $((SECONDS - start)) > seconds.txt
  ) &
done
wait

status=0
printf "\n%-28s %-9s %-9s %s\n" "config" "expected" "got" "time"
for name in "${CONFIGS[@]}"; do
  log="$WORK/$name/log.txt"
  expected="$(sed -n 's/^# EXPECTED: \([A-Z]*\).*/\1/p' "$WORK/$name.cfg" | head -1)"
  if grep -q "^PASSED:" "$log"; then got=PASS
  elif grep -q "^FAILED:" "$log"; then got=FAIL
  else got=ERROR
  fi
  mark="ok"
  [[ "$got" == "$expected" ]] || { mark="UNEXPECTED"; status=1; }
  printf "%-28s %-9s %-9s %ss  %s\n" "$name" "$expected" "$got" "$(cat "$WORK/$name/seconds.txt")" "$mark"
done

for name in "${CONFIGS[@]}"; do
  log="$WORK/$name/log.txt"
  if grep -q "^FAILED:" "$log"; then
    echo
    echo "== $name: $(grep -m1 '^FAILED:' "$log")"
    # The step list FizzBee prints right after the FAILED line: one step per line, oldest first.
    awk '/^FAILED: Model checker failed/{n++; next} n==1 && /^  /{print} n==1 && !/^  /{if (p) exit} {p=(n==1)}' "$log"
  elif ! grep -q "^PASSED:" "$log"; then
    echo
    echo "== $name: FizzBee did not finish. Last lines of $log:"
    tail -15 "$log"
  fi
done
echo
echo "Full logs and traces: $WORK/<config>/log.txt"
exit $status

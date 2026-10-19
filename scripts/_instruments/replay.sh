#!/bin/bash
# The 17,883-row panel replay (12e-5; tracked in ADP-1, 2026-10-19): dump (read-only), bundle BOTH harnesses
# against the working tree, run, hash. Usage, in the container: replay.sh <label> [dir]
# <dir> (else $REPLAY_DIR, else /tmp/replay17883) holds the dump and the outputs; nothing is written elsewhere.
# The baseline it reproduces is in README.md (17,883 rows; plain 85869b59...; section-aware 5c824dd3...).
set -u
LABEL=$1
S=${2:-${REPLAY_DIR:-/tmp/replay17883}}
export REPLAY_DIR=$S
mkdir -p "$S"
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../.." && pwd)
export PATH=/home/frappe/.nvm/versions/node/v24.13.0/bin:$PATH
cd /workspace/development/frappe-bench
CAP=/workspace/development/frappe-bench/logs/boq_rate_extraction_capture.jsonl
echo "capture lines before: $(wc -l < $CAP)"
env/bin/python "$HERE/ac5_dump.py" "$S" 2>&1 | grep -v firebase | tail -3
for f in ac5_rows.jsonl ac5_configs.json ac5_items.json; do cp "$S/$f" "$S/${LABEL}_$f"; sha256sum "$S/$f" | cut -c1-16; done
cd "$APP/frontend"
for h in ac7_harness ac7v2_harness; do
  node_modules/.bin/esbuild "$HERE/$h.ts" --bundle --platform=node --format=esm --outfile="$S/$h.mjs" --log-level=error
  node "$S/$h.mjs" "$LABEL" 2>&1 | tail -2
done
wc -l "$S/ac7_$LABEL.jsonl" "$S/ac7v2_$LABEL.jsonl"
sha256sum "$S/ac7_$LABEL.jsonl" "$S/ac7v2_$LABEL.jsonl"
echo "capture lines after: $(wc -l < $CAP)"
echo REPLAY_DONE

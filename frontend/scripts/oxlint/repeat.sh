#!/usr/bin/env bash
# Is oxlint's type-aware result the same on every run? (ticket #1699) Runs the whole-tree no-unsafe config <runs>
# times and prints, per run, the number of no-unsafe-* findings and a hash of the exact findings. Inside the
# container, from frontend/:   bash scripts/oxlint/repeat.sh <runs> [extra oxlint args, e.g. --threads=1]
# Not pipefail: oxlint exits 1 whenever it finds anything, which is every run here; bad output fails in python.
set -eu
runs="$1"; shift
for _ in $(seq 1 "$runs"); do
  node scripts/oxlint/lint.mjs -c scripts/oxlint/oxlintrc.whole.json --type-aware -f json "$@" src | python3 -I -c "
import json,sys,hashlib
found=sorted((x['filename'],x['labels'][0]['span']['offset'],x['code']) for x in json.load(sys.stdin)['diagnostics'] if 'unsafe' in x['code'])
print(len(found), hashlib.sha1(repr(found).encode()).hexdigest()[:10])"
done

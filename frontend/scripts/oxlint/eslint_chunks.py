"""ESLint's whole-tree no-unsafe counts (ticket #1699), in chunks of 300 files: one ESLint run over all of src/ with
them on was killed for memory 4 times in 5 on the air box. Inside the container, from frontend/:

    python3 -I scripts/oxlint/eslint_chunks.py <out.json>

Writes the totals per rule and the counts per file and rule; suppressions are off.
"""
import collections, json, os, subprocess, sys

EMPTY_SUPPRESSIONS = "/tmp/oxlint-trial-empty-suppressions.json"
with open(EMPTY_SUPPRESSIONS, "w") as f:
    f.write("{}")

files = []
for root, _, names in os.walk("src"):
    if root.startswith("src/components/ui"):
        continue
    files += [os.path.join(root, n) for n in names if n.endswith((".ts", ".tsx"))]
files.sort()
CHUNK = 300
total = collections.Counter()
per_file = collections.Counter()
for i in range(0, len(files), CHUNK):
    part = files[i:i + CHUNK]
    run = subprocess.run(["node", "--max-old-space-size=4096", "node_modules/eslint/bin/eslint.js", "-c",
                          "scripts/oxlint/eslint.whole.config.js", "--suppressions-location",
                          EMPTY_SUPPRESSIONS, "-f", "json", *part],
                         capture_output=True, text=True)
    if run.returncode not in (0, 1):
        sys.exit(f"chunk {i}: exit {run.returncode}: {run.stderr[-400:]}")
    for f in json.loads(run.stdout):
        for m in f["messages"]:
            total[m.get("ruleId")] += 1
            per_file[(os.path.relpath(f["filePath"]), m.get("ruleId"))] += 1
    print(f"chunk {i // CHUNK + 1}: {len(part)} files", flush=True)
json.dump({"rules": dict(sorted(total.items())),
           "per_file": [[k[0], k[1], v] for k, v in sorted(per_file.items())]}, open(sys.argv[1], "w"))
print(json.dumps(dict(sorted(total.items()))))

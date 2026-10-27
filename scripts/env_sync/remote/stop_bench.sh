#!/bin/bash
# Runs inside a frappe container: stop every bench / honcho / vite process BY PID.
# (`pkill -f "bench start"` kills only the wrapper and leaves the tree serving.)
PAT='honcho start|frappe.utils.bench_helper|apps/frappe/socketio.js|esbuild --watch|yarn run watch|yarn dev|vite --host'
list() { ps -eo pid,args | grep -E "$PAT" | grep -v -E 'grep|envsync|defunct' | awk '{print $1}'; }
pids=$(list)
echo "stopping $(echo $pids | wc -w) processes"
[ -n "$pids" ] && kill $pids 2>/dev/null
for _ in $(seq 1 20); do [ -z "$(list)" ] && break; sleep 1; done
[ -n "$(list)" ] && list | xargs -r kill -9
for p in 8000 8080; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && echo "$p STILL OPEN" || echo "$p closed"; done

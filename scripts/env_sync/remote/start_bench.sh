#!/bin/bash
# Runs inside a frappe container, launched with `docker exec -d`: start bench, wait for :8000, then vite, wait for :8080.
# Logs: /tmp/envsync_logs/ in the container.
export PATH=/home/frappe/.nvm/versions/node/v24.13.0/bin:/home/frappe/.local/bin:$PATH
mkdir -p /tmp/envsync_logs
rm -f /tmp/envsync_logs/started
cd /workspace/development/frappe-bench
nohup bench start > /tmp/envsync_logs/bench_start.log 2>&1 &
for _ in $(seq 1 120); do (exec 3<>/dev/tcp/127.0.0.1/8000) 2>/dev/null && break; sleep 2; done
cd apps/nirmaan_stack/frontend
nohup yarn dev > /tmp/envsync_logs/vite.log 2>&1 &
for _ in $(seq 1 120); do (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null && break; sleep 2; done
date +%T > /tmp/envsync_logs/started

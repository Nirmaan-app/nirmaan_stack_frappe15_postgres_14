#!/bin/bash
# Runs inside a frappe container: which dev servers answer (vite on ENV_SYNC_VITE_PORT for a second environment).
for p in 8000 "${ENV_SYNC_VITE_PORT:-8080}"; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && echo "$p open" || echo "$p closed"; done

#!/bin/bash
# Runs inside a frappe container: the site's database name (not a credential).
cd /workspace/development/frappe-bench/sites
python3 -c 'import json, os; print("db_name=" + json.load(open(os.environ.get("ENV_SYNC_SITE", "localhost") + "/site_config.json"))["db_name"])'

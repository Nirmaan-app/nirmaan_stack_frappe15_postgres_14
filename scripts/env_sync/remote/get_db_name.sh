#!/bin/bash
# Runs inside a frappe container: the site's database name (not a credential).
cd /workspace/development/frappe-bench/sites
python3 -c 'import json; print("db_name=" + json.load(open("localhost/site_config.json"))["db_name"])'

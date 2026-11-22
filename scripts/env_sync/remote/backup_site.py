# Runs inside a frappe container with env/bin/python: `bench --site <site> backup ...` (the arguments after the script's
# name), with ONE difference: the database password is not put on pg_dump's command line.
#
# Frappe's own backup builds `pg_dump postgresql://user:password@host/db | gzip ...` and runs it through a shell, so any tool
# that lists processes can print the password (2026-11-21 18:01: the parallel test runner's refusal did, into a log).
# Here Frappe's `get_command` (frappe/database/__init__.py) is wrapped for this one process: the password goes into
# PGPASSWORD, which pg_dump reads from its environment, and the connection string is built without it. Everything else -
# the code path, the files, their names, the printed text, the exit code - is Frappe's. No secret file is ever written,
# so a failed or killed run leaves none behind.
import inspect
import os
import sys
import warnings

os.chdir(os.path.join(os.environ.get("ENV_SYNC_BENCH") or "/workspace/development/frappe-bench", "sites"))
import frappe
import frappe.database

_get_command = frappe.database.get_command
_signature = inspect.signature(_get_command)


def get_command(*args, **kwargs):
	call = _signature.bind(*args, **kwargs)
	password = call.arguments.get("password")
	if password and frappe.conf.db_type == "postgres":
		os.environ["PGPASSWORD"] = password
		call.arguments["password"] = None
	return _get_command(*call.args, **call.kwargs)


frappe.database.get_command = get_command

from frappe.utils import bench_helper

# what `python -m frappe.utils.bench_helper frappe <arguments>` (the bench command's own last step) does
warnings.simplefilter("ignore")
sys.argv = ["bench", "frappe", *sys.argv[1:]]
bench_helper.main()

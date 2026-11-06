"""Evidence for the model's rule 1: under REPEATABLE READ, a transaction that WAITS on
`pg_advisory_xact_lock` does not see the row the lock holder inserted and committed before letting go.

    DEVENV script scripts/formal/cashbook_one_expense/probe_advisory_snapshot.py

Prints, for two shapes of the waiting transaction, how many rows the holder committed (1) and how many the
waiter sees after it gets the lock. Measured at the sync commit: 0 in both, so a re-check after a Txn Id
lock taken inside the line's transaction reads stale data. Run it on your OWN env only: it creates a tiny
table `fv_probe` there and leaves it (the env's `DEVENV destroy` removes it with the database).
"""
import threading
import time
import uuid

import frappe
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_REPEATABLE_READ


def conn():
    c = psycopg2.connect(
        dbname=frappe.conf.db_name, user=frappe.conf.db_name, password=frappe.conf.db_password,
        host=frappe.conf.db_host or "localhost", port=frappe.conf.db_port or 5432,
    )
    c.set_isolation_level(ISOLATION_LEVEL_REPEATABLE_READ)  # what Frappe sets on every connection
    return c


setup = conn()
setup.cursor().execute("CREATE TABLE IF NOT EXISTS fv_probe (k text, run text)")
setup.commit()

for shape in ("lock_is_the_first_statement", "a_read_then_the_lock"):
    run = uuid.uuid4().hex[:8]
    key = 424242
    holder, waiter = conn(), conn()
    holder.cursor().execute("SELECT pg_advisory_xact_lock(%s)", (key,))
    out = {}

    def wait_then_recheck():
        cur = waiter.cursor()
        if shape == "a_read_then_the_lock":
            cur.execute("SELECT count(*) FROM fv_probe")  # e.g. the line's FOR UPDATE
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (key,))  # blocks until the holder commits
        cur.execute("SELECT count(*) FROM fv_probe WHERE run = %s", (run,))  # the re-check
        out["seen"] = cur.fetchone()[0]
        waiter.rollback()

    t = threading.Thread(target=wait_then_recheck)
    t.start()
    time.sleep(1.0)  # the waiter is now blocked on the lock
    holder.cursor().execute("INSERT INTO fv_probe VALUES ('T1', %s)", (run,))
    holder.commit()  # also releases the xact lock
    t.join(10)
    fresh = conn()
    cur = fresh.cursor()
    cur.execute("SELECT count(*) FROM fv_probe WHERE run = %s", (run,))
    print(f"{shape}: holder committed {cur.fetchone()[0]} row; waiter sees {out.get('seen')} after the lock")
    fresh.close()

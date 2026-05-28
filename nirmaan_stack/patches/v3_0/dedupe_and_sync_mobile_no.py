"""
Read-only pre-flight report for mobile-number login rollout.

Run MANUALLY before adding the `unique` constraint on
`Nirmaan Users.mobile_no`. NOT registered in `patches.txt`.

It prints two reports and exits without writing:

  1a. Duplicate `User.mobile_no` values  -> must be empty before applying the
      unique constraint (the migration will fail otherwise).

  1b. Drift between `User.mobile_no` and `Nirmaan Users.mobile_no` -> must be
      reconciled so that phone-login (queries `User.mobile_no`) stays in sync
      with the unique constraint (lives on `Nirmaan Users.mobile_no`).

Invocation (from CLAUDE.md docker/venv pattern):

    docker cp .../dedupe_and_sync_mobile_no.py frappe_docker_devcontainer-frappe-1:/tmp/q.py
    docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \\
        env/bin/python -c "
    import os; os.chdir('/workspace/development/frappe-bench/sites')
    import frappe; frappe.init(site='localhost'); frappe.connect()
    from nirmaan_stack.patches.v3_0.dedupe_and_sync_mobile_no import execute
    execute()
    frappe.destroy()
    "
"""

import frappe


def execute():
    print("\n=== 1a. Duplicate User.mobile_no values ===")
    duplicates = frappe.db.sql(
        """
        SELECT mobile_no, COUNT(*) AS n, STRING_AGG(name, ', ') AS users
        FROM "tabUser"
        WHERE mobile_no IS NOT NULL AND mobile_no != ''
        GROUP BY mobile_no
        HAVING COUNT(*) > 1
        ORDER BY n DESC, mobile_no
        """,
        as_dict=True,
    )

    if not duplicates:
        print("  OK: no duplicate mobile_no values in tabUser.")
    else:
        print(f"  BLOCKING: {len(duplicates)} duplicate mobile_no value(s) found.")
        print("  Resolve these manually before applying the unique constraint:")
        for row in duplicates:
            print(f"    {row['mobile_no']}  (x{row['n']})  -> {row['users']}")

    print("\n=== 1b. Drift: User.mobile_no vs Nirmaan Users.mobile_no ===")
    drift = frappe.db.sql(
        """
        SELECT u.name AS user_name,
               u.mobile_no AS user_mobile,
               nu.mobile_no AS nu_mobile
        FROM "tabUser" u
        LEFT JOIN "tabNirmaan Users" nu ON nu.name = u.name
        WHERE u.mobile_no IS NOT NULL AND u.mobile_no != ''
          AND (nu.mobile_no IS NULL OR nu.mobile_no != u.mobile_no)
        ORDER BY u.name
        """,
        as_dict=True,
    )

    if not drift:
        print("  OK: every User.mobile_no matches its Nirmaan Users row.")
    else:
        print(f"  WARN: {len(drift)} user(s) where User.mobile_no differs from Nirmaan Users.mobile_no.")
        print("  Reconcile these so the unique constraint applies cleanly:")
        for row in drift:
            print(
                f"    {row['user_name']}: User={row['user_mobile']!r}  "
                f"Nirmaan Users={row['nu_mobile']!r}"
            )

    print("\n=== Done. No data was modified. ===")

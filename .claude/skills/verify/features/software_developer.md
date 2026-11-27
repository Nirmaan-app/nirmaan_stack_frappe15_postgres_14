# Software Developer profile

A user whose role profile is `Nirmaan Software Developer Profile` sees and does exactly what an Admin
(`Nirmaan Admin Profile`) sees and does, with its own orange badge (ADR-0051). The walk logs in as a real Admin and
as a made-up developer and checks that each screen shows the two of them the same thing, and that the thing matches
the env DB.

## Sub-features

- `sidebar` the developer's sidebar lists exactly Admin's entries, in Admin's order.
- `dashboard` the developer lands on Admin Dashboard; its Projects card matches the DB.
- `reminders` the dashboard's Action Center lists the pending reminders of the schedules that target the Admin
  profile.
- `users-badge` Admin Options → Users shows the developer with the Software Developer badge, in orange.
- `rename` a developer may rename another user's email (Actions → Rename Email enabled), and a developer account
  cannot be renamed (disabled, as for Admin).
- `payments` Project Payment & Expense opens on Payment Pending Approval with the approve controls (row checkboxes);
  its count matches the DB's Requested payments.
- `expenses` Expenses opens on the review queue, Pending Approval, with the DB's pending count.
- `invoice-approvals` Vendor Invoice Recon → Pending Invoice Approvals, with the approvers' Re-check button; its PO
  pill lists the DB's pending Purchase Order invoices.
- `projects` Admin Options → Projects: the Won Projects count matches the DB (no project filter).

## How to get to it (user POV)

- Log in as a user of the profile. Admin, HR or PMO give the profile on the Users screen (New User or Edit User);
  the department Technology is added by hand in Assets → Departments on each site.
- Every screen is reached from the sidebar as for Admin; Users and Projects sit under Admin Options.

## Driving it with drive.py

Preconditions:

- The env is served (`DEVENV serve --wait`), and `free_users.py "Nirmaan Admin Profile"` lists an unlocked Admin
  (on the 2026-11-27 data: `admins@nirmaan.app`).
- The walk seeds its own made-up developer `dev.walker@example.com` and rename target `rename.target@example.com`
  (`BIN/software_developer_seed.py`) and sets the walk password on the env DB only.

- **Whole walk.** `python3 BIN/walk_software_developer.py --task <task> --admin <admin email> --password <pw>`.
  It prints one `ok` or `MISS` line per check, saves `admin-0N-*` and `developer-0N-*` screens, `db.txt` and each
  user's `*-view.json`, and exits 1 on any miss.
- **DB side.** `DEVENV script <task> BIN/software_developer_db.py <admin email> <developer email>` prints the two
  users' profiles, Roles, project permissions and reminder schedules, and the counts the screens show.

## Gotchas

- Run it alone on the env: a test run on the same env DB changes the counts between the two users' sessions.
- A list tab shows 0 until its count arrives; the walk reads a count until two reads 1.5 s apart agree.
- The Users search reads the email, not the full name.
- `Won Projects` is a `tab`, not a `button`, and the Projects list opens on it (Won only), not on every project.
- The Reminders panel lists pending reminders (`get_my_reminder_logs`), not every schedule that targets the profile.

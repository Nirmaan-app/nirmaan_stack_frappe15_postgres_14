# ADR 0051 — The Software Developer profile mirrors Admin

**Status:** Accepted · 2026-11-27 (owner, 2026-11-26 and 2026-11-27: "strict follow the admin")

The company has a software development team that needs to work in the app with the same reach as Admin, and a
department to put those people in. Until now, access to Admin's screens and actions was granted by the profile name
"Nirmaan Admin Profile", written inline in about 200 files, so no other profile could share it.

We decided:

1. **One new profile, no Lead.** Role `Nirmaan Software Developer`, Role Profile
   `Nirmaan Software Developer Profile`. The profile carries exactly the 7 Roles of `Nirmaan Admin Profile`
   (Procurement Executive, Project Lead, Project Manager, Design Executive, Estimates Executive, Accountant, System
   Manager), so its doctype access and Desk access match Admin with no permission rows on any site.
2. **The department Technology** is created by the patch `add_technology_department` on each site's
   `bench migrate`, active and given to nobody, and only when it is missing (owner, 2026-11-27, restoring the patch
   first decided). Admin and HR give it to people in Edit User as with any department.
3. **The developer is named at every check.** `ADMIN_PROFILE` means the Admin profile alone, and `DEVELOPER_PROFILE`
   (in `services/role_profiles.py`, mirrored in `frontend/src/constants/roles.ts`) stands beside it at every list and
   check: `(ADMIN_PROFILE, DEVELOPER_PROFILE, ...)`, `is_admin_profile(p) or is_developer_profile(p)`,
   `is_nirmaan_admin(user) or is_developer(user)`, and their `isAdminProfile` / `isDeveloperProfile` /
   `isNirmaanAdmin` twins. `is_nirmaan_admin` / `isNirmaanAdmin` mean the Administrator user or the Admin profile.
   A reader sees at each check that the developer is allowed (owner, 2026-11-27, replacing the one shared list
   `ADMIN_PROFILES` first decided). Two guards hold it, one per side (`services/test_software_developer_profile.py`,
   `frontend/src/constants/roles.softwareDeveloper.test.ts`): no code names either profile as an inline string, and
   every list or check that names Admin also names the developer, except the places on an explicit exception list,
   each with its reason.
4. **A strict mirror, with no exceptions.** Wherever Admin is allowed something, the developer is too: approving and
   paying, invoice approvals, CEO Hold, deleting, managing users, every screen. Where "Admin" picks who gets work or a
   message, the developer is included too:
   - push and realtime notifications sent to Admin users (Procurement Requests, payments, Internal Transfer Memos);
   - Expense Requests whose type has no reviewer of its own go to developers for review as well;
   - a developer's own expense counts as raised at L1, like an Admin's;
   - developers may rename users' emails, and developer accounts cannot be renamed, like Admin accounts;
   - developers see and act on reminders of schedules that target the Admin profile, as well as their own.
5. **Same screens.** The developer gets Admin's sidebar, Admin's dashboard and its own badge colour.
6. **No project assignment.** Like Admin, a developer sees all projects, is never assigned one, and is not in
   `PROJECT_REQUIRED_PROFILES`, so the app access gate never locks them for having no project.
7. **Nothing else changes.** No new doctype or field, no permission rows, no change to stored data. Every other profile, and the
   Administrator user, behave exactly as before.

## Considered options

- **Read-only view of everything.** Rejected by the owner: developers need Admin's actions too.
- **Only named modules.** Rejected: the owner wants the full Admin reach.
- **One shared list, `ADMIN_PROFILES`, read by every Admin check.** Built first, then replaced by the owner
  (2026-11-27): the list hid the developer, so a reader of a check could not see who it allowed.
- **Writing the new name next to every inline Admin string.** Rejected as written: an inline string has no guard.
  Taken up through the constants instead, with the guards of decision 3.
- **Keeping notifications and work routing with Admin only.** Considered, then rejected by the owner ("strict follow
  the admin").
- **A Lead profile as well.** Not wanted.

## Consequences

- A developer account on prod can approve and pay, and has full Desk access through System Manager. Accounts with this
  profile need the same care as Admin accounts.
- Developers receive every Admin notification and appear in Admin's review queues.
- Each new Admin check names the developer beside Admin (decision 3). The guards refuse one that does not, so a
  check meant for Admin alone goes on the guard's exception list with its reason.
- Before the first migrate on prod, the owner confirms prod's `Nirmaan Admin Profile` carries the same 7 Roles.
- Technology exists on a site after its next `bench migrate`, which runs `add_technology_department`; nobody adds it
  by hand. The patch never changes a Technology that is already there.

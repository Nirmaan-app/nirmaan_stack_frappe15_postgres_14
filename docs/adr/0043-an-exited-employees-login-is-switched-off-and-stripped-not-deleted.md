# ADR 0043 — An exited employee's login is switched off and stripped, not deleted

**Status:** Accepted · 2026-11-05 (owner)

## Context

When a person leaves, their Nirmaan Users record is removed from the Users page. The record's `on_trash` then
tried to delete their Frappe User too. That delete fails, because many doctypes link to the User (owner and
modified-by on every record, comments, versions), and the failure was caught and only logged. So every exited
employee kept a working login: enabled, holding all its roles, with any API key still valid. They no longer
appeared in the user list, but could still log in and call the API.

## Decision

**The login record is kept, switched off and stripped. Only Nirmaan users get in.**

1. **Exit switches the login off.** Removing a Nirmaan Users record keeps the Frappe User and sets it
   disabled, removes all its roles and its role profile, clears its API key and secret, and ends its sessions
   (`services/exited_employees.switch_off_login`). It is written below the User document: saving the User
   would run its Nirmaan sync, which re-creates a Nirmaan Users record for a User with none.
2. **Two doors.** A login is refused for anyone with no Nirmaan Users record (`on_session_creation`), and so is
   every request, however it was authenticated: cookie session, API key or token (`auth_hooks`).
   Administrator and Guest always pass (`integrations/login_gate.py`). The set of Nirmaan user names is kept
   in `frappe.cache` and dropped whenever a Nirmaan Users record is inserted, renamed or deleted, so a request
   costs a cache read, not a DB query.
3. **One-time cleanup.** A patch runs step 1 for every existing User with no Nirmaan Users record (Administrator
   and Guest aside), and prints whom it changed. It is safe to run again. A read-only check script lists any
   drift left after deploy.

The person is then an *exited employee* (GLOSSARY.md): not in the user list, unable to log in, and never given
a role profile back. Taking one back on (rehiring) is not supported yet.

## Considered options

- **Delete the User.** Fails on the links, or would need every link to the User cleared first, which loses who
  did what.
- **Read role profiles from `User.role_profile_name` instead of the Nirmaan Users copy.** The deeper fix for
  the two role copies, but on its own it would give an exited employee their role back, since the User keeps
  its profile. Deferred.

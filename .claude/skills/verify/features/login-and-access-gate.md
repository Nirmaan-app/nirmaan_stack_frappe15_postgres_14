# Login and the app access gate

A person signs in with email or phone and a password and lands on their role's dashboard. While they hold an asset
with a declaration to sign or an audit to send, or (for a project or procurement profile) have no project, the app
access gate locks every page but the dashboard and shows what to finish first.

## Sub-features

- `login` the login page signs a person in and leaves `/login`.
- `landing` each role lands on its own dashboard (Procurement Executive: `Procurement Dashboard`).
- `gate-locked` a locked person sees only `Dashboard` in the sidebar and the card `Finish these to continue`, with
  `Open my assets` and `Log out`.
- `gate-open` an unlocked person sees their role's full sidebar.

## How to get to it (user POV)

- Open the env URL while logged out: it goes to `/login`.
- `Log out` on the lock card, or the profile button at the bottom of the sidebar.

## Driving it with drive.py

Preconditions:

- One unlocked user and one locked user with passwords on the env DB. `free_users.py` lists the unlocked ones;
  the users `DEVENV serve` prints are often locked (`deepa@nirmaan.app`, `arun@nirmaan.app` on the 2026-10-08
  template).

- **Sign in.** Run `python3 BIN/drive.py login --task <task> --user <email> --password <pw>`. It fills `#email` and
  `#password` and presses `Sign in`. It prints `landed on http://t-<task>.localhost:<port>/` and saves `login.*`.
- **Landing.** In `login.aria.txt` for a Procurement Executive, `heading "Procurement Dashboard"` and the sidebar
  buttons `Purchase Orders`, `Procurement Requests` show.
- **Locked.** Sign in as a locked user. `login.aria.txt` has `heading "Finish these to continue"`,
  `button "Open my assets"` and only `Dashboard` in the sidebar.

## Gotchas

- The first field's label and placeholder change with what is typed (email or phone). Use `#email`, not the
  placeholder.
- The gate is screens only: the APIs still answer for a locked user. Proof of the gate is the screen.
- The audit lock starts on the 28th of each month. A user unlocked on the 27th may be locked the next day.

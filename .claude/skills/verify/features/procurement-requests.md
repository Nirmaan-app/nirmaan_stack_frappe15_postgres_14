# Procurement Requests

A procurement user lists the procurement requests (PRs) of their projects by stage and starts a new PR for a
project.

## Sub-features

- `pr-list` the list shows one tab per stage, each with a count: `New PR Request`, `In Progress`, `Sent Back`,
  `Skipped PR`, `Rejected PO`, `All PRs`.
- `pr-tab` choosing a tab puts it in the URL (`?tab=New+PR+Request`).
- `pr-new` `Add New PR` opens `Select Project` at `/prs&milestones/procurement-requests`.
- `pr-items` each row's `<n> View items` button (not yet mapped: what it opens).

## How to get to it (user POV)

- The sidebar entry `Procurement Requests`.
- The Procurement Dashboard card `New PR Request Pending approval <n>`.

## Driving it with drive.py

Preconditions:

- A Procurement Executive that `free_users.py` lists (on the 2026-10-08 template: `keerti@nirmaan.app`).

- **Open the list.** `sidebar(page, "Procurement Requests")`. The URL is `/procurement-requests?tab=New+PR+Request…`
  and the buttons `All PRs <n>` and `Add New PR` show.
- **Choose a tab.** Click `get_by_role("button", name=re.compile(r"^In Progress \d+$"))`. The URL's `tab=` names
  that tab, and the rows change.
- **Start a PR.** Click `get_by_role("button", name="Add New PR")`. The URL is
  `/prs&milestones/procurement-requests` and the page reads `Select Project`.

## Gotchas

- `View items` buttons are named `<PR number> View items` (`6721 View items`). Match with `View items$`.
- The counts cover only the user's projects.

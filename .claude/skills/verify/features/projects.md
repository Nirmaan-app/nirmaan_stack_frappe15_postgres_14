# Projects

A user lists the projects they are on and opens one. A Project Manager sees only their own projects.

## Sub-features

- `proj-list` the list shows ID, Project Name, Created, Status and Type, filtered to the user's projects.
- `proj-open` a project name link opens `/projects/<project id>`, headed by the id and the name.
- `proj-tabs` the project page's sections (not yet mapped).

## How to get to it (user POV)

- The sidebar entry `Projects`.
- The dashboard card `Projects` (a different button with the same name).

## Driving it with drive.py

Preconditions:

- A Project Manager that `free_users.py` lists (on the 2026-10-08 template: `abdul.hannan@nirmaan.app`, who is on
  `00088 Hexaware GIFT City` and `00187 Telus GIFT City`).

- **Open the list.** `sidebar(page, "Projects")`. The URL is `/projects?projects_list_main_pageIdx=0…` and each
  project is a `row` (`00187 Telus GIFT City 29-Jul-2026 WIP Office`).
- **Open a project.** Click `get_by_role("link", name="Telus GIFT City")`, wait for the URL to contain
  `/projects/`, then for `Loading data...` to be hidden. The page is headed `GANDHI_NAGAR-PROJ-00187` and
  `Telus GIFT City`.

## Gotchas

- `get_by_role("button", name="Projects")` matches both the sidebar and a dashboard card: use `sidebar()`.
- The project page needs more than 5 s to load on an env. Wait for `Loading data...` to be hidden.

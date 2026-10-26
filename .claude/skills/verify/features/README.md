# Nirmaan Stack verification map

This directory is the maintained source for verifying the user-facing behaviour of Nirmaan Stack. Read the index
before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- The checkout has its own env, served: `DEVENV up`, then `DEVENV serve --wait`.
- `BIN/doctor.sh` prints only `ok` lines and the env URL `http://t-<task>.localhost:<port>/`.
- Each role user you drive has a password on the env DB (`DEVENV run <task> set-password <email> <pw>`), and
  `BIN/free_users.py` lists them as unlocked.
- Never drive the user's own site (`localhost:8080`, site `localhost`).

## Driving conventions

- Act as the role the story names, never as Administrator.
- Reach each screen the way that user does: sidebar button, tab, row link. Typing a route is setup only.
- Prefer ARIA roles and names. Tab names end in a count, so match them with a regex.
- Wait for `Loading data...` to be hidden before reading a document page.
- Save evidence with `save(page, out, "<nn>-<step>")` from `BIN/drive.py`.

## Proof and skip reporting

- Capture the action and the state after it, not only the last screen.
- A write needs a DB read (`DEVENV script`) saved beside the screenshots.
- Compare an on-screen count with the DB under the same user's project filter.
- Report each sub-feature as *seen*, *failed* (with what was seen) or *not walked* (with the reason).
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the user-visible behaviour, then four H2 sections in this
order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.py`, `Gotchas`.

## Features

- [Login and the app access gate](./login-and-access-gate.md): signing in, the role landing page, the lock card.
- [Purchase Orders](./purchase-orders.md): the PO list tabs, a PO's page, its figures against the DB. Walked
  end to end by `BIN/walk_purchase_orders.py`.
- [Procurement Requests](./procurement-requests.md): the PR list tabs, items, Add New PR.
- [Bulk Import Transactions](./bulk-import-transactions.md): bank, card and cashbook statement lines and their
  matches.
- [Projects](./projects.md): the project list and a project's page.

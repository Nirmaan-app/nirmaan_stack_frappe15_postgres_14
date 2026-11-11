# Pasted link fields

Five places hold a link a person pastes (mostly Google Drive): a project's Drive links, a Customer PO's link, a
Design Tracker task's design file link, a Commission Report task's report link and a bill's document link. Since
#1680 each holds a link of any length (Small Text, no 140-character cap): a pasted link is saved whole, shown, and
opens at its whole address. A bill's link must still start with its scheme (`https://`), as it did as a URL field.

## Sub-features

- `link-drive` Project Drive Links: Add File saves a File Name and File Link; the row shows the whole link as text and
  as the link's address; the pencil (`title="Edit Link"`) shows it back.
- `link-cpo` Customer PO Details: Add Customer PO with source Link; the row's Link / Attachment cell is an icon link
  (`title="PO Link"`); Edit PO shows the link back.
- `link-design` Design Tracker task: Edit > Design File Link; the Files cell is an icon link; Edit shows it back.
- `link-commission` Commission Report task: no screen writes `file_link`, and the Commission Report Tracker never
  shows it (`CommissionReport/components/FilesCell.tsx` is not used). Its one screen is a handover document's
  Sources in the HOD Tracker, which offers a finished task's link as "Uploaded file" and opens it in a preview.
- `link-billing` Bill: Add Bill > Link; the bills table's Bill Link / Attach cell is an icon link
  (`aria-label="Open bill link for <package> <bill type>"`); the pencil (`aria-label="Edit bill"`) shows it back.

## How to get to it (user POV)

- Drive links, as Admin: sidebar `Admin Options` > `Projects` > the project name link > Overview > Project Drive
  Links > `Add File`. Only Admin may add (the card is hidden for PMO and Sales; Add File for the accountants).
- Customer PO, as PMO Executive: sidebar `Admin Options` > `Projects` > the project > Customer PO Details >
  `Add Customer PO`. The source starts on Attachment: pick the `Link` radio first, then the PO fields show.
- Design Tracker, as Design Executive: sidebar `Design Tracker` > search the project > its card heading > the
  task's phase button > `My Tasks N` > `Search by Task Name` > the row's last cell (Edit, no name) > `Save Changes`.
- Commission Report link, as PMO Executive: sidebar `HOD Tracker` > the project heading > the `Commissioning
  Report` row's `Edit` > the task row (`Uploaded file`) > `View`.
- Bill, as Billing Executive (a manager of the package): sidebar `Billing Tracker` > the project row's
  `View Bills` > `Add Bill` > Package, Bill type `NA`, the `Bill document link` box > `Add bill`.

## Driving it with drive.py

`BIN/walk_link_fields.py --task <task> --part drive|cpo|design|commission|billing --user <email> --password <pw>`
walks one part as that user with a made-up Drive link of 200+ characters, unique to the run. It saves the link,
opens the screen again, and asserts: a link whose `href` is the whole value is on the page; clicking it opens a tab
at exactly that address (requests to `drive.google.com` are answered by the walk, so nothing leaves the machine);
the edit form shows the whole value back; and the env DB holds it once (`BIN/link_fields_db.py`, saved as
`<part>-db.txt`). Exits 1 on any miss.

Seeds (`BIN/link_fields_seed.py`, env DB only): `billing` makes the walk user a manager of the env's first billing
package; `design` picks a Submitted task assigned to the user on a WIP or Handover project; `commission` stores the
link on a task of a handover document's system with no signed copy or filled report and sets it Client Accepted.

Users that worked on the 2026-11-07 data: Admin `admins@nirmaan.app`, PMO `pmo@nirmaan.app`, Design Executive
`sharookhnaseer@gmail.com` (holds an asset, but the declaration is signed and no audit is open, so not locked),
Billing Executive `suprim.0205@gmail.com`.

## Gotchas

- `frappe.get_all(filters={field: link})` mangles a value that holds `=0` (it reads an operator out of it), so the
  DB read uses raw SQL with a bound value.
- The Design Tracker list shows only WIP and Handover projects to a non-admin, and a task cell starts with its zone
  (`7F Cable Tray Layout`): match the task name at the end of the cell.
- Each walk adds rows to the env DB (a Drive link, a Customer PO, a bill) and changes one design task's link and one
  commission task's link and status. An env only; never the user's site.

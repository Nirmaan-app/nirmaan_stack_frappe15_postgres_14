# Customers

An Accountant or the Admin lists the customers with a count of them, opens one customer's page (its details,
address, project counts, and the Projects / Inflow / Invoices and Ledger tabs) and reads its edit form; the Admin also
creates a customer (with its Address, City and State filled from the PIN) and edits one.

## Sub-features

- `customers-list` the list: an "<n> Customers" card, then one row per customer, newest first (ID, Company Name,
  Nickname, Contact Person, Phone, Email, Creation Date).
- `customer-page` a customer's page: the nickname as heading (company name beside it), Customer ID, Contact Person,
  Contact Number, Email Address, GST Number, City/State, Full Address, Total and Active Projects.
- `customer-edit-form` the pen icon beside the heading opens the edit form, holding the customer's row and address.
- `customer-create` Add New Customer: the form makes an Address, then the Customer; a 6-digit PIN found in Pincodes
  fills City and State.
- `customer-edit-save` Update saves the changed fields (Customer and Address). An empty field is `null` on the
  server and `""` in the form; the two count as the same, so a customer saved with no phone or GST, whose empty
  field was typed into and cleared, leaves Update off and sends nothing (#1703).

## How to get to it (user POV)

- Accountant and Accountant Lead: the sidebar entry `Customers`.
- Admin: `Admin Options` > `Customers` (Admin-only, owner ruling; PMO does not see it).
- From the list: a Customer ID or Company Name link opens the page; `Add New Customer` opens the create form.
- The create form is also embedded in a sheet on the project forms ("Create New Customer"; not walked here).

## Driving it with drive.py

Preconditions:

- A Nirmaan Accountant Profile user and a Nirmaan Admin Profile user with passwords on the env DB. `free_users.py`
  lists no Accountant on the 2026-10-28 data (every one holds an asset), yet the one `DEVENV serve` prints for the
  profile was not locked: check with `drive.py login` (it lands on `Finance Dashboard` with `Customers` in the
  sidebar). Admin: the shared admin account `free_users.py` lists first.

- **Whole walk.** `python3 BIN/walk_customers.py --task <task> --user <accountant> --password <pw> --admin-user
  <admin> --admin-password <pw>`. Steps 01-03 as the Accountant (list, a customer's page, its edit form, read
  only), 04-09 as the Admin (list, create a made-up `Zephyr Walk Builders <stamp>` customer, its page, edit and
  save its contact person). Steps 03b (Accountant) and 10 (Admin) open the newest real customer saved with no phone
  or GST (`customers_db.py empty`), type into each empty one and clear it, and check that Update stays off. In
  step 10 (the Admin, who may write) a wrongly enabled Update is clicked, and the walk checks that no `PUT`/`POST`
  to Customers or Address was sent and the DB row (with its `modified`) is unchanged; step 03b clicks nothing.
  Every screen is checked against `customers_db.py` (saved as `db-*.json`); exits 1 on any miss. `--part view`
  runs 01-03b alone and writes nothing.
  With no customer to open (none, all inside the list's 5-minute cache, or all made-up) it exits 1 saying
  which; `python3 -m unittest test_walk_customers` (from `BIN`) tests that choice.
- **Read the DB.** `DEVENV script <task> BIN/customers_db.py list|customer <id>|by-company <name>|pincode|empty <prefix>`.
- **The page.** Wait for `Customer ID` and `Total Projects`; labels render uppercase in `inner_text`.
- **The edit form.** The pen is `button:has(svg.lucide-file-pen-line)`; the form is the `dialog`, its 11 inputs in
  order Company Name, Nickname, Email, Phone, Contact Person, GST, Address Line 1 and 2, City, State, Pin Code.
  City fills a moment after the form opens (from the PIN).
- **Compare with master.** The walk's assertions are DB reads, so a PASS on both codes is the comparison; the #1694
  pilot also diffed the 01-03 text of master's code and the pilot's on one env: identical.

## Gotchas

- An Accountant may read customers but the Customers DocType gives the Accountant roles no create or write: the
  create form fails for them with a "Failed!" toast, after it has already made the Address, which its rollback
  cannot delete either (an orphan `<name>-Office` Address is left). Create and edit as the Admin.
- The list's API caches each page for 5 minutes (`CACHE_EXPIRY`, `api/data_table/constants.py`) and the env serves
  no realtime event to clear it, so a customer made in the last 5 minutes is missing from the plain list (the count
  card is not cached). Find it with the search box (`Search by company name...`), a query not cached yet.
- The made-up customers stay in the env DB; their names start with `Zephyr Walk Builders`.
- Live refresh (#1670): `BIN/walk_live_refresh.py` holds the list open as the Accountant while the Administrator
  renames a customer through the REST API, and expects the new name with no reload. It needs the env bench's own
  Socket.IO server (its docstring says how). **Fails on the code before #1654 as well**
  (2026-11-19, measured on a throwaway env at `49b9e1d89`). The transport is fine: recorded with the browser's own
  frame hooks, the upgraded websocket receives `list_update` within 10 ms and its pings on both codes. An earlier
  note here said no frame arrived; that came from a probe that hooked `ws.send`, which socket.io 4.8 skips for
  broadcast frames. Two causes, both older than #1654: (1) the SDK's listener hooks drop every `list_update`
  handler whenever the sidebar re-renders, which #1670's safe hooks fix (the Customers handler now runs and the
  "Data Updated" toast shows); (2) the refetch is answered from the list API's 5-minute page cache, so the list
  redraws with the old name. Until (2) is fixed the walk's step 02 fails on any code.

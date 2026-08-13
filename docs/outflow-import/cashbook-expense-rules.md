# Cashbook import — expense type and project rules

**Generated from the live tables by `scripts/generate_cashbook_rules_doc.py`. Do not edit by hand** — edit the records in Desk and re-run it.

A Cashbook statement carries no expense type and no project, so both are read from the remark text (`Remark` joined with `Note`).

## How a rule is chosen

1. The remark is matched against the project rules first. A project found means the row becomes a **Project Expense**; none found means a **Non-Project Expense**.
2. The expense type is then read from the keywords **for that ledger only**.
3. **The longest matching keyword wins.**
4. Two different types matching, or none, gives **Petty Cash**.

> The two ledgers have almost separate vocabularies — most expense types carry only one of the `project` / `non_project` flags — so the same words deliberately resolve differently on either side. `Courier charges veeva project` is Material Transportation Charges; `Courier charges` alone is Postage & Courier.

## Project Expenses

| Expense type | Keywords |
|---|---|
| Labour Charges | `labour`, `chipping` |
| Loading & Unloading Charges | `unload`, `loading` |
| Material Purchases | `purchase`, `purchased`, `local purchase`, `locally purchased` |
| Material Transportation Charges | `porter`, `rapido`, `courier`, `freight`, `travels`, `shifting`, `logistics`, `transport`, `speed post` |
| Project Printing Charges | `print`, `printing`, `printout`, `print out` |
| Scaffolding Rent | `scaffolding` |

Anything else on this side falls back to **Petty Cash**.

## Non Project Expenses

| Expense type | Keywords |
|---|---|
| Electricity Expenses | `water`, `electricity` |
| Internet & Mobile Charges | `mobile`, `internet` |
| Postage & Courier | `courier`, `speed post` |
| Printing & Stationery | `print`, `printing`, `printout`, `print out`, `bond paper`, `business card` |
| Repair & Maintenance | `rental`, `repair` |
| Staff Welfare Expenses | `cake`, `food`, `snack`, `blinkit`, `grocery`, `grossery` |

Anything else on this side falls back to **Petty Cash**.

## Project aliases

What people write for a project that no rule over the project master can reach — a shorter name, an initialism below three letters, or a habitual misspelling. Matched as a whole phrase on word boundaries.

| Alias | Project |
|---|---|
| `EY` | Ernst & Young |
| `Qubest` | Qburst |
| `tekus` | Telus GIFT City |
| `VR Mall` | VR Mall Food Court |

_0 retired (inactive) entries not shown._

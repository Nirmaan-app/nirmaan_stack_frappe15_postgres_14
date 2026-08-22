---
status: accepted
amends: the refusal behaviour introduced alongside ADR-0018
---

# A ticked import row is ALWAYS imported, so `description` stops being required

The snag import preview shows every worksheet row, ticked or unticked, with a reason for each
default. Until now a row with no description could not be ticked at all, and the server refused it
if a tampered payload sent one anyway — because `Project Snag.description` carries `reqd: 1`.

The owner's ruling (2026-08-21): **if a human ticks a row, that row is imported.** The tick is a
decision, and the importer does not overrule it.

## What follows, and none of it is optional

- **`description` loses `reqd: 1`** on the doctype. There is no other way to honour a tick on a row
  that genuinely has no text anywhere. This needs a doctype edit and a migrate; it does NOT need a
  column patch (dropping a required flag changes no column).
- **A missing description falls back to the row's FIRST NON-EMPTY CELL** — the `preview_text` the
  parser already computes and the preview already displays. On the certified fixture that turns a
  ticked tally row into a snag reading `RISK SUMMARY`, which is what that row actually says.
  **The fallback is never invented text.** A placeholder like "(no description)" was rejected: a
  reader cannot tell our placeholder from the consultant's words, and a blank box is honest where a
  manufactured sentence is not. A row with nothing anywhere therefore imports with a blank
  description, and that is the correct outcome.
- **`tickable` stops gating anything.** It survives ONLY as the signal that drives the row's
  "cannot be imported"-style explanation in the preview — which becomes purely informational. Every
  client-side site that filtered on it (select-all, the tick counter, the "N of M selected" line,
  the checkbox `disabled`, and the change handler that silently ignored clicks) must stop doing so,
  or the tick is refused by the UI while the server would have honoured it.
- **`refused_no_description` becomes structurally dead.** Nothing is refused any more. It is
  RETAINED on the wire and always reported as 0 rather than deleted: it is the counter that proved
  the silent-drop bug fixed in Revision 2 stayed fixed, and a result payload that can still SAY
  "nothing was refused" is worth more than one that cannot express the question.

## The risk being accepted

A user can now import a blank row, or a section title, as a snag. That is the price of the tick
being authoritative, and it is cheap to undo — the row is visible in the list and can be set to
*Not Applicable*, or its whole batch deleted. The alternative, which this ADR rejects, is a UI that
offers a control and then quietly declines to honour it. That failure mode has already happened once
on this feature (Revision 2's silent drop) and is far more expensive than an unwanted row.

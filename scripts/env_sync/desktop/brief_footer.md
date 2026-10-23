
---

## How this delegated session works (added by env_sync.sh; read all of it)

You are a background Claude session on the **desktop**, started by the owner's laptop session. The owner does not watch
this session. The laptop polls one status file and relays between you and the owner. Work end to end without waiting
for anyone; stop only through the status file.

1. Read `CLAUDE.md` and follow it. This machine is the desktop, so skip the "laptop or desktop" question, and never
   push, to GitHub or anywhere else. Your project memory note `project_this_machine_is_the_desktop` applies.
2. The work above is **approved to build as written**: don't stop for a plan review. If it names a ticket, read the
   ticket and its parent spec first and implement it the way `/implement` would.
3. Do every step a finished implementation needs:
   - the code;
   - the tests CLAUDE.md names as affected: run them and read the results;
   - the residence check;
   - the doc updates the DOCS-UPDATE RULE asks for;
   - one commit per ticket on the current branch;
   - the run report on this machine's Desktop (`C:\Users\USER\Desktop`).
4. Finish with **no uncommitted tracked changes**; otherwise the laptop refuses to pull the work back.
   Untracked scratch files are fine.
5. As your **last action**, write the status file `{{STATUS_FILE}}`, then end your turn. Its first line is exactly one of:
   - `DONE`: then the commit hash(es), the tests you ran with pass/fail counts, the report path, and anything the owner
     must know.
   - `BLOCKED`: you need an owner decision. That means a ruling, a STOP the ticket or CLAUDE.md requires, a destructive
     or paid step not already authorised, or a permission you were denied. Give the question, the options with your
     recommendation, and what is done so far. Commit nothing half-done; leave work in progress uncommitted, and say
     so. The answer arrives as a new message in this session.
   - `FAILED`: something you cannot recover from. Say what happened and the state you left the tree in.

   Never end your turn without writing this file. A session that sits idle without one is treated as stuck.

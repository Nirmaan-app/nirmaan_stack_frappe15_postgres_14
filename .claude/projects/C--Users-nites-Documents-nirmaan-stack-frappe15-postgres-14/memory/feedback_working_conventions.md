---
name: Working conventions with Claude Code
description: How the user expects Claude Code to behave on this project — planning, branching, code style, testing
type: feedback
---

Always read `docs/<feature>/spec.md` and the latest entries in `decisions.md` before starting any feature phase.

Output a written plan before writing code. **Never write code in the same turn as the plan** — wait for user review and approval first.

**Why:** User wants to review approach before implementation begins. Catching design issues before code is written is cheaper.

**How to apply:** Every time a new feature phase or non-trivial task begins, produce the plan as text output, then stop. Only proceed to code after the user responds with approval.

---

Branch naming: `feature/<feature>-phase-<N>`. Commit at end of each phase.

New doctypes: controllers go in `integrations/controllers/`. Doctype `*.py` stays minimal (autoname/validate only).

New whitelisted APIs: `nirmaan_stack/api/<feature>/<file>.py`, snake_case.

Frontend: stay within shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod. **Do not introduce new UI libraries.**

**Why:** Consistency and avoiding dependency sprawl.

Testing: pure-Python modules (parsers, services) must have real unit tests with fixture files. No stub-only tests for logic-bearing code.

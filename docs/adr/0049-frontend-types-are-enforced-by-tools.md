# ADR 0049 — Frontend types are enforced by tools: ESLint ratchet, generated DocType types, SDK calls default to `unknown`

**Status:** Accepted · 2026-11-12 (grill with the owner, Q1–Q13) · decided by the owner (Abhishek); does not change ADR-0010

`tsconfig.json` already sets `strict`, yet on 2026-11-12 the frontend had 1,790 lines typed `any` (rule A1 of
`scripts/residence_check.py`, baseline 1,776), 548 frappe-react-sdk calls in live code that pass no type and so return
`any` (every hook is declared `<T = any>` in `frappe-react-sdk` 1.17.0), 264 `JSON.parse` and 26 `.json()` calls that
return `any`, and 2,894 `tsc` errors parked in `frontend/tsc-baseline.json`. A1 only ran in a local pre-commit hook that
nobody is made to switch on and that `git merge` skips, so 14 new `any` lines arrived through a merged branch unseen.
A regex that counts the word `any` also cannot see an `any` that comes from a library default.

We decided:

- **ESLint replaces A1.** ESLint 10 flat config with typescript-eslint typed linting. `no-explicit-any` is an error;
  today's violations are frozen per file and per rule by ESLint bulk suppressions (`eslint-suppressions.json`), and
  fixed ones are locked in with `--prune-suppressions`. Rules are added one per change, starting with
  `no-explicit-any`, `use-unknown-in-catch-callback-variable` and `react-hooks/rules-of-hooks`; the `no-unsafe-*` rules
  are added the same way (frozen by suppressions) if their counts are shown to only fall as types improve,
  otherwise per folder once its calls are typed. A1 is removed from `residence_check.py` in the same change, so
  one rule has one counter.
- **Checks run at commit and in CI.** The repo's hooks switch themselves on at `yarn install` (`core.hooksPath`), a
  `pre-merge-commit` hook covers merges, and CI runs the same checks on every pull request, because a local hook can
  always be skipped. In CI: ESLint, the existing `tsc` ratchet (`yarn typecheck`), `type-coverage --strict` (an
  upward-only percentage that also sees `any` from library defaults), and the six residence checks that are not
  ADR-0010 rules (S1, R1, both P1, T1, T2). ADR-0010's five rules stay local until that ADR is accepted.
- **SDK calls return `unknown` unless typed.** One module re-exports the frappe-react-sdk hooks with `T` defaulting to
  `unknown`, and a lint rule bans importing `frappe-react-sdk` directly. Callers move one folder per change
  (expand–contract), because flipping the default at once raised 1,113 `tsc` errors (682 in live code across about 130
  files), too many for one change.
- **DocType types are generated from the DocType JSON** by a script in this repo into `frontend/src/types/doctypes/`,
  never edited by hand, with a CI check that fails when the output is stale. Hand-written API shapes stay in
  `frontend/src/types/NirmaanStack/` and build on the generated types.
- **Parsed JSON is `unknown` too.** One `parseJson()` helper returns `unknown`, and a lint rule bans raw `JSON.parse`
  and `.json()` (existing calls frozen by suppressions); callers move in the same per-folder changes as the SDK calls.
  `ts-reset` (which makes `JSON.parse` and `fetch().json()` return `unknown` app-wide) is switched on last, once no raw
  call is left, because it changes global types at once: switching it on first raised 181 `tsc` errors in live code,
  and parking them in `tsc-baseline.json` would hide new errors.
- **Done means zero:** the ESLint suppressions are empty, no file imports the SDK directly, `no-unsafe-*` is on for
  the whole frontend, and `frontend/tsc-baseline.json` is empty (1,197 parked `tsc` errors in live code on
  2026-11-12, 531 of them unused declarations).
- **Shared code before pages.** Folders are migrated after the folders they import from (shared components, utils,
  hooks, stores first), as VS Code did for `strictNullChecks`, and folder tickets are sized from what the first
  folder migration (the pilot) measured.

## Considered options

- **Keep the A1 regex and wire it into CI.** Rejected: it sees only the written word `any`, keeps one total for the
  whole frontend instead of a count per file, and duplicates what typescript-eslint does.
- **betterer** for the ratchet. Rejected: its latest npm release is an alpha last published 2024-12-01.
- **frappe_types** (The Commit Company) for DocType types. Rejected: unmaintained since 2024-05-13, already removed
  from the bench, rewrites whole files (dropping 126 extra exports across 32 of our files), renames 8 interfaces, and
  types JSON fields as `any`.
- **Hand-written DocType types with a drift check.** Rejected: on 2026-11-12, 22 of the 61 matched type files had
  drifted (40 fields missing, 24 extra, 18 wrongly typed) and 136 of 205 DocTypes had no type at all.
- **Flip the SDK default in one change** (migrate callers then delete in one wave). Rejected for its measured size
  above.
- **`no-explicit-any` as a warning.** Rejected: ESLint suppresses only errors, so a warning gives no ratchet.

## Consequences

- A pull request that adds an `any`, a source file over 500 lines, a rupee formatter or a payment sum outside its
  owner goes red. 71 files sat at 451–500 lines on 2026-11-12, so S1 is the check most likely to ask for a split.
- `any` stays legal where TypeScript needs it (a generic type-argument constraint); such a line carries an
  `eslint-disable` comment that says why.
- `pages/Retired Components` (29 files, imported by nothing, 58% of the parked `tsc` errors) is removed before the
  migration starts.

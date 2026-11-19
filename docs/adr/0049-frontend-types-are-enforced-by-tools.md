# ADR 0049 — Frontend types are enforced by tools: lint ratchet, generated DocType types, SDK calls default to `unknown`

**Status:** Accepted · 2026-11-12 (grill with the owner, Q1–Q13) · decided by the owner (Abhishek); does not change ADR-0010 ·
amended 2026-11-18: the lint engine is oxlint, not ESLint (see the Amendment at the end)

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
  upward-only percentage that also sees `any` from library defaults), and the residence checks that are not
  ADR-0010 rules (S1, R1, both P1, T1, T2; J1 and D1 since, in the Amendment). ADR-0010, accepted as amended on 2026-11-18, keeps two counters (B1,
  B3); they stay local, in the git hook only, and its other rules are review rules (its F5 counter is retired).
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
  The pilot (#1694, `pages/customers/`) ran first, on a page folder, to measure the work per session; "shared code
  before pages" governs the folder tickets cut after it (added 2026-11-16).

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

## Amendment (2026-11-18): oxlint replaces ESLint as the engine

Decided by the owner on #1687 after the trial of #1699. Every check above that names ESLint now runs through oxlint
with type-aware rules (`oxlint-tsgolint`, which builds programs with typescript-go). What the checks refuse is
unchanged; the per-folder rollout of `no-unsafe-*` is unchanged.

**Why.** Measured on the air box, both tools in the same container (4 CPUs, 4.9 GB), 3 timed runs after a warm-up:

| | ESLint 10 + typescript-eslint | oxlint `--type-aware` |
|---|---|---|
| Today's rules: median time, peak memory | 31.9 s, about 3.5 GB | 2.5 s, about 1.4 GB |
| Today's rules: counts per file and rule | 1,282 file+rule pairs | identical |
| `no-unsafe-*` on the whole tree | killed for memory in 4 of 5 runs (1 finished in 169 s) | 10.8 s |

**What moved where.**
- The config is `frontend/.oxlintrc.json` (oxlint resolves its globs from the config's own folder). The frozen
  violations are in `frontend/oxlint-suppressions.json`, made with `oxlint --suppress-all`; its counts per file and
  rule equal `eslint-suppressions.json`'s, less its `no-restricted-syntax` entries (the `.json()` ban, now in J1's
  file) and its one `jsx-a11y/no-autofocus` entry, both below. oxlint reads the file from the folder it runs in, so
  `yarn lint` runs from `frontend/`. It fails on a new violation and on a suppression no longer needed, as ESLint
  did; `yarn lint --prune-suppressions` locks in fixed ones.
- The `.json()` ban is residence check J1 (`scripts/residence_check.py`), not a lint rule: oxlint has no
  `no-restricted-syntax`, and its JS plugins are alpha, outside semver. Its 22 old calls are frozen per file in
  `frontend/json-call-suppressions.json`, and any file off its frozen count fails, so a new call fails even where
  another file loses one. J1 counts with TypeScript's own parser (`frontend/scripts/json_calls.mjs`, run by node
  from `frontend/node_modules`), so it needs node and an installed frontend; without them it fails, never passes,
  except in the commit hooks (`residence_check.py --hook`), where it warns and passes, as oxlint is skipped there:
  a worktree with no `frontend/node_modules`, or a box with no node, can still commit. CI runs J1 with the other
  residence checks, after `yarn install`, and fails there.
- oxlint honours the existing `eslint-disable` comments, under ESLint's rule names.
- A disable comment is frozen too (#1705): residence check D1 (`scripts/disable_comment_check.py`, run by
  `scripts/residence_check.py`) counts, per file and rule, the `eslint-disable` and `oxlint-disable` comments
  (`-next-line`, `-line` or file-wide) that name a rule `.oxlintrc.json` turns on for that file, under any name oxlint
  reads as it, or name no rule. Only the files a rule applies to count: a rule on only in an override counts in the
  files its `files` globs match, and a file `ignorePatterns` or a `.gitignore` names is not read, as oxlint reads
  neither. It reads every file type `oxlint src` lints (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`,
  `.cjs`). A file-wide comment counts apart from a line comment for the same rule (its key ends ` (file-wide)`), so
  widening a frozen line comment to the whole file is a new entry. It reads the comments with TypeScript's parser
  (`frontend/scripts/disable_comments.mjs`), so text in a string is not one. It also reads the HTML-like comments
  oxlint reads outside `.mjs` and `.mts`: from a `<!--` anywhere, or a `-->` at a line's start, to the line's end.
  Today's 11 are in `frontend/disable-comment-suppressions.json`; a file off its count fails, in CI and in the commit
  hooks (which skip it with a warning where node cannot run, as J1). A change that removes a comment lowers the frozen
  count in the same change, with `python3 scripts/residence_check.py --prune-disable-comments`; the ratchet check
  refuses a count that rises. Comments for a rule that is off (`react-hooks/exhaustive-deps`) are not counted.
- ESLint's frozen "rule not found" entry for `jsx-a11y/no-autofocus` (a disable comment for a plugin never loaded)
  has no oxlint counterpart and is gone.
- `scripts/frontend_ratchet_check.py` guards both files in pull requests. Against a base that holds only
  `eslint-suppressions.json` it holds them to that file's counts, so the switch itself loosens nothing.
- The same check (`scripts/frontend_ratchet_check.py`, CI step "Frontend ratchet not loosened") also refuses a pull
  request that loosens the lint settings, which `yarn lint` reads from the PR's own tree (#1702); its `.oxlintrc.json`
  comparison is `scripts/oxlint_settings_check.py`. It compares them with the base commit's and names each loosening:
  a pattern added to `ignorePatterns`, or a `!` pattern moved before an ignore pattern it followed (the last pattern
  that matches wins, so the files it brought back are skipped again); an ADR-0049 rule, plugin or category removed or
  set to `"warn"` or `"off"` (oxlint exits 0 on warnings), also under another name oxlint reads as the same rule
  (`@typescript-eslint/x`, `eslint/x`, a bare `x`), or a ban list given fewer entries or a new `!` entry, also in a
  new group (oxlint reads it as "but not these", in any group, so `["x/*", "!x/**"]` bans nothing), or a `!` entry
  moved after one it preceded (the last match wins); an override that relaxes a rule for a pattern base did not relax,
  or moved after the override that turns the rule on (the later one wins), or a rule base's overrides turn on (the
  typed path) no longer on for one of its patterns; a nested `.oxlintrc.json`, `.oxlintrc.jsonc` or `oxlint.config.*`
  in any folder but a real `node_modules` folder, which oxlint never reads (a folder whose name only ends in
  `node_modules`, such as `old_node_modules`, is read and counts), an `.eslintignore`, or a `.gitignore` that hides a
  tracked file under `frontend/src/` (oxlint reads all three on its own); a symlink under `frontend/src/` (oxlint
  lints what it points at, and D1 and J1 cannot read behind it); the `lint` script with a word dropped or
  added (only `--deny-warnings`, `--max-warnings=0` (or `--max-warnings 0`) and `--report-unused-disable-directives`
  may be added), or a new `prelint`/`postlint`; a top-level config key it does not compare (such as `extends`)
  changed; and a raised count in `scripts/residence_baseline.json` for a check CI runs. A ban rule's options are
  judged per key, by a table of what each key means (`OPTION_KEYS`, measured on oxlint 1.94: a longer `paths` or
  `importNames` bans more, a longer `allowImportNames` or `allowProperties` bans less, `allowTypeImports: true` bans
  less), and any key not in it must stay equal. A tightening passes: a rule
  switched on, a folder added to the typed path, an ignore pattern or exception dropped. It reads the settings rather
  than linting the PR with the base's settings: a rule set to `"warn"` lets no violation through in the PR that sets
  it, so a lint run would pass that PR.
- The commit hooks run oxlint where its native binary loads (CI, a native install); on a Mac whose frontend is
  installed inside the Linux dev container, inside that container; elsewhere they skip it with a note.
- `frontend/tsconfig.json` sets no `baseUrl`: typescript-go refuses it, and with it set the type-aware rules do not
  run. A test (`frontend/scripts/lint_entry_points.test.mjs`) fails if an option like it comes back.

**One result per run.** The ratchet counts findings, so they must not change from run to run. oxlint's whole-tree
`no-unsafe-*` results once did (6 findings in 2 files): `useReactTable({...})` inferred its row type from candidates
that include `any`, and the result followed the checker's order. Giving those calls their type argument
(`useReactTable<TData>`, `useReactTable<TDSItemMember>`) gave 10 identical whole-tree runs. CI now runs the type-aware
lint twice on the same tree and fails when the results differ, naming the files (`frontend/scripts/lint_same_twice.mjs`;
`--whole-tree --runs 10` repeats the whole-tree proof before a folder joins the typed list). A file it names holds a
finding whose type depends on order: give the call its type argument. `GOMAXPROCS=1` is no fix: it drops real
findings.

**Pinned, and re-checked on every upgrade.** `oxlint` 1.94.0 and `oxlint-tsgolint` 7.0.2007, exact in
`frontend/package.json`. On each upgrade check:
- `--suppress-all` and `--prune-suppressions` still exist and still write `oxlint-suppressions.json` in the same
  shape: neither is in `oxlint --help` yet (bulk suppressions are still being designed, oxc discussion #22198);
- `OXLINT_TSGOLINT_PATH` still points oxlint at tsgolint (`lint_same_twice.mjs` runs from the repo root);
- `node scripts/lint_same_twice.mjs --whole-tree --runs 10` still gives one result.

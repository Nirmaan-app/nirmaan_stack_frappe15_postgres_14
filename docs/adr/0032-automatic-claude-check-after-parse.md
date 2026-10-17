# 32. The Claude review runs automatically after a parse, is logged, and is health-checked

Date: 2026-10-12

## Status

**Accepted** (owner rulings R1-R9 and Q1-Q4, 2026-10-11 / 2026-10-12). Built in slice S2 on
`feature/boq-jev-integration`. Builds on [ADR-0005 Amendment A](0005-claude-classifier-chunking.md) (the guided
prompt, v2). The buttons named in R1 are removed in a later slice (S4); the finalize rule is S3.

## Context

Until S2 the Claude review of a parsed BoQ sheet ran only when a user pressed "Run AI pass". Three things were
wrong with that:

- **A run could die silently.** A worker killed by the queue, by memory pressure or by a restart left the sheet's
  `ai_in_progress` flag at 1 for ever. On the development copy 31 Claude flags and 34 Gemini flags were stuck,
  the oldest since June.
- **A failed run left no trace.** The worker wrote its Error Log entry and then rolled the transaction back, so
  the entry was rolled back with everything else. The `boq_ai` logger writes ERROR and above only, so the
  per-run timing and token line was never written either.
- **The examples library cost about 590 MiB of worker memory**, and stayed loaded during the Claude calls.

## Owner rulings

- **R1:** *"claude should run automatically after heuristic run. we remove both b uttons for the Gemini and claude
  Ai run. user should not have option to run the Ai pass seprately. they can only reparse the sheet if needed, in
  which case it will work exactly like a fresh parsing"*
- **R2:** *"we should increse the 10 min limit to 20 mins and also build a WAY TO CHECK TH EHEALTH of the calude
  run intermittently...aslo we need to capture the failure reasons for calude run if any so that we can c heck and
  investigate it"*
- **R3:** stuck in-progress flags are cleaned as part of the health check: *"approved"*.
- **R4:** *"i dsont want any unnecssary jobs in production"* - the examples library is still rebuilt on demand
  only. S2 adds exactly one timed job (R8) and no other.
- **R8:** a timed health check: *"yes."* - one scheduler entry every 5 minutes, plus the same check on read.
- **R9:** library memory: *"option 1 and 2"* - release the library before Claude is called, and hold it in a
  compact form that returns exactly the same examples. Dropping duplicate or blank rows (option 3) was **not**
  chosen.
- **Q2:** a Running run is failed when its last heartbeat is older than 6 minutes or it started more than 22
  minutes ago; a Queued run is failed only when its job is no longer in the queue.
- **Q3:** the Anthropic client's own retries are switched off; the app's three attempts stay.

## Decision

### 1. One Claude job per parsed sheet, queued after the parse has committed

`parse_run._run_parse_worker` makes two calls into `api/boq/wizard/ai_run_log.py` and nothing else:
`on_parse_start` when it starts, and `enqueue_after_parse` after the parse commit and before the parse event.
One job is queued for every sheet the parse left at **"Parsed"**, for upload and revision BoQs alike. A sheet that
is "Parse failed", "Hidden", "Skip" or a general-specs sheet gets none, and neither does a template BoQ. **Gemini
is never run automatically.** Many sheets mean one job each; the queue runs them one after another.

A problem in either call is logged and swallowed: it can never fail a parse.

### 2. A run for an older parse is superseded, and writes nothing

Every run records the sheet's `last_parsed_at` when it is queued. The worker compares it before it calls Claude,
and `_apply_ai_suggestions` compares it again before it writes. If the sheet has been re-parsed in between,
nothing is written, the run is logged as **Superseded**, and the page is told nothing - the newer run owns the
sheet's flag. This refusal is the only change to how suggestions are written.

### 3. Every run has a record: `BoQ AI Run Log`

One record per run - automatic, re-parse or manual, and one for a manual cache hit (Done, `cached` = 1). It holds
the trigger, the prompt version, the status (Queued / Running / Done / Failed / Superseded), the times, the last
heartbeat, chunk and token progress, the examples-library status and memory peak, and for a failure the category,
a message and a link to the Error Log entry. It is read-only in the desk and visible to System Manager only.

Failure categories: job timeout, request timeout, API error (with the status code), rate limit, service
overloaded, no key / disabled, unreadable answer, worker stopped or timed out, internal error (with the exception
class).

**The record and the Error Log never hold the API key.** Every message is passed through a scrub that removes the
configured key and anything shaped like one, and is capped at 1,000 characters.

The worker now rolls back **first** and writes the Error Log **second**, so the entry exists and can be linked.

### 4. Heartbeat and health check

The worker stamps a heartbeat when the job starts, after the library step, before every request, after every
chunk, and at the end; each stamp is committed at once. The Claude job limit is 20 minutes (Gemini's and the
parse job's stay 10).

The health check marks a run **Failed - "worker stopped or timed out"** and clears its sheet's flag when:

- it is Running and its last heartbeat is older than **6 minutes** (the 5-minute request limit plus a margin), or
- it is Running and it started more than **22 minutes** ago (the 20-minute job limit plus a margin), or
- it is Queued and its job is no longer in the queue. Time spent waiting in the queue never fails a run.

The same pass clears an in-progress flag (Claude or Gemini) that no live run record and no live queue job
accounts for. **A flag whose job may be alive is never cleared**; if the queue cannot be read, nothing is cleared.

It runs in four places: the status read the Review page polls, the start of a run, the start of a parse, and
**one scheduler entry every 5 minutes** (`ai_run_log.heal_stale_runs_task`). The timed entry makes no AI call and
never loads the library.

Answers that arrive after the health check has already failed a run are discarded.

### 5. The client's own retries are off

The Anthropic client is created with `max_retries=0`. Before S2 the client silently retried twice inside each of
the app's three attempts, so `request_timeout_seconds` was not the real limit of a request. The queue's own
"job timeout" exception is no longer treated as a retryable timeout: it ends the run at once, as "job timeout".

The prompt, the 7-key wire row and the GUIDANCE block are unchanged (the S1b fixture still reproduces byte for
byte).

### 6. The examples library is compact, and released before Claude is called

The library file is now format 2 (`examples_library_v2.pkl`). In memory it holds no per-row dictionary and no
per-token object: rows are packed columns, and the index is one postings table (row number and the token's count
in that row) reached through a sorted, packed vocabulary. A posting's weight is recomputed at look-up as
`(count * idf) / row_norm` - the same arithmetic, in the same order, that produced the stored weight of format 1.
`build_guidance` drops the library and returns the memory before it returns, so the library is not in memory
during the Claude calls.

Measured on the development copy (133,477 library rows, 48,436 distinct tokens, 10,479,594 postings):

| | Format 1 (S1b) | Format 2 (S2) |
|---|---|---|
| File size | 191.5 MB | 65.9 MB |
| Worker process after the library is loaded | 542 MiB | 224 MiB (after the look-up) |
| Worker process peak | 620 MiB | 250 MiB |
| Worker process during the Claude call | about 542 MiB (library still loaded) | 147 MiB (library released) |
| Load time | 2.1 s | 0.4 s |
| Look-up, 39-row sheet | 6.3 s | 6.9 - 7.5 s |
| Look-up, 16,851 rows | 2,065 s | 1,904 s |
| Build from committed data | not re-measured | 47 s, peak 322 MiB |

The worker process is 129 MiB before any library is loaded, so the library's own share fell from about 430 MiB
(508 at peak) to about 95 MiB (121 at peak). **The 150 MiB target is met for the library's own share and for the
process during the Claude call; it is not met for the whole process at its peak (250 MiB), because the process is
129 MiB on its own.**

**Same examples, proven:** for all 16,851 rows of the F1 test set and for BOQ-26-00059 / FPS, format 2 returns
exactly what format 1 returns - the same examples, in the same order, with the same scores (0 rows different; the
FPS GUIDANCE block is byte-identical). The rule stays: any change to this arithmetic must reproduce that.

## Consequences

- **Deployment: the timed check needs the production scheduler to be enabled** (`enable_scheduler`). With the
  scheduler off, a dead run is still healed, but only when someone opens the sheet's Review page, starts a run or
  re-parses the BoQ.
- The first Claude run after deployment rebuilds the library in the new format. The old file
  (`private/boq_ai/examples_library.pkl`, about 190 MB) is never opened again and can be deleted by hand.
- The first timed check after deployment clears every stuck flag that has no live job.
- Under a test run the automatic run is switched off (`ai_run_log._auto_run_allowed`): a parse inside a test must
  never put a real, paid job on the site's queue. Tests of the automatic run switch it on with a fake queue.
- A re-parse discards the sheet's pending suggestions (as it always did) and now queues a fresh check.
- `BoQ AI Run Log` grows by one small row per run. Nothing prunes it yet.

## A rule for new doctypes on PostgreSQL (found while building this)

Frappe names a field-level index after the field alone, and on PostgreSQL an index name is unique across the
schema. So `search_index` on a common field name (`boq`, `status`) usually creates nothing - another table already
owns the name. Worse, when a table is **altered** and one of its columns is indexed in the database but has no
`search_index` flag, Frappe runs `DROP INDEX IF EXISTS "<fieldname>"` with no table name, which removes **another
table's** index. This happened on the development copy while this doctype was being built (the `boq` index of
`BOQ Nodes` and the `status` index of `Vendor Invoices` were dropped, and restored).

`BoQ AI Run Log` therefore keeps the `search_index` flag on every column that sits in an index, and creates its
indexes in `on_doctype_update` under names of their own (`boq_ai_run_log_boq`, `boq_ai_run_log_status`). Its
doctype test fails if a column is ever indexed without the flag. Other doctypes that build multi-column indexes
over un-flagged columns still carry the hazard; they were not changed in this slice.

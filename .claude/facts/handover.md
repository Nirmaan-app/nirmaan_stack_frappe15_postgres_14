---
recorded_tip: 6746d047
recorded_branch: develop
recorded_date: 2026-06-30
handover_version: v5.73
status: STALE
---

# BoQ / Nirmaan Stack — Facts Doc (handover)

> **Purpose.** The single source of volatile truth. Anyone — a new session, a
> colleague, future-you — can resume from this doc alone.
>
> **Rule.** The frontmatter + Status dashboard below are the CURRENT record.
> Narrative further down is history and is not kept caught up.

## ⛔ THIS DOC IS STALE — DO NOT QUOTE ITS NUMBERS

Established by version-drift check on **2026-07-29**:

| | |
|---|---|
| Folded at | `6746d047` — 2026-06-30 (Nitesh, *"docs(boq-category): record rule-tuning pass"*) |
| `develop` is now at | `8f26299f` — 2026-07-28 (Abhishek Kumar) |
| **Commits behind** | **413** |

The v5.73 narrative states *"origin is still `c615b952`; the local branch is 4
ahead."* That was true on 30 June. A month and 413 commits later it describes a
repository state that no longer exists.

**Binding consequence.** Under non-negotiable #1, every volatile fact below is
unverified: branch tips, test counts, standing noise, the deferred register, and
the next-action list. **Verify in-session before quoting anything.** A facts doc
this far behind is not a source of truth, it is a source of confident wrongness
— which is the specific failure this whole process exists to prevent.

**Required before agent-driven work resumes:** a fresh fold from the owner. See
*Next action*.

## Status dashboard — ⚠️ ALL ENTRIES UNVERIFIED (as-of 2026-06-30)

- **Branch + tip (as recorded):** `develop` @ `6746d047`, 4 commits ahead of
  origin `c615b952`, classification commits LOCAL + owner-gated.
  → **superseded**; `develop` is at `8f26299f`.
- **Tests (as recorded, bench-verified at v5.41):** parser 588 · wizard 168.
  → **re-verify in-session**; ~413 commits of drift since.
- **Migrations pending for teammates:** unknown — re-derive.
- **Standing noise:** see `process-config.md`; re-confirm against `git status`.
- **Open risks:** the AI-settings toggle has flipped off unexplained — treat
  engine health as untrusted until monitored. *(Durable; carried forward.)*
- **Deferred register / time-box:** unknown — re-derive at the fold.

## Canonical command block

⚠️ Not re-verified since the fold. Confirm in-session before embedding in any
prompt — non-negotiable #1 forbids retyping these from memory.

```
# frontend unit tests (local gate; CI runs the Python bench suite only)
yarn test

# frontend dev server (:8080) — separate from bench's esbuild watcher (:8000)
yarn dev
```

## Durable conventions (NOT stale — these survive the drift)

These are stable and remain binding. Full text in
`~/.claude/skills/nirmaan-stack-delivery-process/references/nirmaan-conventions.md`.

- Pushes happen from the HOST (PowerShell), never in-container. Executor never
  pushes. *(Now also enforced by `nirmaan_guard_push.py`.)*
- Explicit `git add <path>` per file — never `git add .`
- Two-commit shape per slice: feat + docs. ASCII dashes only in commit messages.
- Never `git clean` in this repo; standing noise is DECLARED, not removed.
- Bench workers do not hot-reload — restart after pulling pipeline changes.
- Vite does not hot-reload host edits on the bind mount; the PWA service worker
  caches — de-stale before any frontend cert.
- Any migrate-carrying push: Abhishek gets a written heads-up FIRST.

## Working agreements

Referenced by number throughout the plan docs and the v5.73 narrative (#17 PK
housekeeping, #41 Checklist C first action, #45 archive rotation, #49 recon-first,
#52 build-verify-once, #53 push-from-host).

⚠️ **The numbered list itself was not recoverable** from the supplied export —
the paste arrived as 18 unbroken lines with its heading structure collapsed, so
the agreements register could not be extracted reliably. Raw source preserved at
`archive/handover-v5.73-raw.md` (240 KB). Recovering this register is part of
the fresh fold.

*(Note: `process-config.md` cites recon-first as agreement #56 while the v5.73
narrative cites #49. One of the two is stale. Resolve at the fold.)*

## Next action (strict order)

1. **Fresh fold of this handover** against `develop` @ `8f26299f`. Until then,
   agent-driven work runs without a trustworthy facts source. Needs: current
   tips, bench-verified test counts, current standing noise, the deferred
   register, and the numbered working-agreements list.
2. Re-confirm the canonical command block in-session.
3. Resolve the recon-first agreement-number conflict (#49 vs #56).

---

## History

The full v5.73 narrative — build arcs, live-cert records, prior-cycle EOS
footers back to v5.33 — is preserved verbatim at
`archive/handover-v5.73-raw.md`. It is a chat export: 18 unbroken lines, no
markdown structure. **Grep it; do not load it** (240 KB ≈ 67k tokens).

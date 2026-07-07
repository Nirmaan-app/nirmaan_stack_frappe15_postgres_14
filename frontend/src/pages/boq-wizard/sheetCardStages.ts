// Pure, React-free zone-mapping for the BoQ hub SheetCard's persistent 3-zone
// stepper (① Configure → ② Review → ③ Commit & Tender). ADR-0010 F4: the
// effective-status → zone descriptor rule lives here as ONE deterministic
// function so it is unit-testable without React. SheetCard.tsx renders the
// descriptors and interpolates the dynamic bits (dates, reasons) the helper
// deliberately does NOT own.
//
// Design split:
//   - THIS helper owns the STRUCTURE: aside classification, per-stage state,
//     the button-bearing zone, and the STATIC marker text/tone/accent.
//   - The component owns DYNAMIC text (last-parsed date, parse-failure reason,
//     committed version/timestamp) -- those are display data, not mapping rules.
//
// General-specs is DERIVED (passed in as effectiveStatus by the caller from
// BOQs.general_specs_sheets membership, M2.16) -- this helper never re-derives it.

import type { CommittedSheetState } from "./boqTypes";

/**
 * Colour register for a zone node/marker. Mirrors the STATUS_PILL semantics
 * one-to-one; SheetCard.tsx maps each token to Tailwind classes (ONE place).
 */
export type StageAccent =
  | "pending"
  | "config"
  | "skip"
  | "gspec"
  | "parsed"
  | "final"
  | "failed"
  | "hidden"
  | "committed";

/**
 * Per-zone state.
 *   active       -- the current actionable stage: filled accent node + tinted band + buttons.
 *   active-done  -- active AND completed (Config Done in ①, Finalized in ②): accent tick + band + buttons.
 *   done         -- completed & passive: green (config) check, no buttons (collapsed summary line).
 *   unreached    -- muted italic dash ("— not started" / "— not committed"), rendered but inert.
 *   na           -- stage does NOT apply (aside skip/hidden/general-specs) -> NOT rendered.
 *   committed    -- ③ lit indigo (read-only badge block) -- NOT rendered as na.
 *   hidden       -- ③ not applicable (uncommitted aside / general-specs) -> NOT rendered.
 */
export type StageState =
  | "active"
  | "active-done"
  | "done"
  | "unreached"
  | "na"
  | "committed"
  | "hidden";

/** How a marker is drawn. dot = coloured dot + text; tick = ✓ + text; badge = pill (aside); muted = italic dash. */
export type StageMarkerKind = "dot" | "tick" | "badge" | "muted";

/** The STATIC marker content (dynamic subs -- dates/reasons -- are appended by the component). */
export interface StageMarker {
  kind: StageMarkerKind;
  /** Full label text. For `muted` this includes the leading em-dash (e.g. "— not committed"). */
  label: string;
  /** Optional static sub-text (no leading separator). e.g. "not configured", "set aside from this workbook". */
  sub?: string;
  /** Colour register for dot/tick/badge. Omitted for muted markers. */
  accent?: StageAccent;
}

export interface StageDescriptor {
  state: StageState;
  marker: StageMarker;
}

export interface SheetStages {
  /** Set-aside classification -- collapses the rail. null = normal pipeline (renders all three zones). */
  aside: "skip" | "hidden" | "general_specs" | null;
  /** Which zone renders the action-button row: 1 = Configure, 2 = Review, null = none (selector-governed / footer). */
  buttonZone: 1 | 2 | null;
  stage1: StageDescriptor;
  stage2: StageDescriptor;
  stage3: StageDescriptor;
}

export interface ComputeSheetStagesInput {
  /** Effective status (may be "General specs" even when wizard_status differs -- M2.16, derived by caller). */
  effectiveStatus: string;
  /** draft.has_prior_parse === 1 -- drives the Config-Done dirty ("last parsed …") affordance. */
  hasPriorParse: boolean;
  /** This sheet's current committed-state, when committed (undefined => never committed). Lights ③. */
  committed?: CommittedSheetState;
}

// ── Marker builders (keep the mapping table below terse + declarative) ─────────
const mDot = (label: string, accent: StageAccent, sub?: string): StageMarker => ({ kind: "dot", label, accent, sub });
const mTick = (label: string, accent: StageAccent, sub?: string): StageMarker => ({ kind: "tick", label, accent, sub });
const mBadge = (label: string, accent: StageAccent, sub?: string): StageMarker => ({ kind: "badge", label, accent, sub });
const mMuted = (label: string): StageMarker => ({ kind: "muted", label });

// Stage ① collapsed-summary marker shared by every parsed-onwards status.
const CONFIG_DONE_SUMMARY: StageMarker = mTick("Config Done", "config");
const NOT_COMMITTED: StageMarker = mMuted("— not committed");

/**
 * Map one sheet's effective status (+ prior-parse + committed-state) to its 3-zone descriptor.
 * Deterministic and side-effect-free. The zone-mapping table (mockup §06 / plan WI-2 B-2) is
 * realised here as a switch; an unknown status falls back to the Pending shape (mirrors the old
 * `STATUS_PILL[...] ?? STATUS_PILL["Pending"]` fallback).
 */
export function computeSheetStages(input: ComputeSheetStagesInput): SheetStages {
  // hasPriorParse stays in the input contract (plan WI-2 B-1) but the dirty "last parsed …"
  // sub is interpolated in the component from the live date -- the mapping itself doesn't branch on it.
  const { effectiveStatus, committed } = input;
  const isCommitted = !!committed;

  switch (effectiveStatus) {
    // ── Set-aside (rail collapses to a single zone) ──────────────────────────
    case "Skip":
      return {
        aside: "skip",
        buttonZone: 1,
        stage1: { state: "active", marker: mBadge("Skipped", "skip", "set aside from this workbook") },
        stage2: { state: "na", marker: mMuted("") },
        stage3: { state: "hidden", marker: mMuted("") },
      };

    case "Hidden":
      return {
        aside: "hidden",
        buttonZone: 1,
        stage1: { state: "active", marker: mBadge("Hidden", "hidden", "auto-hidden non-data sheet") },
        stage2: { state: "na", marker: mMuted("") },
        stage3: { state: "hidden", marker: mMuted("") },
      };

    case "General specs":
      // Selector-governed (no ① buttons). ② omitted. ③ lights ONLY when committed (grid-only commit).
      return {
        aside: "general_specs",
        buttonZone: null,
        stage1: { state: "active", marker: mBadge("General specs", "gspec", "preamble-only sheet") },
        stage2: { state: "na", marker: mMuted("") },
        stage3: isCommitted
          ? { state: "committed", marker: mMuted("") }
          : { state: "hidden", marker: mMuted("") },
      };

    // ── Stage ① · Configure ──────────────────────────────────────────────────
    case "Config Done":
      return {
        aside: null,
        buttonZone: 1,
        stage1: { state: "active-done", marker: mTick("Config Done", "config") },
        stage2: { state: "unreached", marker: mMuted("— awaiting parse") },
        stage3: isCommitted ? { state: "committed", marker: mMuted("") } : { state: "unreached", marker: NOT_COMMITTED },
      };

    // ── Stage ② · Parse & Review ─────────────────────────────────────────────
    case "Parse failed":
      return {
        aside: null,
        buttonZone: 2,
        stage1: { state: "done", marker: CONFIG_DONE_SUMMARY },
        stage2: { state: "active", marker: mDot("Parse failed", "failed") },
        stage3: isCommitted ? { state: "committed", marker: mMuted("") } : { state: "unreached", marker: NOT_COMMITTED },
      };

    case "Parsed":
      return {
        aside: null,
        buttonZone: 2,
        stage1: { state: "done", marker: CONFIG_DONE_SUMMARY },
        stage2: { state: "active", marker: mDot("Parsed", "parsed") },
        // A re-parsed sheet can still carry a frozen committed version -> light ③ so its
        // downstream-orphan chip has a home (the exact orphan scenario). Refinement over the
        // plan table's literal "Parsed -> ③ unreached" (which assumed the never-committed path).
        stage3: isCommitted ? { state: "committed", marker: mMuted("") } : { state: "unreached", marker: NOT_COMMITTED },
      };

    case "Finalized":
      return {
        aside: null,
        buttonZone: 2,
        stage1: { state: "done", marker: CONFIG_DONE_SUMMARY },
        stage2: { state: "active-done", marker: mTick("Finalized", "final") },
        stage3: isCommitted ? { state: "committed", marker: mMuted("") } : { state: "unreached", marker: NOT_COMMITTED },
      };

    // ── Pending (+ unknown-status fallback) ──────────────────────────────────
    case "Pending":
    default:
      return {
        aside: null,
        buttonZone: 1,
        stage1: { state: "active", marker: mDot("Pending", "pending", "not configured") },
        stage2: { state: "unreached", marker: mMuted("— not started") },
        stage3: isCommitted ? { state: "committed", marker: mMuted("") } : { state: "unreached", marker: NOT_COMMITTED },
      };
  }
}

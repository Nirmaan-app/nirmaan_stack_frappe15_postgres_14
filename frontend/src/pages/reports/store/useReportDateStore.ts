import { create } from "zustand";
import { useMemo, useState, useEffect } from "react";
import { DateRange } from "react-day-picker";
import { startOfDay, endOfDay, parse, formatISO } from "date-fns";
import { datePresets } from "@/utils/datePresents";
import { urlStateManager } from "@/utils/urlStateManager";

/**
 * Shared date-range selection for ALL Projects-tab report types (Cash Sheet,
 * Inflow, Outflow). Goals:
 *
 *  1. CONSISTENT across report types — pick a range once and it applies whether
 *     you're on Inflow, Outflow or Cash Sheet (single source of truth, one set
 *     of URL keys), instead of each report remembering its own range.
 *  2. NEVER FREEZES — a relative preset ("Last 30 days", "This month"…) is
 *     stored by its *label*, not by fixed dates, and the actual window is
 *     recomputed from today's date on every read. So reopening the report the
 *     next day shows the current window, not a stale one. Only *custom* calendar
 *     ranges are stored as fixed dates (those are meant to stay put).
 */

// Single shared URL keys (replace the old per-report *_from / *_to keys).
const K_PRESET = "rpt_date_preset";
const K_FROM = "rpt_date_from";
const K_TO = "rpt_date_to";

export type ReportDateSelection =
  | { kind: "all" }
  | { kind: "preset"; label: string }
  | { kind: "custom"; from: string; to: string }; // from/to are 'yyyy-MM-dd'

const toISODate = (d: Date) => formatISO(d, { representation: "date" });

const readInitialSelection = (): ReportDateSelection => {
  const preset = urlStateManager.getParam(K_PRESET);
  if (preset) return { kind: "preset", label: preset };
  const from = urlStateManager.getParam(K_FROM);
  const to = urlStateManager.getParam(K_TO);
  if (from && to) return { kind: "custom", from, to };
  return { kind: "all" };
};

const persist = (s: ReportDateSelection) => {
  urlStateManager.updateParam(K_PRESET, s.kind === "preset" ? s.label : null);
  urlStateManager.updateParam(K_FROM, s.kind === "custom" ? s.from : null);
  urlStateManager.updateParam(K_TO, s.kind === "custom" ? s.to : null);
};

// A picked DateRange → selection. If it matches a LIVE preset window, store the
// preset (so it stays relative); otherwise store the explicit custom dates.
const rangeToSelection = (range?: DateRange): ReportDateSelection => {
  if (!range?.from || !range?.to) return { kind: "all" };
  const f = toISODate(range.from);
  const t = toISODate(range.to);
  const match = datePresets.find((p) => {
    const r = p.getRange();
    return r?.from && r?.to && toISODate(r.from) === f && toISODate(r.to) === t;
  });
  return match ? { kind: "preset", label: match.label } : { kind: "custom", from: f, to: t };
};

// Selection → the LIVE DateRange (presets are recomputed from today's date).
export const selectionToRange = (s: ReportDateSelection): DateRange | undefined => {
  if (s.kind === "preset") {
    const p = datePresets.find((pp) => pp.label === s.label);
    return p ? p.getRange() : undefined;
  }
  if (s.kind === "custom") {
    return {
      from: startOfDay(parse(s.from, "yyyy-MM-dd", new Date())),
      to: endOfDay(parse(s.to, "yyyy-MM-dd", new Date())),
    };
  }
  return undefined;
};

interface ReportDateState {
  selection: ReportDateSelection;
  setRange: (range?: DateRange) => void; // from StandaloneDateFilter onChange
  setCustomRange: (from: string, to: string) => void; // from cross-report deep-links
  clear: () => void;
}

export const useReportDateStore = create<ReportDateState>((set) => ({
  selection: readInitialSelection(),
  setRange: (range) => {
    const s = rangeToSelection(range);
    persist(s);
    set({ selection: s });
  },
  setCustomRange: (from, to) => {
    const s: ReportDateSelection = { kind: "custom", from, to };
    persist(s);
    set({ selection: s });
  },
  clear: () => {
    const s: ReportDateSelection = { kind: "all" };
    persist(s);
    set({ selection: s });
  },
}));

/**
 * Convenience hook for report components. Returns the live DateRange plus the
 * onChange / onClear handlers to wire directly into <StandaloneDateFilter>.
 */
export const useSharedReportDateRange = () => {
  const selection = useReportDateStore((s) => s.selection);
  const setRange = useReportDateStore((s) => s.setRange);
  const clear = useReportDateStore((s) => s.clear);

  // Track the current calendar day so a RELATIVE preset window is recomputed
  // when the day rolls over — even on a tab left open across midnight. State
  // only changes on an actual day change (no needless re-renders/refetches),
  // and the focus listener catches a backgrounded tab the moment you return.
  const [day, setDay] = useState(() => formatISO(new Date(), { representation: "date" }));
  useEffect(() => {
    const check = () => {
      const d = formatISO(new Date(), { representation: "date" });
      setDay((prev) => (prev === d ? prev : d));
    };
    window.addEventListener("focus", check);
    const id = window.setInterval(check, 60_000);
    return () => {
      window.removeEventListener("focus", check);
      window.clearInterval(id);
    };
  }, []);

  const dateRange = useMemo(() => selectionToRange(selection), [selection, day]);
  return { dateRange, onChange: setRange, onClear: clear };
};

// src/pages/outflow-import/useOutflowPeriodStore.ts

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { formatISO } from "date-fns";

import type { DateFilterValue } from "@/components/data-table/date-filter-popover";
import { urlStateManager } from "@/utils/urlStateManager";
import { resolveDateFilter, type ResolvedDateRange } from "@/utils/dateFilterRange";

import { periodFromParams, periodToParams, PERIOD_URL_KEYS } from "./outflowPeriod";

/**
 * The ONE period the Bulk Import Outflow screen is scoped to (slice P1).
 *
 * ⚠️ A STORE, NOT PAGE STATE, BECAUSE FOUR SURFACES READ IT AND ONE OF THEM IS NOT A CHILD. The
 * summary panel, the master table (`useOutflowRows`), the Skipped dialog (its OWN separate
 * `useOutflowRows` instance) and the confirm dialog all have to select the same population. Threading
 * a prop through would work for three of them and quietly not for the Skipped dialog, whose table is
 * a second instance of the same hook — and a Skipped chip counting one window while its dialog listed
 * another is precisely the class of defect this feature has already shipped once.
 *
 * Modelled on `pages/reports/store/useReportDateStore.ts`, which solved the same problem for the
 * report screens, and keeps its two good properties:
 *
 *  1. NEVER FREEZES — a relative window is stored as the WORD ("last 30 days") and resolved against
 *     a live today on every read, so a tab left open across midnight is not filtering on yesterday.
 *  2. LINKABLE — the choice rides the URL, so a narrowed screen can be sent to somebody.
 *
 * ⚠️ IT DELIBERATELY DOES NOT SHARE THE REPORTS' `rpt_date_*` KEYS. Those are shared ACROSS reports
 * on purpose; this screen is not one of them and its date means a different thing (a transfer's
 * `added_on` on a staged import row, not a payment date on a ledger). Sharing them would make
 * walking from a report to this screen silently rewrite one of the two.
 */

interface OutflowPeriodState {
    /** `null` = all time. Never `undefined` — see `periodFromParams` on why absent means default. */
    period: DateFilterValue | null;
    setPeriod: (value: DateFilterValue | undefined | null) => void;
}

const readInitial = (): DateFilterValue | null =>
    periodFromParams({
        [PERIOD_URL_KEYS.operator]: urlStateManager.getParam(PERIOD_URL_KEYS.operator),
        [PERIOD_URL_KEYS.from]: urlStateManager.getParam(PERIOD_URL_KEYS.from),
        [PERIOD_URL_KEYS.to]: urlStateManager.getParam(PERIOD_URL_KEYS.to),
    });

const persist = (value: DateFilterValue | null) => {
    const params = periodToParams(value);
    for (const [key, param] of Object.entries(params)) {
        urlStateManager.updateParam(key, param);
    }
};

export const useOutflowPeriodStore = create<OutflowPeriodState>((set) => ({
    period: readInitial(),
    setPeriod: (value) => {
        const next = value ?? null;
        persist(next);
        set({ period: next });
    },
}));

export interface OutflowPeriod {
    /** The stored value. Both editors bind to this. */
    period: DateFilterValue | null;
    setPeriod: (value: DateFilterValue | undefined | null) => void;
    /** The live window, resolved from today. Absent bounds mean unbounded on that side. */
    range: ResolvedDateRange;
}

/**
 * The period, plus the dates it currently resolves to.
 *
 * ⚠️ THE DAY IS TRACKED SO A RELATIVE WINDOW ROLLS OVER. `resolveDateFilter` reads `new Date()`, but
 * React will not re-run a memo because the clock moved — so a tab left open across midnight would
 * keep querying yesterday's window while the label said "Today". The state only changes on an actual
 * day change (no needless refetches), and the focus listener catches a backgrounded tab the moment
 * somebody comes back to it. Lifted verbatim from `useSharedReportDateRange`, which learned this the
 * same way.
 */
export const useOutflowPeriod = (): OutflowPeriod => {
    const period = useOutflowPeriodStore((s) => s.period);
    const setPeriod = useOutflowPeriodStore((s) => s.setPeriod);

    const [day, setDay] = useState(() => formatISO(new Date(), { representation: "date" }));
    useEffect(() => {
        const check = () => {
            const today = formatISO(new Date(), { representation: "date" });
            setDay((prev) => (prev === today ? prev : today));
        };
        window.addEventListener("focus", check);
        const id = window.setInterval(check, 60_000);
        return () => {
            window.removeEventListener("focus", check);
            window.clearInterval(id);
        };
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- `day` is the clock, not a value read here
    const range = useMemo(() => resolveDateFilter(period), [period, day]);

    return { period, setPeriod, range };
};

/**
 * The Expense Packages table's search and filters (Packages Settings → Expense Packages), pure so it
 * tests without React. Client-side over the types the table already loads: every filter, and the
 * search, narrows with AND; within one filter, any of its picks matches.
 */
import { asPayeeRule, type PayeeRule } from "@/utils/payees/expensePayee";

export type ScopeLabel = "Project" | "Non-Project" | "Both" | "Unusable";

export const SCOPES: ScopeLabel[] = ["Project", "Non-Project", "Both", "Unusable"];

interface ScopeFlags {
    project?: boolean | 0 | 1 | null;
    non_project?: boolean | 0 | 1 | null;
}

/** Which ledgers a type may be raised on; neither flag means the request form refuses it. */
export const scopeOf = (t: ScopeFlags): ScopeLabel =>
    t.project && t.non_project ? "Both"
        : t.project ? "Project"
            : t.non_project ? "Non-Project"
                : "Unusable";

/** The Role Access filter's choice for a type that lists no role profile (only Admin may pick it). */
export const ADMIN_ONLY = "__admin_only__";

export type ConfirmedChoice = "Yes" | "No";

export const CONFIRMED_CHOICES: ConfirmedChoice[] = ["Yes", "No"];

export interface PackageFilters {
    scopes: ReadonlySet<ScopeLabel>;
    payeeRules: ReadonlySet<PayeeRule>;
    /** Role profiles, and `ADMIN_ONLY`. */
    roles: ReadonlySet<string>;
    confirmed: ReadonlySet<ConfirmedChoice>;
}

export const NO_PACKAGE_FILTERS: PackageFilters = {
    scopes: new Set(),
    payeeRules: new Set(),
    roles: new Set(),
    confirmed: new Set(),
};

export const hasActiveFilters = (f: PackageFilters): boolean =>
    f.scopes.size > 0 || f.payeeRules.size > 0 || f.roles.size > 0 || f.confirmed.size > 0;

export interface FilterableType extends ScopeFlags {
    name: string;
    payee_rule?: string | null;
    confirmed_as_request?: boolean | 0 | 1 | null;
}

const matchesRoles = (picked: ReadonlySet<string>, listed: string[]): boolean =>
    listed.length === 0 ? picked.has(ADMIN_ONLY) : listed.some((r) => picked.has(r));

export function filterExpenseTypes<T extends FilterableType>(
    types: T[],
    { search, filters, allowedByType }: {
        search: string;
        filters: PackageFilters;
        /** `{type: [role profile, ...]}`; a type absent here lists no role. */
        allowedByType: Record<string, string[]>;
    },
): T[] {
    const q = search.trim().toLowerCase();
    return types.filter((t) =>
        (!q || t.name.toLowerCase().includes(q))
        && (filters.scopes.size === 0 || filters.scopes.has(scopeOf(t)))
        && (filters.payeeRules.size === 0 || filters.payeeRules.has(asPayeeRule(t.payee_rule)))
        && (filters.roles.size === 0 || matchesRoles(filters.roles, allowedByType[t.name] ?? []))
        && (filters.confirmed.size === 0 || filters.confirmed.has(t.confirmed_as_request ? "Yes" : "No"))
    );
}

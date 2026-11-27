/** What `CashflowPlan` hands each tab for its search box: the parsed words (filter) and the typed text (message). */
export interface CashflowTabSearchProps {
    searchWords?: string[];
    searchText?: string;
}

/** The empty state every Cashflow tab shows when the search matches none of its plans (no "Create" button: the
 *  plans exist, the search hides them). */
export const CashflowNoSearchMatch = ({ query }: { query: string }) => (
    <div className="text-center py-10 bg-gray-50/50 rounded-lg border border-dashed text-gray-500 text-sm">
        No plans in this tab match "{query.trim()}".
    </div>
);

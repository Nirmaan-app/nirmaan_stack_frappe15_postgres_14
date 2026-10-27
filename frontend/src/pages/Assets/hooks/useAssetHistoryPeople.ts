import { useFrappeGetDocList } from 'frappe-react-sdk';

export interface HistoryPerson {
    name: string;
    full_name: string;
}

/**
 * Everyone's display name, sorted by name, for the asset history: the history card turns ids into
 * names, the History tab also builds its Person filter from it. Both share this one query, because an
 * SWR key must always mean the same query -- otherwise whichever screen loads first decides what the
 * other one gets (the filter used to come out unsorted).
 */
export function useAssetHistoryPeople() {
    return useFrappeGetDocList<HistoryPerson>(
        'Nirmaan Users',
        { fields: ['name', 'full_name'], orderBy: { field: 'full_name', order: 'asc' }, limit: 0 },
        'asset_history_user_names'
    );
}

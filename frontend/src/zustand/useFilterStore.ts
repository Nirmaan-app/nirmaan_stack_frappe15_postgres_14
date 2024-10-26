import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FilterData {
    [key: string]: {
        [title: string]: string[];
    };
}

interface FilterStore {
    filters: FilterData;
    setFilters: (route: string, title: string, values: string[]) => void;
    clearFilters: (route: string, title: string) => void;
    getFilters: (route: string, title: string) => string[] | undefined;
}

export const useFilterStore = create<FilterStore>()(
    persist(
        (set, get) => ({
            filters: {},
            setFilters: (route, title, values) => {
                set((state) => {
                    const currentFilters = state.filters[route] || {};
                    return {
                        filters: {
                            ...state.filters,
                            [route]: {
                                ...currentFilters,
                                [title]: values,
                            },
                        },
                    };
                });
            },
            clearFilters: (route, title) => {
                set((state) => {
                    const currentFilters = state.filters[route] || {};
                    const newFilters = { ...currentFilters };
                    delete newFilters[title];
                    return {
                        filters: {
                            ...state.filters,
                            [route]: newFilters,
                        },
                    };
                });
            },
            getFilters: (route, title) => {
                const currentFilters = get().filters[route] || {};
                return currentFilters[title];
            },
        }),
        {
            name: 'filter-store',
            storage: createJSONStorage(() => localStorage),
        }
    )
);

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FilterData {
    [key: string]: {
        [title: string]: string[];
    };
}

interface TextSearchData {
    [route: string]: string | undefined;
}

interface FilterStore {
    filters: FilterData;
    textSearch: TextSearchData;
    setFilters: (route: string, title: string, values: string[]) => void;
    clearFilters: (route: string, title: string) => void;
    getFilters: (route: string, title: string) => string[] | undefined;
    setTextSearch: (route: string, search: string) => void;
    getTextSearch: (route: string) => string | undefined;
    clearTextSearch: (route: string) => void;
}

export const useFilterStore = create<FilterStore>()(
    persist(
        (set, get) => ({
            filters: {},
            textSearch: {},
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
            setTextSearch: (route, search) => {
                set((state) => ({
                    textSearch: {
                        ...state.textSearch,
                        [route]: search,
                    },
                }));
            },
            getTextSearch: (route) => {
                return get().textSearch[route];
            },
            clearTextSearch: (route) => {
                set((state) => {
                    const newTextSearch = { ...state.textSearch };
                    delete newTextSearch[route];
                    return { textSearch: newTextSearch };
                });
            },
        }),
        {
            name: 'filter-store',
            storage: createJSONStorage(() => localStorage),
        }
    )
);

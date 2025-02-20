import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FrappeDataStoreType {
    procurementRequestList: any[];
    procurementRequestLoading: boolean;
    procurementRequestError: string | null;
    projects: any[];
    projectsLoading: boolean;
    projectsError: string | null;
    setProcurementRequestList: (data: any[]) => void;
    setProcurementRequestLoading: (loading: boolean) => void;
    setProcurementRequestError: (error: string | null) => void;
    setProjects: (data: any[]) => void;
    setProjectsLoading: (loading: boolean) => void;
    setProjectsError: (error: string | null) => void;
    selectedData: any[];
    setSelectedData: (data: any[]) => void;
}

export const useFrappeDataStore = create<FrappeDataStoreType>()(
    persist(
        (set) => ({
            procurementRequestList: [],
            procurementRequestLoading: true,
            procurementRequestError: null,
            projects: [],
            projectsLoading: true,
            projectsError: null,
            selectedData: [],
            setSelectedData: (data) => set({selectedData: data}),
            setProcurementRequestList: (data) => set({ procurementRequestList: data }),
            setProcurementRequestLoading: (loading) => set({ procurementRequestLoading: loading }),
            setProcurementRequestError: (error) => set({ procurementRequestError: error }),
            setProjects: (data) => set({ projects: data }),
            setProjectsLoading: (loading) => set({ projectsLoading: loading }),
            setProjectsError: (error) => set({ projectsError: error })
        }),
        {
            name: 'procurement-store', // Name of the store in sessionStorage
            storage: createJSONStorage(() => sessionStorage), // Persist in sessionStorage
        }
    )
);

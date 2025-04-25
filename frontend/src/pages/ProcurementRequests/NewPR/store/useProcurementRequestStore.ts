import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { ProcurementRequestItem, CategorySelection } from '../types'; // Define these types

// Define the shape of your store's state
interface ProcurementRequestState {
    mode: 'create' | 'edit' | 'resolve';
    projectId: string | null;
    prId: string | null; // Only for edit/resolve
    selectedWP: string;
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[]; // Store derived categories
    undoStack: ProcurementRequestItem[]; // For undo functionality
    newPRComment: string;
    isInitialized: boolean; // Flag to check if store is loaded from storage

    // Actions - Functions to modify the state
    initialize: (
        mode: 'create' | 'edit' | 'resolve',
        projectId: string,
        prId?: string,
        initialData?: { workPackage: string, procList: ProcurementRequestItem[], categories: CategorySelection[] }
    ) => void;
    setSelectedWP: (wp: string) => void;
    addProcItem: (item: ProcurementRequestItem) => boolean; // Returns true if added, false if duplicate
    updateProcItem: (updatedItem: Partial<ProcurementRequestItem> & { name: string }) => void;
    deleteProcItem: (itemName: string) => void;
    undoDelete: () => void;
    setNewPRComment: (comment: string) => void;
    resetStore: () => void; // To clear state and storage after submission/cancellation
    _recalculateCategories: () => void; // Internal helper
}

// Helper to derive categories from the procList
const deriveCategories = (procList: ProcurementRequestItem[]): CategorySelection[] => {
    const categoriesMap = new Map<string, { name: string; status: string }>();
    procList.forEach(item => {
        const key = `${item.category}-${item.status}`; // Unique key per category and status
        if (!categoriesMap.has(key)) {
            categoriesMap.set(key, { name: item.category, status: item.status });
        }
    });
    return Array.from(categoriesMap.values());
};

// Create the store
export const useProcurementRequestStore = create<ProcurementRequestState>()(
    persist(
        (set, get) => ({
            // Initial State
            mode: 'create',
            projectId: null,
            prId: null,
            selectedWP: '',
            procList: [],
            selectedCategories: [],
            undoStack: [],
            newPRComment: '',
            isInitialized: false,

            // --- Actions ---
            initialize: (mode, projectId, prId, initialData) => {
                const currentState = get();
                // Only initialize if not already initialized or if project/prId changes
                if (!currentState.isInitialized || currentState.projectId !== projectId || currentState.prId !== prId) {
                    console.log("Initializing store for:", { mode, projectId, prId });
                    set({
                        mode,
                        projectId,
                        prId: prId || null,
                        selectedWP: initialData?.workPackage || '',
                        procList: initialData?.procList || [],
                        selectedCategories: initialData?.categories || [],
                        undoStack: [],
                        newPRComment: '',
                        isInitialized: true, // Mark as initialized
                    });
                    get()._recalculateCategories(); // Recalculate after setting initial data
                }
            },

            setSelectedWP: (wp) => set({ selectedWP: wp, procList: [], selectedCategories: [], undoStack: [] }), // Reset list when WP changes

            _recalculateCategories: () => {
                set(state => ({
                    selectedCategories: deriveCategories(state.procList)
                }));
            },

            addProcItem: (item) => {
                const currentList = get().procList;
                const isDuplicate = currentList.some(i => i.name === item.name);
                if (isDuplicate) {
                    return false; // Indicate duplication
                }
                // If item was in undo stack, remove it
                const stack = get().undoStack.filter(stackItem => stackItem.name !== item.name);

                set(state => ({
                    procList: [...state.procList, { ...item, uniqueId: item.uniqueId || uuidv4() }], // Ensure uniqueId
                    undoStack: stack
                }));
                get()._recalculateCategories();
                return true; // Indicate success
            },

            updateProcItem: (updatedItem) => {
                set(state => ({
                    procList: state.procList.map(item =>
                        item.name === updatedItem.name ? { ...item, ...updatedItem } : item
                    )
                }));
                // Note: Category status might change, recalculate
                get()._recalculateCategories();
            },

            deleteProcItem: (itemName) => {
                const itemToDelete = get().procList.find(item => item.name === itemName);
                if (itemToDelete) {
                    set(state => ({
                        procList: state.procList.filter(item => item.name !== itemName),
                        undoStack: [...state.undoStack, itemToDelete] // Add to undo stack
                    }));
                    get()._recalculateCategories();
                }
            },

            undoDelete: () => {
                const stack = get().undoStack;
                if (stack.length > 0) {
                    const itemToRestore = stack[stack.length - 1]; // Get last item
                    set(state => ({
                        procList: [...state.procList, itemToRestore],
                        undoStack: state.undoStack.slice(0, -1) // Remove last item from stack
                    }));
                    get()._recalculateCategories();
                }
            },

            setNewPRComment: (comment) => set({ newPRComment: comment }),

            resetStore: () => {
                console.log("Resetting store and clearing session storage.");
                set({
                    mode: 'create',
                    projectId: null,
                    prId: null,
                    selectedWP: '',
                    procList: [],
                    selectedCategories: [],
                    undoStack: [],
                    newPRComment: '',
                    isInitialized: false, // Reset initialization flag
                });
                // The `persist` middleware should handle clearing storage on reset if configured correctly.
                // Manually clear if needed: sessionStorage.removeItem('procurement-request-storage');
            },
        }),
        {
            name: 'procurement-request-storage', // Unique name for storage
            storage: createJSONStorage(() => sessionStorage), // Use sessionStorage
            // Only persist parts of the state needed for draft recovery
            partialize: (state) => ({
                mode: state.mode,
                projectId: state.projectId,
                prId: state.prId,
                selectedWP: state.selectedWP,
                procList: state.procList,
                selectedCategories: state.selectedCategories, // Persist derived categories for faster load
                newPRComment: state.newPRComment,
                // Do NOT persist undoStack or isInitialized usually
            }),
            // Custom logic on rehydration (e.g., version migration) if needed
            onRehydrateStorage: (state) => {
                console.log("Rehydrating state from session storage");
                return (state, error) => {
                    if (error) {
                        console.error("Failed to rehydrate state:", error);
                        // Handle error, maybe clear storage or reset state
                        state?.resetStore?.();
                    } else if (state) {
                        state.isInitialized = true; // Mark as initialized after loading
                        // state._recalculateCategories(); // Recalculate categories after loading persisted list
                    }
                };
            },
            version: 1, // Optional: for migrations
        }
    )
);
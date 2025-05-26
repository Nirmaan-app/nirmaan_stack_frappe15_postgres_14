import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { ProcurementRequestItem, CategorySelection, CategoryMakesMap } from '../types';

// Interface for session-added makes state
type SessionAddedMakes = Record<string, Set<string>>; // CategoryName -> Set<MakeName>

interface ProcurementRequestState {
    mode: 'create' | 'edit' | 'resolve';
    projectId: string | null;
    prId: string | null;
    selectedWP: string;
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[]; // The final derived list with all relevant makes
    undoStack: ProcurementRequestItem[];
    newPRComment: string;
    isInitialized: boolean;
    initialCategoryMakes: CategoryMakesMap; // Baseline makes from Project for the selected WP
    sessionAddedMakes: SessionAddedMakes; // <<< NEW: Track makes added via dialog

    // --- Actions ---
    initialize: (
        mode: 'create' | 'edit' | 'resolve',
        projectId?: string,
        prId: string | undefined,
        wpSpecificInitialMakes: CategoryMakesMap | undefined,
        initialPrData?: { workPackage: string, procList: ProcurementRequestItem[], categories: CategorySelection[] }
    ) => void;
    setSelectedWP: (wp: string, wpSpecificMakes: CategoryMakesMap) => void;
    addProcItem: (item: ProcurementRequestItem) => boolean;
    updateProcItem: (updatedItem: Partial<ProcurementRequestItem> & { name: string }) => void;
    deleteProcItem: (itemName: string) => void;
    undoDelete: () => void;
    setNewPRComment: (comment: string) => void;
    updateCategoryMakes: (categoryName: string, newMake: string) => void; // Signature remains the same
    resetStore: () => void;
    _recalculateCategories: () => void;
}

// Helper to derive categories, now incorporating sessionAddedMakes
const deriveCategoriesWithMakes = (
    procList: ProcurementRequestItem[],
    initialMakesMap: CategoryMakesMap, // Baseline makes for the WP
    sessionMakesMap: SessionAddedMakes // Explicitly added makes this session
): CategorySelection[] => {
    console.log("Deriving categories with:", { procList, initialMakesMap, sessionMakesMap });
    const categoriesMap = new Map<string, { status: string; makes: Set<string> }>(); // Map: categoryName -> {status, makesSet}

    // 1. Process items in the list to determine active categories and makes used
    procList.forEach(item => {
        let categoryEntry = categoriesMap.get(item.category);
        if (!categoryEntry) {
            categoryEntry = { status: item.status, makes: new Set() };
            categoriesMap.set(item.category, categoryEntry);
        }
        // Update status if needed (e.g., if 'Request' exists, keep it)
        if (item.status === 'Request' && categoryEntry.status !== 'Request') {
            categoryEntry.status = 'Request';
        }
        if (item.make) {
            categoryEntry.makes.add(item.make);
        }
    });

    // 2. Ensure all categories with initial or session makes are included, even if no item uses them yet
    const allConsideredCategories = new Set([
        ...Object.keys(initialMakesMap),
        ...Object.keys(sessionMakesMap),
        ...procList.map(item => item.category)
    ]);

    const finalCategories: CategorySelection[] = [];

    allConsideredCategories.forEach(categoryName => {
        const baselineMakes = initialMakesMap[categoryName] || [];
        const sessionMakes = sessionMakesMap[categoryName] || new Set<string>();
        const makesFromItems = categoriesMap.get(categoryName)?.makes || new Set<string>();

        // Combine all make sources
        const combinedMakes = new Set([...baselineMakes, ...sessionMakes, ...makesFromItems]);

        // Determine status (default to 'Pending' if no item exists for this category yet)
        const status = categoriesMap.get(categoryName)?.status || 'Pending'; // Or derive more complex status if needed

        if (combinedMakes.size > 0 || categoriesMap.has(categoryName)) { // Only add if there are makes or items
            finalCategories.push({
                name: categoryName,
                status: status,
                makes: Array.from(combinedMakes).sort() // Convert Set to sorted array
            });
        }
    });


    // 3. Sort final list
    finalCategories.sort((a, b) => a.name.localeCompare(b.name));

    console.log("Derived Categories Result:", finalCategories);
    return finalCategories;
};


export const useProcurementRequestStore = create<ProcurementRequestState>()(
    persist(
        (set, get) => ({
            // Initial State
            mode: 'create',
            projectId: null,
            prId: null,
            selectedWP: '',
            procList: [],
            selectedCategories: [], // This will be derived
            undoStack: [],
            newPRComment: '',
            isInitialized: false,
            initialCategoryMakes: {},
            sessionAddedMakes: {}, // <<< Initialize new state

            // --- Actions ---
            initialize: (mode, projectId, prId, wpSpecificInitialMakes = {}, initialPrData) => {
                const currentState = get();
                if (!currentState.isInitialized || currentState.projectId !== projectId || ( currentState.prId != prId) || currentState.mode !== mode) {
                    console.log("Initializing store:", { mode, projectId, prId });
                    const initialProcList = initialPrData?.procList || [];
                    // Ignore initialPrData.categories - we will derive them fresh
                    set({
                        mode,
                        projectId,
                        prId: prId || null,
                        selectedWP: initialPrData?.workPackage || '',
                        procList: initialProcList,
                        initialCategoryMakes: wpSpecificInitialMakes,
                        sessionAddedMakes: {}, // <<< Reset session makes on init
                        selectedCategories: [], // Start empty, will be derived
                        undoStack: [],
                        newPRComment: '',
                        isInitialized: true,
                    });
                    // **Crucial:** Recalculate immediately after setting state
                    get()._recalculateCategories();
                } else {
                    console.log("Store already initialized with same keys, skipping re-initialization.");
                }
            },

            setSelectedWP: (wp, wpSpecificMakes) => {
                console.log("Store: Setting WP", wp, "with makes:", wpSpecificMakes);
                set({
                    selectedWP: wp,
                    initialCategoryMakes: wpSpecificMakes,
                    procList: [],
                    selectedCategories: [], // Reset derived categories
                    sessionAddedMakes: {}, // <<< Reset session makes
                    undoStack: [],
                })
                // No immediate recalculate needed as procList is empty
            },

            _recalculateCategories: () => {
                console.log("Store: Recalculating categories...");
                set(state => {
                    // Ensure all inputs are valid before deriving
                    const currentProcList = Array.isArray(state.procList) ? state.procList : [];
                    const currentInitialMakes = typeof state.initialCategoryMakes === 'object' && state.initialCategoryMakes !== null ? state.initialCategoryMakes : {};
                    const currentSessionMakes = typeof state.sessionAddedMakes === 'object' && state.sessionAddedMakes !== null ? state.sessionAddedMakes : {};

                    return {
                        selectedCategories: deriveCategoriesWithMakes(
                            currentProcList,
                            currentInitialMakes,
                            currentSessionMakes // <<< Pass session makes
                        )
                    };
                });
            },

            // Actions that affect procList now just call _recalculateCategories
            addProcItem: (item) => {
                if (get().procList.some(i => i.name === item.name)) return false;
                const stack = get().undoStack.filter(stackItem => stackItem.name !== item.name);
                set(state => ({
                    procList: [...state.procList, { ...item, uniqueId: item.uniqueId || uuidv4() }],
                    undoStack: stack
                }));
                get()._recalculateCategories(); // Recalculate
                return true;
            },

            updateProcItem: (updatedItem) => {
                set(state => ({
                    procList: state.procList.map(item =>
                        (item.uniqueId && item.uniqueId === updatedItem.uniqueId) || item.name === updatedItem.name
                            ? { ...item, ...updatedItem }
                            : item
                    )
                }));
                get()._recalculateCategories(); // Recalculate
            },

            deleteProcItem: (itemNameOrUniqueId) => {
                const itemToDelete = get().procList.find(item => item.uniqueId === itemNameOrUniqueId || item.name === itemNameOrUniqueId);
                if (itemToDelete) {
                    set(state => ({
                        procList: state.procList.filter(item => !(item.uniqueId === itemNameOrUniqueId || item.name === itemNameOrUniqueId)),
                        undoStack: [...state.undoStack, itemToDelete]
                    }));
                    get()._recalculateCategories(); // Recalculate
                }
            },

            undoDelete: () => {
                const stack = get().undoStack;
                if (stack.length > 0) {
                    const itemToRestore = stack[stack.length - 1];
                    set(state => ({
                        procList: [...state.procList, itemToRestore],
                        undoStack: state.undoStack.slice(0, -1)
                    }));
                    get()._recalculateCategories(); // Recalculate
                }
            },

            setNewPRComment: (comment) => set({ newPRComment: comment }),

            // --- *** REVISED updateCategoryMakes *** ---
            updateCategoryMakes: (categoryName, newMake) => {
                console.log(`Store: Recording session make for ${categoryName}, adding ${newMake}`);
                // 1. Update the sessionAddedMakes state
                set(state => {
                    const currentMakes = state.sessionAddedMakes[categoryName] || new Set<string>();
                    if (currentMakes.has(newMake)) {
                        return {}; // No change needed if make already exists
                    }
                    const updatedMakes = new Set(currentMakes).add(newMake);
                    return {
                        sessionAddedMakes: {
                            ...state.sessionAddedMakes,
                            [categoryName]: updatedMakes
                        }
                    };
                });
                // 2. Trigger recalculation of selectedCategories
                get()._recalculateCategories();
            },
            // --- *** END REVISION *** ---

            resetStore: () => {
                console.log("Resetting store...");
                set({
                    mode: 'create',
                    projectId: null,
                    prId: null,
                    selectedWP: '',
                    procList: [],
                    selectedCategories: [],
                    undoStack: [],
                    newPRComment: '',
                    isInitialized: false,
                    initialCategoryMakes: {},
                    sessionAddedMakes: {}, // <<< Reset session makes
                });
            },
        }),
        {
            name: 'procurement-request-storage-v4', // <<< Incremented version
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                mode: state.mode,
                projectId: state.projectId,
                prId: state.prId,
                selectedWP: state.selectedWP,
                procList: state.procList,
                // selectedCategories: state.selectedCategories, // Don't persist derived state
                newPRComment: state.newPRComment,
                initialCategoryMakes: state.initialCategoryMakes,
                sessionAddedMakes: state.sessionAddedMakes, // <<< PERSIST session makes
                undoStack: state.undoStack,
            }),
            onRehydrateStorage: (state) => {
                console.log("Rehydrating state v4");
                return (_state, error) => {
                    if (error) {
                        console.error("Failed to rehydrate state v4:", error);
                        _state?.resetStore?.();
                    } else if (_state) {
                        _state.isInitialized = true;
                        // Convert persisted object back to Sets for sessionAddedMakes
                        if (_state.sessionAddedMakes) {
                            const rehydratedSessionMakes: SessionAddedMakes = {};
                            Object.entries(_state.sessionAddedMakes).forEach(([cat, makesArray]) => {
                                // Check if it's an array (from JSON) before creating Set
                                if (Array.isArray(makesArray)) {
                                    rehydratedSessionMakes[cat] = new Set(makesArray);
                                } else if (makesArray instanceof Set) {
                                    // Should not happen from JSON, but safe check
                                    rehydratedSessionMakes[cat] = makesArray;
                                }
                            });
                            _state.sessionAddedMakes = rehydratedSessionMakes;
                        } else {
                            _state.sessionAddedMakes = {}; // Ensure it's an empty object if null/undefined
                        }

                        // Recalculate categories after rehydration to ensure consistency
                        _state._recalculateCategories();
                    }
                };
            },
            version: 4, // <<< Incremented version
        }
    )
);
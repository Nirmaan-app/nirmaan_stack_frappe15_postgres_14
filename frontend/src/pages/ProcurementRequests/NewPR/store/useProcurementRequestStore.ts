import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { ProcurementRequestItem, CategorySelection, CategoryMakesMap, SelectedHeaderTag } from '../types';

// Interface for session-added makes state
type SessionAddedMakes = Record<string, Set<string>>; // CategoryName -> Set<MakeName>

interface ProcurementRequestState {
    mode: 'create' | 'edit' | 'resolve';
    projectId: string | null;
    prId: string | null;
    selectedWP: string;
    selectedHeaderTags: SelectedHeaderTag[]; // New multi-header support
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[]; // The final derived list with all relevant makes
    undoStack: ProcurementRequestItem[];
    newPRComment: string;
    isInitialized: boolean;
    initialCategoryMakes: CategoryMakesMap; // Combined baseline makes from all selected packages
    sessionAddedMakes: SessionAddedMakes; // Track makes added via dialog

    // --- Actions ---
    initialize: (
        mode: 'create' | 'edit' | 'resolve',
        projectId?: string,
        prId: string | undefined,
        wpSpecificInitialMakes: CategoryMakesMap | undefined,
        initialPrData?: { workPackage: string, selectedHeaderTags: SelectedHeaderTag[], procList: ProcurementRequestItem[], categories: CategorySelection[] }
    ) => void;
    setSelectedHeaders: (headers: SelectedHeaderTag[], combinedMakes: CategoryMakesMap) => void;
    addProcItem: (item: ProcurementRequestItem) => boolean;
    updateProcItem: (updatedItem: Partial<ProcurementRequestItem> & { uniqueId: string }) => void;
    deleteProcItem: (itemName: string) => void;
    undoDelete: () => void;
    setNewPRComment: (comment: string) => void;
    updateCategoryMakes: (categoryName: string, newMake: string) => void;
    resetStore: () => void;
    _recalculateCategories: () => void;
}

// Helper to derive categories, now incorporating sessionAddedMakes
const deriveCategoriesWithMakes = (
    procList: ProcurementRequestItem[],
    initialMakesMap: CategoryMakesMap, // Baseline makes for all packages
    sessionMakesMap: SessionAddedMakes // Explicitly added makes this session
): CategorySelection[] => {
    const categoriesMap = new Map<string, { status: string; makes: Set<string> }>();

    procList.forEach(item => {
        let categoryEntry = categoriesMap.get(item.category);
        if (!categoryEntry) {
            categoryEntry = { status: item.status, makes: new Set() };
            categoriesMap.set(item.category, categoryEntry);
        }
        if (item.status === 'Request' && categoryEntry.status !== 'Request') {
            categoryEntry.status = 'Request';
        }
        if (item.make) {
            categoryEntry.makes.add(item.make);
        }
    });

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

        const combinedMakes = new Set([...baselineMakes, ...sessionMakes, ...makesFromItems]);
        const status = categoriesMap.get(categoryName)?.status || 'Pending';

        if (combinedMakes.size > 0 || categoriesMap.has(categoryName)) {
            finalCategories.push({
                name: categoryName,
                status: status,
            });
        }
    });

    finalCategories.sort((a, b) => a.name.localeCompare(b.name));
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
            selectedHeaderTags: [],
            procList: [],
            selectedCategories: [],
            undoStack: [],
            newPRComment: '',
            isInitialized: false,
            initialCategoryMakes: {},
            sessionAddedMakes: {},

            // --- Actions ---
            initialize: (mode, projectId, prId, wpSpecificInitialMakes = {}, initialPrData) => {
                const currentState = get();
                const contextChanged =
                    currentState.projectId !== projectId ||
                    currentState.prId !== (prId || null) ||
                    currentState.mode !== mode;

                if (contextChanged || !currentState.isInitialized) {
                    console.log("Store: Full initialization.");
                    const initialProcList = initialPrData?.procList || [];
                    set({
                        mode,
                        projectId,
                        prId: prId || null,
                        selectedWP: initialPrData?.workPackage || '',
                        selectedHeaderTags: initialPrData?.selectedHeaderTags || [],
                        procList: initialProcList,
                        initialCategoryMakes: wpSpecificInitialMakes || {},
                        sessionAddedMakes: {},
                        selectedCategories: [],
                        undoStack: [],
                        newPRComment: '',
                        isInitialized: true,
                    });
                    get()._recalculateCategories();
                } else if (initialPrData && initialPrData.procList) {
                    console.log("Store: Updating procList with fresh data.");
                    set(state => ({
                        procList: initialPrData.procList,
                        selectedWP: initialPrData.workPackage || state.selectedWP,
                        selectedHeaderTags: initialPrData.selectedHeaderTags || state.selectedHeaderTags,
                        initialCategoryMakes: wpSpecificInitialMakes || state.initialCategoryMakes,
                    }));
                    get()._recalculateCategories();
                }
            },

            setSelectedHeaders: (headers, combinedMakes) => {
                const currentMode = get().mode;
                console.log(`Store: Setting selected headers in ${currentMode} mode:`, headers);
                
                const updates: any = {
                    selectedHeaderTags: headers,
                    selectedWP: headers.length > 0 ? headers[0].tag_package : '',
                    initialCategoryMakes: combinedMakes,
                };

                // CRITICAL: Only clear procList if we are in 'create' mode.
                // In 'edit' or 'resolve' mode, we MUST keep existing items.
                if (currentMode === 'create') {
                    updates.procList = [];
                    updates.selectedCategories = [];
                    updates.sessionAddedMakes = {};
                    updates.undoStack = [];
                }

                set(updates);
                // No immediate recalculate needed as procList is empty or unchanged
                if (currentMode !== 'create') {
                    get()._recalculateCategories();
                }
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
                if (get().procList.some(i => i.name === item.name && i.item===item.item)) return false;
                const stack = get().undoStack.filter(stackItem => stackItem.name !== item.name);
                set(state => ({
                    procList: [...state.procList, { ...item, uniqueId: item.uniqueId || uuidv4() }],
                    undoStack: stack
                }));
                get()._recalculateCategories(); // Recalculate
                return true;
            },

            updateProcItem: (updatedItem) => {
                console.log("updateItem",updatedItem)
                set(state => ({
                    procList: state.procList.map(item =>
                        (item.uniqueId && item.uniqueId === updatedItem.uniqueId) && item.name === updatedItem.name
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
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { ProcurementRequestItem, CategorySelection, CategoryMakesMap } from '../types';

interface ProcurementRequestState {
    mode: 'create' | 'edit' | 'resolve';
    projectId: string | null;
    prId: string | null;
    selectedWP: string;
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[]; // Includes makes managed during the session
    undoStack: ProcurementRequestItem[];
    newPRComment: string;
    isInitialized: boolean;
    initialCategoryMakes: CategoryMakesMap; // Baseline makes from Project for the selected WP

    // --- Actions ---
    initialize: (
        mode: 'create' | 'edit' | 'resolve',
        projectId?: string,
        prId: string | undefined, // Only relevant for edit/resolve
        // Renamed for clarity: this map should be specific to the initial WP if provided
        wpSpecificInitialMakes: CategoryMakesMap | undefined,
        initialPrData?: { workPackage: string, procList: ProcurementRequestItem[], categories: CategorySelection[] }
    ) => void;
    // Modified signature: now accepts the makes map for the chosen WP
    setSelectedWP: (wp: string, wpSpecificMakes: CategoryMakesMap) => void;
    addProcItem: (item: ProcurementRequestItem) => boolean;
    updateProcItem: (updatedItem: Partial<ProcurementRequestItem> & { name: string }) => void;
    deleteProcItem: (itemName: string) => void;
    undoDelete: () => void;
    setNewPRComment: (comment: string) => void;
    updateCategoryMakes: (categoryName: string, newMake: string) => void;
    resetStore: () => void;
    _recalculateCategories: () => void;
}

// Helper to derive categories, incorporating initial makes and user additions
const deriveCategoriesWithMakes = (
    procList: ProcurementRequestItem[],
    currentCategories: CategorySelection[], // Current state including session makes
    initialMakesMap: CategoryMakesMap    // Baseline makes for the WP from the project doc
): CategorySelection[] => {
    const categoriesMap = new Map<string, CategorySelection>();

    // 1. Iterate through procList items to identify active categories and statuses
    procList.forEach(item => {
        const key = `${item.category}-${item.status}`;
        let categoryEntry = categoriesMap.get(key);

        // If this category-status combo isn't in our map yet:
        if (!categoryEntry) {
            // Find baseline makes for this category from the project definition
            const baselineMakes = initialMakesMap[item.category] || [];
            // Find makes from the *current state* if this category existed before (preserves session additions)
            const sessionCategory = currentCategories.find(c => c.name === item.category && c.status === item.status);
            const sessionMakes = sessionCategory?.makes || [];

            // Combine baseline and session makes, ensuring uniqueness
            const initialCombinedMakes = Array.from(new Set([...baselineMakes, ...sessionMakes]));

            // Create the new entry
            categoryEntry = {
                name: item.category,
                status: item.status,
                makes: initialCombinedMakes // Start with combined baseline/session makes
            };
            categoriesMap.set(key, categoryEntry);
        }

        // 2. Ensure the specific make used by *this item* is included
        if (item.make && !categoryEntry.makes.includes(item.make)) {
            categoryEntry.makes.push(item.make);
        }
    });

    // 3. Convert map values to an array
    const finalCategories = Array.from(categoriesMap.values());

    // 4. Sort categories alphabetically by name (optional)
    finalCategories.sort((a, b) => a.name.localeCompare(b.name));

    console.log("Derived Categories with Makes:", finalCategories); // Add log for debugging
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
            selectedCategories: [],
            undoStack: [],
            newPRComment: '',
            isInitialized: false,
            initialCategoryMakes: {}, // Initialize map

            // --- Actions ---
            initialize: (mode, projectId, prId, wpSpecificInitialMakes = {}, initialPrData) => {
                const currentState = get();
                // Initialize only if not already initialized or if key identifiers change
                 if (!currentState.isInitialized || currentState.projectId !== projectId || currentState.prId !== prId || currentState.mode !== mode) {
                     console.log("Initializing store:", { mode, projectId, prId });
                    const initialProcList = initialPrData?.procList || [];
                    // Use initial categories from PR data if available, otherwise derive initially
                    const initialLoadedCategories = initialPrData?.categories || []; // Categories from existing PR


                    // If loading existing PR, its 'categories' list should ideally contain the makes used *at that time*.
                    // We prioritize the loaded categories but still use wpSpecificInitialMakes as the *baseline* for recalculation.
                    // if (initialSelectedCategories.length === 0 && initialProcList.length > 0) {
                    //    // If no categories loaded but items exist, derive from items + baseline makes
                    //    initialSelectedCategories = deriveCategoriesWithMakes(initialProcList, [], wpSpecificInitialMakes);
                    // } else {
                    //     // If categories *are* loaded, we still might want to ensure makes are present
                    //     // For simplicity, assume loaded categories are correct for now. Recalculate below ensures consistency.
                    // }

                    set({
                        mode,
                        projectId,
                        prId: prId || null,
                        selectedWP: initialPrData?.workPackage || '',
                        procList: initialProcList,
                        initialCategoryMakes: wpSpecificInitialMakes, // Set baseline makes
                        selectedCategories: initialLoadedCategories, // Temporarily set loaded categories
                        undoStack: [],
                        newPRComment: '',
                        isInitialized: true,
                    });
                    // **Crucial:** Recalculate immediately after setting state
                    // This merges loaded categories, baseline makes, and item makes correctly
                    get()._recalculateCategories();
                 } else {
                    console.log("Store already initialized with same keys, skipping re-initialization.");
                 }
            },

            // Modified setSelectedWP: now accepts the makes map for the chosen WP
            setSelectedWP: (wp, wpSpecificMakes) => {
                console.log("Store: Setting WP", wp, "with makes:", wpSpecificMakes);
                set({
                    selectedWP: wp,
                    initialCategoryMakes: wpSpecificMakes,
                    procList: [],
                    selectedCategories: [], // Reset derived categories
                    undoStack: [],
                })
            },

            _recalculateCategories: () => {
                console.log("Store: Recalculating categories...");
                set(state => {
                    // Ensure all inputs are valid before deriving
                    const currentProcList = Array.isArray(state.procList) ? state.procList : [];
                    const currentSelectedCategories = Array.isArray(state.selectedCategories) ? state.selectedCategories : [];
                    const currentInitialMakes = typeof state.initialCategoryMakes === 'object' && state.initialCategoryMakes !== null ? state.initialCategoryMakes : {};

                    return {
                        selectedCategories: deriveCategoriesWithMakes(
                            currentProcList,
                            currentSelectedCategories,
                            currentInitialMakes
                        )
                    };
                });
            },

            // addProcItem, updateProcItem, deleteProcItem, undoDelete call _recalculateCategories
            addProcItem: (item) => {
                // ... (duplicate check logic) ...
                if (get().procList.some(i => i.name === item.name)) return false;
                const stack = get().undoStack.filter(stackItem => stackItem.name !== item.name);
                set(state => ({
                    procList: [...state.procList, { ...item, uniqueId: item.uniqueId || uuidv4() }],
                    undoStack: stack
                }));
                get()._recalculateCategories(); // Recalculate after adding
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
                get()._recalculateCategories(); // Recalculate after updating
            },

            deleteProcItem: (itemNameOrUniqueId) => {
                // ... (find item logic) ...
                const itemToDelete = get().procList.find(item => item.uniqueId === itemNameOrUniqueId || item.name === itemNameOrUniqueId);
                if (itemToDelete) {
                   set(state => ({
                       procList: state.procList.filter(item => !(item.uniqueId === itemNameOrUniqueId || item.name === itemNameOrUniqueId)),
                       undoStack: [...state.undoStack, itemToDelete]
                   }));
                   get()._recalculateCategories(); // Recalculate after deleting
                }
           },

            undoDelete: () => {
                // ... (restore logic) ...
                const stack = get().undoStack;
                if (stack.length > 0) {
                   const itemToRestore = stack[stack.length - 1];
                   set(state => ({
                       procList: [...state.procList, itemToRestore],
                       undoStack: state.undoStack.slice(0, -1)
                   }));
                   get()._recalculateCategories(); // Recalculate after restoring
                }
            },

           setNewPRComment: (comment) => set({ newPRComment: comment }),

           // --- *** MODIFIED updateCategoryMakes *** ---
           updateCategoryMakes: (categoryName, newMake) => {
            console.log(`Store: Updating makes for ${categoryName}, adding ${newMake}`);
            set(state => {
                let categoryFound = false;
                let needsUpdate = false;

                // 1. Try to update existing category entry
                const updatedCategories = state.selectedCategories.map(cat => {
                    if (cat.name === categoryName) {
                        categoryFound = true;
                        const makes = Array.isArray(cat.makes) ? cat.makes : [];
                        if (!makes.includes(newMake)) {
                            needsUpdate = true; // Mark that state needs changing
                            return { ...cat, makes: [...makes, newMake] };
                        }
                    }
                    return cat; // Return unchanged category if no match or make exists
                });

                // 2. If category was NOT found, ADD it to the array
                if (!categoryFound) {
                    console.log(`Category ${categoryName} not found, adding it.`);
                    const baselineMakes = state.initialCategoryMakes[categoryName] || [];
                    // Add the new category with baseline makes + the new make
                    updatedCategories.push({
                        name: categoryName,
                        status: 'Pending', // Assign a default status (adjust if needed)
                        makes: Array.from(new Set([...baselineMakes, newMake])) // Combine and ensure unique
                    });
                    needsUpdate = true; // Mark that state needs changing
                }

                // Only return a new state object if something actually changed
                return needsUpdate ? { selectedCategories: updatedCategories } : {};
            });
            // No explicit recalculate needed here, as we directly modified selectedCategories
        },
        // --- *** END MODIFICATION *** ---

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
                });
             },
        }),
        {
            name: 'procurement-request-storage-v3', // <<< Incremented version due to state logic changes
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                mode: state.mode,
                projectId: state.projectId,
                prId: state.prId,
                selectedWP: state.selectedWP,
                procList: state.procList,
                selectedCategories: state.selectedCategories,
                newPRComment: state.newPRComment,
                initialCategoryMakes: state.initialCategoryMakes, // <<< Persist the baseline map
            }),
            onRehydrateStorage: (state) => {
                console.log("Rehydrating state v3");
                return (_state, error) => { // Renamed internal state variable
                    if (error) {
                        console.error("Failed to rehydrate state v3:", error);
                        _state?.resetStore?.();
                    } else if (_state) {
                        _state.isInitialized = true; // Mark as initialized after rehydration
                        // Optional: Recalculate categories on rehydrate if needed, though derivation logic should handle it
                        // _state._recalculateCategories();
                    }
                };
            },
            version: 3, 
        }
    )
);
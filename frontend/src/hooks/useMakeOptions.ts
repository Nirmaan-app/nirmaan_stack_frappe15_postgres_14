import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { Makelist } from "@/types/NirmaanStack/Makelist";
import { ProjectWPCategoryMake, Projects } from "@/types/NirmaanStack/Projects";

// ── Shared Types ──────────────────────────────────────────────────────────────

export type CategoryMakesMap = Record<string, string[]>;

export interface MakeOption {
    value: string;
    label: string;
}

// ── Shared Utility Functions ──────────────────────────────────────────────────

/**
 * Extract a map of category → make[] from the project's child table,
 * filtered to only the given procurement packages.
 */
export const extractMakesFromChildTableForMultipleWPs = (
    project: Projects | undefined,
    selectedPackages: string[]
): CategoryMakesMap => {
    const makesMap: CategoryMakesMap = {};
    if (!project?.project_wp_category_makes || selectedPackages.length === 0) {
        return makesMap;
    }

    project.project_wp_category_makes.forEach((itemLink) => {
        if (selectedPackages.includes(itemLink.procurement_package)) {
            if (!makesMap[itemLink.category]) {
                makesMap[itemLink.category] = [];
            }
            if (itemLink.make && !makesMap[itemLink.category].includes(itemLink.make)) {
                makesMap[itemLink.category].push(itemLink.make);
            }
        }
    });

    for (const category in makesMap) {
        makesMap[category].sort();
    }
    return makesMap;
};

/**
 * Extract a map of category → procurement package from the project's child table,
 * filtered to only the given packages.
 */
export const extractCategoryToPackageMap = (
    project: Projects | undefined,
    selectedPackages: string[]
): Record<string, string> => {
    const pkgMap: Record<string, string> = {};
    if (!project?.project_wp_category_makes || selectedPackages.length === 0) {
        return pkgMap;
    }
    project.project_wp_category_makes.forEach((itemLink) => {
        if (selectedPackages.includes(itemLink.procurement_package)) {
            pkgMap[itemLink.category] = itemLink.procurement_package;
        }
    });
    return pkgMap;
};

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseMakeOptionsParams {
    categoryName: string | undefined;
    projectWpCategoryMakes: ProjectWPCategoryMake[] | undefined;
    relevantPackages: string[];
}

interface UseMakeOptionsReturn {
    makeOptions: MakeOption[];
    isLoading: boolean;
    allMakeOptions: MakeOption[];
    makeList: Makelist[] | undefined;
    categoryMakelist: CategoryMakelist[] | undefined;
    makeListMutate: () => Promise<any>;
    categoryMakeListMutate: () => Promise<any>;
}

/**
 * Shared hook for building filtered + sorted make options for a given category.
 *
 * Fetches `Category Makelist` (global makes per category) and `Makelist` (all makes),
 * then combines them with project-specific makes from the project's child table.
 *
 * The 4-condition filter checks both `.value` AND `.label` against both the global
 * and project-specific sets — this is the canonical correct logic from AddItemForm.
 */
export function useMakeOptions({
    categoryName,
    projectWpCategoryMakes,
    relevantPackages,
}: UseMakeOptionsParams): UseMakeOptionsReturn {
    // ── Fetch global Category Makelist ────────────────────────────────────────
    const {
        data: categoryMakelist,
        isLoading: categoryMakeListLoading,
        mutate: categoryMakeListMutate,
    } = useFrappeGetDocList<CategoryMakelist>(
        "Category Makelist",
        {
            fields: ["category", "make"],
            filters: [["category", "=", categoryName as string]],
            orderBy: { field: "category", order: "asc" },
            limit: 0,
        },
        categoryName ? undefined : null
    );

    // ── Fetch all makes ──────────────────────────────────────────────────────
    const {
        data: makeList,
        isLoading: makeListLoading,
        mutate: makeListMutate,
    } = useFrappeGetDocList<Makelist>("Makelist", {
        fields: ["name", "make_name"],
        limit: 0,
    });

    // ── Derive allMakeOptions from Makelist ──────────────────────────────────
    const allMakeOptions = useMemo<MakeOption[]>(
        () =>
            makeList?.map((make) => ({
                value: make.name,
                label: make.make_name,
            })) ?? [],
        [makeList]
    );

    // ── Derive project-specific makes for this category ──────────────────────
    const projectSpecificMakesSet = useMemo(() => {
        if (!projectWpCategoryMakes || !categoryName || relevantPackages.length === 0) {
            return new Set<string>();
        }
        const makes: string[] = [];
        projectWpCategoryMakes.forEach((row) => {
            if (
                relevantPackages.includes(row.procurement_package) &&
                row.category === categoryName &&
                row.make
            ) {
                makes.push(row.make);
            }
        });
        return new Set(makes);
    }, [projectWpCategoryMakes, categoryName, relevantPackages]);

    // ── Derive global makes set from Category Makelist ───────────────────────
    const globalCategoryMakesSet = useMemo(() => {
        if (!categoryMakelist || !categoryName) return new Set<string>();
        const values = categoryMakelist
            .filter((cm) => cm.category === categoryName)
            .map((cm) => cm.make)
            .filter(Boolean) as string[];
        return new Set(values);
    }, [categoryMakelist, categoryName]);

    // ── Filter + sort: canonical 4-condition logic ───────────────────────────
    const makeOptions = useMemo(() => {
        if (!categoryName || allMakeOptions.length === 0) return [];

        return allMakeOptions
            .filter((option) => {
                // 4-condition check: value OR label in EITHER set
                return (
                    globalCategoryMakesSet.has(option.value) ||
                    globalCategoryMakesSet.has(option.label) ||
                    projectSpecificMakesSet.has(option.value) ||
                    projectSpecificMakesSet.has(option.label)
                );
            })
            .map((option) => {
                const isProjectSpecific = projectSpecificMakesSet.has(option.value);
                return {
                    value: option.value,
                    originalLabel: option.label,
                    label: isProjectSpecific
                        ? `${option.label} (Project Makelist)`
                        : option.label,
                };
            })
            .sort((a, b) => {
                const suffix = " (Project Makelist)";
                const aIsProject = a.label.endsWith(suffix);
                const bIsProject = b.label.endsWith(suffix);

                if (aIsProject && !bIsProject) return -1;
                if (!aIsProject && bIsProject) return 1;
                return a.originalLabel.localeCompare(b.originalLabel);
            });
    }, [categoryName, allMakeOptions, globalCategoryMakesSet, projectSpecificMakesSet]);

    return {
        makeOptions,
        isLoading: categoryMakeListLoading || makeListLoading,
        allMakeOptions,
        makeList,
        categoryMakelist,
        makeListMutate,
        categoryMakeListMutate,
    };
}

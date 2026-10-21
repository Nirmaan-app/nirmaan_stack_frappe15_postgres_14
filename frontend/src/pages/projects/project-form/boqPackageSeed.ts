/**
 * Package pre-fill from the BoQs picked in the convert wizard's BOQ step.
 *
 * Pure (no React, no fetching) so the rules are unit-testable (ADR-0010 F4).
 * `buildWorkPackageEntry` is also what a manual tick in the Packages step uses,
 * so a seeded package and a hand-ticked one are always the same shape.
 */

export interface FormWorkPackage {
    work_package_name: string;
    category_list: {
        list: Array<{
            name: string;
            makes: Array<{ label: string; value: string }>;
        }>;
    };
}

interface CategoryLike {
    category_name: string;
    work_package?: string | null;
}

interface OfferedPackage {
    work_package_name: string;
}

interface BoqScope {
    packages: readonly string[];
    unmapped_headers: readonly string[];
}

/**
 * What the picked BoQs cover together: the union of their packages and of their
 * headers that have no package, each sorted and without duplicates.
 */
export const combineBoqScope = (boqs: readonly BoqScope[]): { packages: string[]; unmappedHeaders: string[] } => ({
    packages: [...new Set(boqs.flatMap((boq) => boq.packages))].sort(),
    unmappedHeaders: [...new Set(boqs.flatMap((boq) => boq.unmapped_headers))].sort(),
});

/** The form entry for one ticked package: every category of that package, no makes yet. */
export const buildWorkPackageEntry = (
    workPackageName: string,
    categories: readonly CategoryLike[]
): FormWorkPackage => ({
    work_package_name: workPackageName,
    category_list: {
        list: categories
            .filter((cat) => cat.work_package === workPackageName)
            .map((cat) => ({ name: cat.category_name, makes: [] })),
    },
});

/**
 * The Packages step's selection for the picked BoQs' packages: those the wizard
 * offers (it hides a few), in the wizard's own display order.
 */
export const seedWorkPackagesFromBoq = (
    boqPackages: readonly string[],
    offeredPackages: readonly OfferedPackage[],
    categories: readonly CategoryLike[]
): FormWorkPackage[] => {
    const wanted = new Set(boqPackages);
    return offeredPackages
        .filter((pkg) => wanted.has(pkg.work_package_name))
        .map((pkg) => buildWorkPackageEntry(pkg.work_package_name, categories));
};

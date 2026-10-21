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

/**
 * The Packages step after the BoQ picks change (owner 2026-10-21, option a): only the
 * DIFFERENCE between the old picks' packages and the new picks' packages moves.
 *
 * - A package the new picks bring and the old picks did not is ticked (unless already ticked).
 * - A package the old picks brought and the new picks do not is unticked.
 * - Everything else stays as the user left it: a package ticked by hand stays ticked, one
 *   unticked by hand stays unticked, and a kept entry keeps its makes.
 *
 * The first pick is the same rule with no old picks, so it ticks every package of the BoQs.
 * Returns the new selection in the wizard's display order, plus what was added and removed
 * (for `syncSectionsWithPackages`).
 */
export const applyBoqPickChange = (
    current: readonly FormWorkPackage[],
    oldBoqPackages: readonly string[],
    newBoqPackages: readonly string[],
    offeredPackages: readonly OfferedPackage[],
    categories: readonly CategoryLike[]
): { workPackages: FormWorkPackage[]; added: string[]; removed: string[] } => {
    const oldSet = new Set(oldBoqPackages);
    const newSet = new Set(newBoqPackages);
    const ticked = new Set(current.map((pkg) => pkg.work_package_name));

    const removed = [...oldSet].filter((name) => !newSet.has(name) && ticked.has(name)).sort();
    const addedEntries = seedWorkPackagesFromBoq(
        [...newSet].filter((name) => !oldSet.has(name) && !ticked.has(name)),
        offeredPackages,
        categories
    );

    const rank = new Map(offeredPackages.map((pkg, index) => [pkg.work_package_name, index]));
    const position = (name: string) => rank.get(name) ?? Number.MAX_SAFE_INTEGER;
    const workPackages = [
        ...current.filter((pkg) => !removed.includes(pkg.work_package_name)),
        ...addedEntries,
    ].sort((a, b) => position(a.work_package_name) - position(b.work_package_name));

    return { workPackages, added: addedEntries.map((pkg) => pkg.work_package_name), removed };
};

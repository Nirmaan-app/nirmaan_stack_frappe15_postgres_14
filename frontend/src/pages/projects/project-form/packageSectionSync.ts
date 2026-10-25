/**
 * The Packages step's three optional sections (Daily Progress, Design, Critical PO)
 * follow the ticked work packages: ticking a package ticks its work headers and
 * categories, unticking it removes them, and a section switches itself on when it
 * gains something and off when it loses its last item.
 *
 * A section the user switched off by hand (`opted_out`) is left alone until they
 * switch it back on; switching it on fills it from the packages already ticked.
 *
 * Pure (ADR-0010 F4). The Packages step's package ticks and the convert wizard's
 * BoQ seeding both go through `syncSectionsWithPackages`, so they cannot disagree.
 */
import type { CriticalPOSetup, DailyProgressSetup, DailyProgressWorkHeader, DesignPackagesSetup } from "./schema";

interface WorkHeaderLike {
    name: string;
    work_header_name: string;
    work_package_link?: string | null;
}

export interface PackageSectionMasters {
    workHeaders: readonly WorkHeaderLike[];
    /** Design categories are keyed by `category_name` in the form. */
    designCategories: readonly { category_name: string; work_package?: string | null }[];
    /** Critical PO categories are keyed by docname (`name`) in the form. */
    criticalPOCategories: readonly { name: string; work_package?: string | null }[];
}

export interface OptionalSections {
    daily_progress_setup: DailyProgressSetup;
    design_packages_setup: DesignPackagesSetup;
    critical_po_setup: CriticalPOSetup;
}

export type OptionalSectionKey = keyof OptionalSections;

/**
 * Which Work Packages tick each Design category. `Design Tracker Category.work_package`
 * holds at most one package and is empty on every category, so the wizard's mapping
 * lives here; a package set on the category in Desk is added to its list. ELV covers
 * five packages. Overall Project belongs to none, so it stays a manual tick.
 */
export const DESIGN_CATEGORY_PACKAGES: Readonly<Record<string, readonly string[]>> = {
    Electrical: ["Electrical Work"],
    HVAC: ["HVAC System"],
    "Fire Sprinkler": ["Fire Fighting System"],
    "Data Networking": ["Data & Networking"],
    BMS: ["BMS"],
    ELV: ["FA System", "PA System", "CCTV System", "Access Control System", "Critical Room ELV"],
};

export const designCategoryPackages = (category: { category_name: string; work_package?: string | null }): string[] => [
    ...new Set([...(DESIGN_CATEGORY_PACKAGES[category.category_name] ?? []), ...(category.work_package ? [category.work_package] : [])]),
];

export interface PackageChange {
    added: readonly string[];
    removed: readonly string[];
    /** Every package ticked AFTER this change — an item tied to several packages stays while any is ticked. */
    ticked: readonly string[];
    /** Work headers to tick by name whatever their package — a BoQ's headers that have no package (ELV System). */
    addHeaders?: readonly string[];
    /** Work headers to untick by name (a previous BoQ pick's package-less headers). */
    removeHeaders?: readonly string[];
}

const dailyProgressOff = (opted_out?: boolean): DailyProgressSetup => ({
    enabled: false,
    zone_type: undefined,
    zones: [],
    work_headers: [],
    opted_out,
});

const designOff = (opted_out?: boolean): DesignPackagesSetup => ({
    enabled: false,
    zone_source: undefined,
    zone_type: undefined,
    zones: [],
    selected_categories: [],
    opted_out,
});

const criticalPOOff = (opted_out?: boolean): CriticalPOSetup => ({
    enabled: false,
    selected_categories: [],
    opted_out,
});

/** Fill any section the form has not initialised yet with its switched-off shape. */
export const readOptionalSections = (values: Partial<Record<OptionalSectionKey, unknown>>): OptionalSections => ({
    daily_progress_setup: (values.daily_progress_setup as DailyProgressSetup | undefined) ?? dailyProgressOff(),
    design_packages_setup: (values.design_packages_setup as DesignPackagesSetup | undefined) ?? designOff(),
    critical_po_setup: (values.critical_po_setup as CriticalPOSetup | undefined) ?? criticalPOOff(),
});

/** The form entry for one ticked work header. */
export const toWorkHeaderEntry = (header: WorkHeaderLike): DailyProgressWorkHeader => ({
    work_header_doc_name: header.name,
    work_header_display_name: header.work_header_name,
    // Empty for ELV System / BMS, which have no package; the form types this as a string.
    work_package_link: header.work_package_link ?? "",
});

const linkedTo = (link: string | null | undefined, packages: ReadonlySet<string>) => !!link && packages.has(link);
const anyIn = (packages: readonly string[], set: ReadonlySet<string>) => packages.some((p) => set.has(p));

const syncDailyProgress = (
    dp: DailyProgressSetup,
    workHeaders: readonly WorkHeaderLike[],
    change: PackageChange
): DailyProgressSetup => {
    const added = new Set(change.added);
    const removed = new Set(change.removed);
    const addByName = new Set(change.addHeaders ?? []);
    const drop = new Set([
        ...workHeaders.filter((h) => linkedTo(h.work_package_link, removed)).map((h) => h.name),
        ...(change.removeHeaders ?? []),
    ]);

    const kept = dp.work_headers.filter((h) => !drop.has(h.work_header_doc_name));
    const toAdd = dp.opted_out
        ? []
        : workHeaders.filter(
              (h) =>
                  (linkedTo(h.work_package_link, added) || addByName.has(h.name)) &&
                  !kept.some((k) => k.work_header_doc_name === h.name)
          );
    const work_headers = [...kept, ...toAdd.map(toWorkHeaderEntry)];

    if (work_headers.length === 0 && dp.enabled && dp.work_headers.length > 0) return dailyProgressOff(dp.opted_out);
    if (work_headers.length > 0 && !dp.enabled) {
        return { ...dp, enabled: true, zone_type: dp.zone_type ?? "single", work_headers };
    }
    return { ...dp, work_headers };
};

const syncCategories = <T extends { enabled: boolean; selected_categories: string[]; opted_out?: boolean }>(
    section: T,
    masters: readonly { key: string; packages: readonly string[] }[],
    change: PackageChange,
    turnOff: (opted_out?: boolean) => T,
    turnOn: (section: T, selected_categories: string[]) => T
): T => {
    const added = new Set(change.added);
    const removed = new Set(change.removed);
    const ticked = new Set(change.ticked);
    // Dropped only when one of its packages went AND none of them is still ticked.
    const drop = new Set(
        masters.filter((c) => anyIn(c.packages, removed) && !anyIn(c.packages, ticked)).map((c) => c.key)
    );

    const kept = section.selected_categories.filter((name) => !drop.has(name));
    const toAdd = section.opted_out
        ? []
        : masters.filter((c) => anyIn(c.packages, added) && !kept.includes(c.key)).map((c) => c.key);
    const selected_categories = [...kept, ...toAdd];

    if (selected_categories.length === 0 && section.enabled && section.selected_categories.length > 0) {
        return turnOff(section.opted_out);
    }
    if (selected_categories.length > 0 && !section.enabled) return turnOn(section, selected_categories);
    return { ...section, selected_categories };
};

const syncDesign = (d: DesignPackagesSetup, masters: PackageSectionMasters, change: PackageChange) =>
    syncCategories(
        d,
        masters.designCategories.map((c) => ({ key: c.category_name, packages: designCategoryPackages(c) })),
        change,
        designOff,
        (section, selected_categories) => ({
            ...section,
            enabled: true,
            // Own single zone by default; "Copy from Daily Progress" stays a manual choice.
            zone_source: section.zone_source ?? "custom",
            zone_type: section.zone_type ?? "single",
            selected_categories,
        })
    );

const syncCriticalPO = (c: CriticalPOSetup, masters: PackageSectionMasters, change: PackageChange) =>
    syncCategories(
        c,
        masters.criticalPOCategories.map((cat) => ({ key: cat.name, packages: cat.work_package ? [cat.work_package] : [] })),
        change,
        criticalPOOff,
        (section, selected_categories) => ({ ...section, enabled: true, selected_categories })
    );

/** Apply a package tick / untick (or a BoQ re-seed) to all three sections. */
export const syncSectionsWithPackages = (
    sections: OptionalSections,
    masters: PackageSectionMasters,
    change: PackageChange
): OptionalSections => ({
    daily_progress_setup: syncDailyProgress(sections.daily_progress_setup, masters.workHeaders, change),
    design_packages_setup: syncDesign(sections.design_packages_setup, masters, change),
    critical_po_setup: syncCriticalPO(sections.critical_po_setup, masters, change),
});

/** The user ticked a section's "Enable" box: switch it on, filled from the ticked packages. */
export const turnSectionOn = (
    sections: OptionalSections,
    key: OptionalSectionKey,
    tickedPackages: readonly string[],
    masters: PackageSectionMasters
): OptionalSections => {
    const fill: PackageChange = { added: tickedPackages, removed: [], ticked: tickedPackages };
    switch (key) {
        case "daily_progress_setup": {
            const on = { ...sections.daily_progress_setup, opted_out: false, enabled: true };
            const filled = syncDailyProgress(on, masters.workHeaders, fill);
            return { ...sections, daily_progress_setup: { ...filled, zone_type: filled.zone_type ?? "single" } };
        }
        case "design_packages_setup": {
            const on = { ...sections.design_packages_setup, opted_out: false, enabled: true };
            const filled = syncDesign(on, masters, fill);
            return {
                ...sections,
                design_packages_setup: {
                    ...filled,
                    zone_source: filled.zone_source ?? "custom",
                    zone_type: filled.zone_type ?? "single",
                },
            };
        }
        case "critical_po_setup": {
            const on = { ...sections.critical_po_setup, opted_out: false, enabled: true };
            return { ...sections, critical_po_setup: syncCriticalPO(on, masters, fill) };
        }
    }
};

/** The user unticked a section's "Enable" box: clear it and keep it off until they turn it on again. */
export const turnSectionOff = (sections: OptionalSections, key: OptionalSectionKey): OptionalSections => {
    switch (key) {
        case "daily_progress_setup":
            return { ...sections, daily_progress_setup: dailyProgressOff(true) };
        case "design_packages_setup":
            return { ...sections, design_packages_setup: designOff(true) };
        case "critical_po_setup":
            return { ...sections, critical_po_setup: criticalPOOff(true) };
    }
};

/**
 * Why the Packages step cannot continue: a section that is switched on but would
 * save nothing useful. Empty when every switched-on section is complete.
 */
export const sectionSetupProblems = (sections: OptionalSections): string[] => {
    const problems: string[] = [];
    const dp = sections.daily_progress_setup;
    if (dp.enabled) {
        if (!dp.zone_type) problems.push("Daily Progress: choose Single or Multiple zones.");
        else if (dp.zone_type === "multiple" && dp.zones.length === 0) problems.push("Daily Progress: add at least one zone.");
        if (dp.work_headers.length === 0) problems.push("Daily Progress: select at least one work header.");
    }
    const design = sections.design_packages_setup;
    if (design.enabled) {
        if (!design.zone_type) problems.push("Design: choose the zones.");
        else if (design.zone_type === "multiple" && design.zones.length === 0) problems.push("Design: add at least one zone.");
        if (design.selected_categories.length === 0) problems.push("Design: select at least one category.");
    }
    if (sections.critical_po_setup.enabled && sections.critical_po_setup.selected_categories.length === 0) {
        problems.push("Critical PO: select at least one category.");
    }
    return problems;
};

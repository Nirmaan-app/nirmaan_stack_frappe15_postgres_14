/**
 * Which procurement packages a Procurement Request carries.
 *
 * Frontend mirror of `nirmaan_stack/services/pr_packages.py`, which is the authority: the PR's
 * validate hook writes `pr_tag_list` (one row per package, no header) from the items. This
 * module only SHOWS packages -- live chips while a PR is built or edited, before the server has
 * written anything, and de-duplicated chips on lists, because rows written before 2026-10 can
 * still repeat a package (one per old HVAC header). `prPackages.test.ts` pins it to the Python.
 */

/** Never a package (rule 3 of `services/pr_packages.py`). */
export const EXCLUDED_PACKAGES: readonly string[] = ["Additional Charges"];

/** An item as any PR screen holds it: `procurement_package` on saved rows, `work_package` while building. */
export interface PackageSourceItem {
  procurement_package?: string | null;
  work_package?: string | null;
  category?: string | null;
}

const clean = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * The package one item contributes, or null: its own package, else its category's package.
 * `Additional Charges` never counts. When `validPackages` is given, an own package outside it
 * falls back to the category, as the server does with an unknown name.
 */
export const itemPackage = (
  item: PackageSourceItem,
  categoryToPackage: Record<string, string> = {},
  validPackages?: ReadonlySet<string>,
): string | null => {
  const own = clean(item.procurement_package) || clean(item.work_package);
  if (EXCLUDED_PACKAGES.includes(own)) return null;
  if (own && (!validPackages || validPackages.has(own))) return own;
  const mapped = clean(categoryToPackage[clean(item.category)]);
  if (mapped && !EXCLUDED_PACKAGES.includes(mapped) && (!validPackages || validPackages.has(mapped))) {
    return mapped;
  }
  return null;
};

/** The sorted, de-duplicated packages of `items`. Status is ignored, as on the server. */
export const derivePRPackages = (
  items: readonly PackageSourceItem[] | null | undefined,
  categoryToPackage: Record<string, string> = {},
  validPackages?: ReadonlySet<string>,
): string[] => {
  const found = new Set<string>();
  (items ?? []).forEach((item) => {
    const pkg = itemPackage(item, categoryToPackage, validPackages);
    if (pkg) found.add(pkg);
  });
  return Array.from(found).sort();
};

/** The sorted, de-duplicated packages stored on a PR's `pr_tag_list` rows. */
export const uniqueTagPackages = (
  tags: readonly { tag_package?: string | null }[] | null | undefined,
): string[] => {
  const found = new Set<string>();
  (tags ?? []).forEach((tag) => {
    const pkg = clean(tag?.tag_package);
    if (pkg) found.add(pkg);
  });
  return Array.from(found).sort();
};

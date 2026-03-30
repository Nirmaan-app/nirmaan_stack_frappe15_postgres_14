import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Category } from "@/types/NirmaanStack/Category";
import { Items } from "@/types/NirmaanStack/Items";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { TokenSearchConfig } from "@/components/ui/fuzzy-search-select";

// ── Exported Types ───────────────────────────────────────────────────────────

export interface ItemCatalogOption {
    value: string;             // Items.name
    label: string;             // Items.item_name
    item_id: string;           // = value (PO Revision compat)
    item_name: string;         // = label (PO Revision compat)
    unit: string;              // Items.unit_name
    category: string;          // Items.category
    tax: number;               // from Category.tax
    make: string;              // Items.make_name (default make)
    available_makes: string[]; // from Category Makelist batch
    procurement_package: string; // Category.work_package
}

export interface UseItemCatalogReturn {
    itemOptions: ItemCatalogOption[];
    chargeOptions: ItemCatalogOption[];
    categories: Category[];
    categoryNames: string[];
    isLoading: boolean;
    error: Error | null;
    itemMutate: () => Promise<any>;
    categoryMakeListMutate: () => Promise<any>;
}

// ── Exported Token Search Config ─────────────────────────────────────────────

export const ITEM_TOKEN_SEARCH_CONFIG: TokenSearchConfig = {
    searchFields: ["label", "value", "category"],
    minSearchLength: 1,
    partialMatch: true,
    fieldWeights: { label: 2.0, value: 1.5, category: 1.0 },
    minTokenMatches: 1,
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useItemCatalog(): UseItemCatalogReturn {
    // 1. Fetch all Procurement Packages except "Services"
    const { data: packages, isLoading: packagesLoading } =
        useFrappeGetDocList<ProcurementPackages>("Procurement Packages", {
            fields: ["name", "work_package_name"],
            filters: [["name", "not in", ["Services"]]],
            limit: 0,
        });

    const packageNames = useMemo(
        () => packages?.map((p) => p.name) ?? [],
        [packages]
    );

    // 2. Fetch Categories for those packages, excluding "HVAC Junk"
    const { data: categoriesRaw, isLoading: categoriesLoading } =
        useFrappeGetDocList<Category>(
            "Category",
            {
                fields: [
                    "name",
                    "category_name",
                    "work_package",
                    "tax",
                    "new_items",
                ],
                filters: [
                    ["work_package", "in", packageNames],
                    ["name", "!=", "HVAC Junk"],
                ],
                limit: 0,
            },
            packageNames.length > 0 ? undefined : null
        );

    const categories = categoriesRaw ?? [];

    const categoryNames = useMemo(
        () => categories.map((c) => c.name),
        [categories]
    );

    // 3. Fetch Items for those categories
    const {
        data: itemsRaw,
        isLoading: itemsLoading,
        mutate: itemMutate,
    } = useFrappeGetDocList<Items>(
        "Items",
        {
            fields: [
                "name",
                "item_name",
                "unit_name",
                "make_name",
                "category",
                "creation",
            ],
            filters: [["category", "in", categoryNames]],
            limit: 0,
        },
        categoryNames.length > 0 ? undefined : null
    );

    // 4. Fetch Category Makelist for those categories
    const {
        data: categoryMakelistRaw,
        isLoading: categoryMakelistLoading,
        mutate: categoryMakeListMutate,
    } = useFrappeGetDocList<CategoryMakelist>(
        "Category Makelist",
        {
            fields: ["category", "make"],
            filters: [["category", "in", categoryNames]],
            limit: 0,
        },
        categoryNames.length > 0 ? undefined : null
    );

    // ── Derived: category → tax map ──────────────────────────────────────────
    const categoryTaxMap = useMemo(() => {
        const map: Record<string, number> = {};
        categories.forEach((c) => {
            map[c.name] = parseFloat(c.tax as string) || 0;
        });
        return map;
    }, [categories]);

    // ── Derived: category → procurement_package map ──────────────────────────
    const categoryPackageMap = useMemo(() => {
        const map: Record<string, string> = {};
        categories.forEach((c) => {
            map[c.name] = c.work_package;
        });
        return map;
    }, [categories]);

    // ── Derived: category → available_makes[] map ────────────────────────────
    const categoryMakesMap = useMemo(() => {
        const map: Record<string, string[]> = {};
        categoryMakelistRaw?.forEach((cm) => {
            if (!map[cm.category]) map[cm.category] = [];
            if (cm.make && !map[cm.category].includes(cm.make)) {
                map[cm.category].push(cm.make);
            }
        });
        return map;
    }, [categoryMakelistRaw]);

    // ── Build item options ───────────────────────────────────────────────────
    const allOptions = useMemo<ItemCatalogOption[]>(() => {
        if (!itemsRaw) return [];

        return itemsRaw.map((item) => ({
            value: item.name,
            label: item.item_name,
            item_id: item.name,
            item_name: item.item_name,
            unit: item.unit_name,
            category: item.category,
            tax: categoryTaxMap[item.category] ?? 0,
            make: item.make_name ?? "",
            available_makes: categoryMakesMap[item.category] ?? [],
            procurement_package: categoryPackageMap[item.category] ?? "",
        }));
    }, [itemsRaw, categoryTaxMap, categoryPackageMap, categoryMakesMap]);

    // ── Split: regular items vs Additional Charges ───────────────────────────
    const { itemOptions, chargeOptions } = useMemo(() => {
        const items: ItemCatalogOption[] = [];
        const charges: ItemCatalogOption[] = [];

        allOptions.forEach((opt) => {
            if (opt.procurement_package === "Additional Charges") {
                charges.push(opt);
            } else {
                items.push(opt);
            }
        });

        return { itemOptions: items, chargeOptions: charges };
    }, [allOptions]);

    // ── Loading / Error ──────────────────────────────────────────────────────
    const isLoading =
        packagesLoading ||
        categoriesLoading ||
        itemsLoading ||
        categoryMakelistLoading;

    return {
        itemOptions,
        chargeOptions,
        categories,
        categoryNames,
        isLoading,
        error: null,
        itemMutate,
        categoryMakeListMutate,
    };
}

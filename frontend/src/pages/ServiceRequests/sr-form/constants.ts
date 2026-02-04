import { ClipboardList, Store, FileCheck, LucideIcon } from "lucide-react";
import { WizardStep } from "@/components/ui/wizard-steps";

/**
 * SR Wizard Steps Configuration
 *
 * Defines the steps for the service request creation wizard with icons and titles.
 */
export const SR_WIZARD_STEPS: WizardStep[] = [
    {
        key: "items",
        title: "Service Items",
        shortTitle: "Items",
        icon: ClipboardList,
    },
    {
        key: "vendor",
        title: "Vendor & Rates",
        shortTitle: "Vendor",
        icon: Store,
    },
    {
        key: "review",
        title: "Review",
        shortTitle: "Review",
        icon: FileCheck,
    },
];

/**
 * Section keys in order (for navigation)
 */
export const SR_SECTIONS = ["items", "vendor", "review"] as const;

export type SRSectionKey = (typeof SR_SECTIONS)[number];

/**
 * Section titles for display
 */
export const SR_SECTION_TITLES: Record<SRSectionKey, string> = {
    items: "Add Service Items",
    vendor: "Select Vendor & Set Rates",
    review: "Review & Submit",
};

/**
 * Section descriptions for display
 */
export const SR_SECTION_DESCRIPTIONS: Record<SRSectionKey, string> = {
    items: "Select a category and add the services you need",
    vendor: "Choose a vendor and set rates for each service item",
    review: "Review the service request details before submission",
};

/**
 * Get next section in the wizard
 */
export const getNextSection = (currentSection: SRSectionKey): SRSectionKey => {
    const currentIndex = SR_SECTIONS.indexOf(currentSection);
    if (currentIndex < SR_SECTIONS.length - 1) {
        return SR_SECTIONS[currentIndex + 1];
    }
    return currentSection;
};

/**
 * Get previous section in the wizard
 */
export const getPreviousSection = (currentSection: SRSectionKey): SRSectionKey => {
    const currentIndex = SR_SECTIONS.indexOf(currentSection);
    if (currentIndex > 0) {
        return SR_SECTIONS[currentIndex - 1];
    }
    return currentSection;
};

/**
 * Get section index by key
 */
export const getSectionIndex = (section: SRSectionKey): number => {
    return SR_SECTIONS.indexOf(section);
};

/**
 * Get section key by index
 */
export const getSectionByIndex = (index: number): SRSectionKey => {
    return SR_SECTIONS[index] ?? "items";
};

/**
 * Check if section is the first step
 */
export const isFirstStep = (section: SRSectionKey): boolean => {
    return section === "items";
};

/**
 * Check if section is the last step (review)
 */
export const isLastStep = (section: SRSectionKey): boolean => {
    return section === "review";
};

/**
 * Common Units of Measure for services
 */
export const COMMON_UOMS = [
    "Sq.ft",
    "Sq.m",
    "R.ft",
    "R.m",
    "Nos",
    "Set",
    "Lot",
    "Job",
    "LS",
    "Day",
    "Hour",
    "Trip",
    "Kg",
    "MT",
] as const;

export type CommonUOM = (typeof COMMON_UOMS)[number];

/**
 * Service category icon mapping (optional - for future use)
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
    // Can be extended with specific category icons
};

/**
 * Default placeholder texts
 */
export const PLACEHOLDERS = {
    description: "Describe the service required...",
    uom: "Select or enter unit",
    quantity: "Enter quantity",
    rate: "Enter rate",
    comments: "Add any additional notes or comments...",
    searchVendor: "Search vendors by name or location...",
    searchCategory: "Search categories...",
} as const;

/**
 * Validation messages
 */
export const VALIDATION_MESSAGES = {
    projectRequired: "Please select a project",
    itemsRequired: "At least one service item is required",
    vendorRequired: "Please select a vendor",
    ratesRequired: "Please set rates for all items",
    descriptionRequired: "Service description is required",
    uomRequired: "Unit of measure is required",
    quantityRequired: "Quantity must be greater than 0",
    rateRequired: "Rate is required",
} as const;

/**
 * Draft storage key prefix
 */
export const SR_DRAFT_STORAGE_KEY = "nirmaan-sr-draft";

/**
 * Auto-save debounce delay (ms)
 */
export const AUTO_SAVE_DELAY = 1000;

// src/pages/outflow-import/components/PorterProjectSelect.tsx
//
// The project picker a Porter order is placed with: in Review (#1446) and in Rectify (#1449). Both sit
// inside a modal dialog and offer the same choices -- every Won project the server sent, and No project.

import type { StylesConfig } from "react-select";

import { FuzzySearchSelect, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";

/** One choice: a Won project's name and its display name, or `NON_PROJECT`. */
export interface ProjectOption {
    value: string;
    label: string;
}

/** The choice that takes the orders off every project: they become Non-Project Expenses. */
export const NON_PROJECT: ProjectOption = { value: "", label: "No project (Non-Project expense)" };

const SEARCH: TokenSearchConfig = {
    searchFields: ["label", "value"],
    partialMatch: true,
    fieldWeights: { label: 2.0, value: 1.5 },
};

/**
 * ⚠️ THE MENU IS PORTALED OUT OF THE DIALOG, AND A MODAL DIALOG SETS `pointer-events: none` ON THE BODY: without
 * `pointerEvents: "auto"` a click on an option falls through (found on the Rectify walk: it picked the wrong
 * project). The `RequestTdsItemDialog` pattern.
 */
const PORTAL_STYLES: StylesConfig<ProjectOption, false> = {
    menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
};

/** No project first, then the server's Won projects in its order. */
export const projectOptions = (projects: readonly { name: string; project_name: string }[]): ProjectOption[] => [
    NON_PROJECT,
    ...projects.map((project) => ({ value: project.name, label: project.project_name })),
];

/** The picker. `onChange` receives the chosen option, or null when it is cleared. */
export const PorterProjectSelect = ({
    options,
    value,
    onChange,
    placeholder,
    isClearable = false,
    isDisabled = false,
}: {
    options: ProjectOption[];
    value: ProjectOption | null;
    onChange: (option: ProjectOption | null) => void;
    placeholder: string;
    isClearable?: boolean;
    isDisabled?: boolean;
}) => (
    <FuzzySearchSelect<ProjectOption, false>
        allOptions={options}
        tokenSearchConfig={SEARCH}
        value={value}
        onChange={(option) => onChange(option ?? null)}
        placeholder={placeholder}
        isClearable={isClearable}
        isDisabled={isDisabled}
        menuPortalTarget={document.body}
        menuPosition="fixed"
        styles={PORTAL_STYLES}
    />
);

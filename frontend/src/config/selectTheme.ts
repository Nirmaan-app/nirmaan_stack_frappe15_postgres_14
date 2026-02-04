/**
 * Centralized react-select theme configuration
 *
 * Uses CSS variables for automatic light/dark mode support.
 * CSS variables defined in src/index.css:
 * - --primary: 346.8 77.2% 49.8% (Rose/Magenta)
 * - --primary-foreground: 355.7 100% 97.3%
 * - --border, --background, --popover, --accent, --muted, etc.
 */

import { StylesConfig, GroupBase } from "react-select";

/**
 * Returns default react-select styles using CSS variables for theming.
 * Matches shadcn/ui styling conventions (36px height, 8px radius, focus ring).
 */
export function getSelectStyles<
    Option,
    IsMulti extends boolean = false
>(): StylesConfig<Option, IsMulti, GroupBase<Option>> {
    return {
        control: (base, state) => ({
            ...base,
            backgroundColor: "hsl(var(--background))",
            borderColor: state.isFocused
                ? "hsl(var(--ring))"
                : "hsl(var(--border))",
            borderRadius: "calc(var(--radius))", // 8px
            minHeight: "36px", // h-9 equivalent
            boxShadow: state.isFocused
                ? "0 0 0 1px hsl(var(--ring))"
                : "none",
            "&:hover": {
                borderColor: state.isFocused
                    ? "hsl(var(--ring))"
                    : "hsl(var(--border))",
            },
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }),

        menu: (base) => ({
            ...base,
            backgroundColor: "hsl(var(--popover))",
            borderRadius: "calc(var(--radius))",
            border: "1px solid hsl(var(--border))",
            boxShadow:
                "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            zIndex: 50,
            overflow: "hidden",
            // Ensure menu is clickable inside Radix dialogs
            pointerEvents: "auto" as const,
        }),

        menuPortal: (base) => ({
            ...base,
            zIndex: 9999, // Higher than dialog overlays (z-50 = 50)
            // CRITICAL: Override pointer-events:none set by Radix UI dialogs
            // Without this, clicking on menu items is blocked when inside AlertDialog/Dialog
            pointerEvents: "auto" as const,
        }),

        menuList: (base) => ({
            ...base,
            padding: "4px",
            // Ensure scrolling works inside Radix dialogs
            pointerEvents: "auto" as const,
        }),

        option: (base, state) => ({
            ...base,
            backgroundColor: state.isSelected
                ? "hsl(var(--primary))"
                : state.isFocused
                ? "hsl(var(--accent))"
                : "transparent",
            color: state.isSelected
                ? "hsl(var(--primary-foreground))"
                : "hsl(var(--popover-foreground))",
            borderRadius: "calc(var(--radius) - 4px)", // 4px
            cursor: "pointer",
            padding: "8px 12px",
            fontSize: "14px",
            // Ensure options are clickable inside Radix dialogs
            pointerEvents: "auto" as const,
            "&:active": {
                backgroundColor: state.isSelected
                    ? "hsl(var(--primary))"
                    : "hsl(var(--accent))",
            },
        }),

        placeholder: (base) => ({
            ...base,
            color: "hsl(var(--muted-foreground))",
            fontSize: "14px",
        }),

        input: (base) => ({
            ...base,
            color: "hsl(var(--foreground))",
            fontSize: "14px",
        }),

        singleValue: (base) => ({
            ...base,
            color: "hsl(var(--foreground))",
            fontSize: "14px",
        }),

        valueContainer: (base) => ({
            ...base,
            padding: "2px 8px",
        }),

        indicatorSeparator: (base) => ({
            ...base,
            backgroundColor: "hsl(var(--border))",
        }),

        dropdownIndicator: (base, state) => ({
            ...base,
            color: state.isFocused
                ? "hsl(var(--foreground))"
                : "hsl(var(--muted-foreground))",
            padding: "6px",
            "&:hover": {
                color: "hsl(var(--foreground))",
            },
        }),

        clearIndicator: (base) => ({
            ...base,
            color: "hsl(var(--muted-foreground))",
            padding: "6px",
            "&:hover": {
                color: "hsl(var(--destructive))",
            },
        }),

        loadingIndicator: (base) => ({
            ...base,
            color: "hsl(var(--primary))",
        }),

        // Multi-select styles
        multiValue: (base) => ({
            ...base,
            backgroundColor: "hsl(var(--secondary))",
            borderRadius: "calc(var(--radius) - 4px)",
        }),

        multiValueLabel: (base) => ({
            ...base,
            color: "hsl(var(--secondary-foreground))",
            fontSize: "12px",
            padding: "2px 6px",
        }),

        multiValueRemove: (base) => ({
            ...base,
            color: "hsl(var(--muted-foreground))",
            "&:hover": {
                backgroundColor: "hsl(var(--destructive))",
                color: "hsl(var(--destructive-foreground))",
            },
        }),

        // No options message
        noOptionsMessage: (base) => ({
            ...base,
            color: "hsl(var(--muted-foreground))",
            fontSize: "14px",
        }),

        // Loading message
        loadingMessage: (base) => ({
            ...base,
            color: "hsl(var(--muted-foreground))",
            fontSize: "14px",
        }),

        // Group styles
        group: (base) => ({
            ...base,
            paddingTop: "8px",
            paddingBottom: "0",
        }),

        groupHeading: (base) => ({
            ...base,
            color: "hsl(var(--muted-foreground))",
            fontSize: "12px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "8px 12px 4px",
        }),
    };
}

/**
 * Merges default styles with custom style overrides.
 * Custom styles take precedence for each style key.
 *
 * @example
 * const customStyles = { control: (base) => ({ ...base, minHeight: '40px' }) };
 * const merged = mergeSelectStyles(getSelectStyles(), customStyles);
 */
export function mergeSelectStyles<
    Option,
    IsMulti extends boolean = false
>(
    defaultStyles: StylesConfig<Option, IsMulti, GroupBase<Option>>,
    customStyles: StylesConfig<Option, IsMulti, GroupBase<Option>>
): StylesConfig<Option, IsMulti, GroupBase<Option>> {
    const merged: StylesConfig<Option, IsMulti, GroupBase<Option>> = {
        ...defaultStyles,
    };

    // Iterate through custom styles and merge with defaults
    for (const key of Object.keys(customStyles) as Array<
        keyof StylesConfig<Option, IsMulti, GroupBase<Option>>
    >) {
        const defaultStyleFn = defaultStyles[key];
        const customStyleFn = customStyles[key];

        if (typeof customStyleFn === "function") {
            if (typeof defaultStyleFn === "function") {
                // Both are functions - compose them
                (merged as any)[key] = (
                    base: any,
                    props: any
                ) => {
                    const defaultResult = (defaultStyleFn as Function)(
                        base,
                        props
                    );
                    return (customStyleFn as Function)(defaultResult, props);
                };
            } else {
                // Only custom is a function
                (merged as any)[key] = customStyleFn;
            }
        }
    }

    return merged;
}

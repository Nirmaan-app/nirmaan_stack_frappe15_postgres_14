import React from 'react';
import { cn } from '@/lib/utils'; // Your utility for class names

interface ModeSwitcherProps {
    currentMode: string;
    onModeChange: (mode: 'edit' | 'view') => void; // Enforce specific modes
    disabled?: boolean;
}

export const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ currentMode, onModeChange, disabled }) => {
    const baseClass = "py-1 px-4 rounded-md cursor-pointer text-xs transition-colors duration-150 ease-in-out";
    const activeClass = "bg-primary/10 text-primary font-medium";
    const inactiveClass = "hover:bg-gray-100 text-gray-600";

    return (
        <div className={cn(
            "flex items-center border border-gray-300 rounded-md text-xs",
            disabled ? "opacity-50 cursor-not-allowed" : ""
        )}>
            <span
                role="radio"
                tabIndex={disabled ? -1 : 0}
                aria-checked={currentMode === "edit"}
                onClick={() => !disabled && onModeChange("edit")}
                onKeyDown={(e) => !disabled && (e.key === 'Enter' || e.key === ' ') && onModeChange("edit")}
                className={cn(baseClass, currentMode === "edit" ? activeClass : inactiveClass, "rounded-r-none border-r border-gray-300")}
            >
                Edit
            </span>
            <span
                role="radio"
                tabIndex={disabled ? -1 : 0}
                aria-checked={currentMode === "view"}
                onClick={() => !disabled && onModeChange("view")}
                 onKeyDown={(e) => !disabled && (e.key === 'Enter' || e.key === ' ') && onModeChange("view")}
                className={cn(baseClass, currentMode === "view" ? activeClass : inactiveClass, "rounded-l-none")}
            >
                View
            </span>
        </div>
    );
};
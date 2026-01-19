import React from 'react';


interface ViewCardProps {
    label: string;
    name: string;
    logo?: string | File | null;
}

export const ViewCard: React.FC<ViewCardProps> = ({ label, name, logo }) => {
    // Helper to get icon based on label (matching RoleCard logic roughly or just generic)
    // The design spec says "Square logo container... Fallback to neutral placeholder"
    
    // We can infer icon from label if we want, or pass it. 
    // Requirement says: "Left Section: Square logo container... Right Section: Small label... Primary text"
    
    const renderPlaceholder = () => {
         // Placeholder pattern matching the design description (neutral)
         return (
            <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <span className="text-gray-400 font-bold text-lg uppercase select-none">
                    {name ? name.charAt(0) : '-'}
                </span>
            </div>
         );
    };

    const logoSrc = logo instanceof File ? URL.createObjectURL(logo) : logo;

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 hover:shadow-sm transition-shadow h-full cursor-default">
            {/* Left: Logo */}
            {logoSrc ? (
                 <div className="w-11 h-11 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center overflow-hidden">
                    <img 
                        src={logoSrc} 
                        alt={`${label} Logo`} 
                        className="w-full h-full object-contain p-1" 
                    />
                 </div>
            ) : renderPlaceholder()}

            {/* Right: Text */}
            <div className="flex flex-col min-w-0 justify-center">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate mb-0.5">
                    {label}
                </span>
                <span className="text-base font-semibold text-gray-900 truncate leading-tight" title={name}>
                    {name}
                </span>
            </div>
        </div>
    );
};

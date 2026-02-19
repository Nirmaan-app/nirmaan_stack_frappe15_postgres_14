import React, { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface RoleCardProps {
    label: string;
    placeholder: string;
    icon: React.ReactNode;
    value: string;
    onChange: (value: string) => void;
    logo: File | string | null;
    onLogoUpload: (file: File) => void;
    onLogoRemove: () => void;
    error?: string;
    enabled: boolean;
    onEnableChange: (enabled: boolean) => void;
    helperText?: React.ReactNode;
}

export const RoleCard: React.FC<RoleCardProps> = ({
    label,
    placeholder,
    icon,
    value,
    onChange,
    logo,
    onLogoUpload,
    onLogoRemove,
    error,
    enabled,
    onEnableChange,
    helperText
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.type.startsWith('image/')) {
                onLogoUpload(file);
            }
        }
    };

    const triggerFileUpload = () => {
        if (!enabled) return;
        fileInputRef.current?.click();
    };

    return (
        <div className={cn(
            "bg-[#f8f9fB] rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4 h-full transition-all relative overflow-hidden",
            !enabled && "opacity-60 bg-gray-50 pointer-events-none"
        )}>
            {/* Header */}
            <div className="flex items-center justify-between gap-2 text-gray-700 pointer-events-auto">
                <div className="flex items-center gap-2">
                    {icon}
                    <Label className="text-sm font-semibold flex items-center gap-1">
                        {label} <span className="text-red-500">*</span>
                    </Label>
                </div>
                <Switch 
                    checked={enabled} 
                    onCheckedChange={onEnableChange}
                    className="data-[state=checked]:bg-green-500"
                />
            </div>

            {/* Input */}
            <div className="space-y-1">
                <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    disabled={!enabled}
                    className={cn(
                        "h-10 bg-white border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 transition-all",
                        error && "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                    )}
                />
                {error && <span className="text-xs text-red-500 font-medium">{error}</span>}
            </div>

            {/* Logo Upload */}
            <div className="mt-auto pt-2">
                <div 
                    onClick={triggerFileUpload}
                    className={cn(
                        "group relative border border-dashed border-gray-200 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50/50 hover:border-blue-300 transition-all",
                        logo && "border-blue-200 bg-blue-50/30"
                    )}
                >
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="image/png, image/jpeg, image/svg+xml"
                        onChange={handleFileChange}
                    />

                    {logo ? (
                        <>
                            <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                                <img 
                                    src={typeof logo === 'string' ? logo : URL.createObjectURL(logo)} 
                                    alt="Logo preview" 
                                    className="w-full h-full object-contain p-1"
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-700 truncate">
                                    {typeof logo === 'string' ? logo.split('/').pop() : logo.name}
                                </p>
                                <p className="text-xs text-blue-600 font-medium hover:underline">Replace Logo</p>
                            </div>
                            {/* <button 
                                onClick={(e) => { e.stopPropagation(); onLogoRemove(); }}
                                className="p-1 hover:bg-red-50 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button> */}
                        </>
                    ) : (
                        <>
                            <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-gray-200 transition-all">
                                <Upload className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-blue-600 group-hover:underline decoration-blue-300 underline-offset-2">Upload Logo</p>
                                <p className="text-xs text-gray-400">(Optional)</p>
                            </div>
                        </>
                    )}
                    </div>
            {helperText && (
                <div className="mt-2 text-xs text-muted-foreground text-center">
                    {helperText}
                </div>
            )}
        </div>
        </div>
    );
};

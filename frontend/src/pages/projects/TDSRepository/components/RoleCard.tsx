import React, { useRef, useState, useEffect } from 'react';
import { Upload, X, RefreshCw } from 'lucide-react';
import { CustomAttachment } from '../../../../components/helpers/CustomAttachment';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (logo instanceof File) {
            const url = URL.createObjectURL(logo);
            setPreviewUrl(url);
            return () => URL.revokeObjectURL(url);
        } else if (typeof logo === 'string') {
            setPreviewUrl(logo);
        } else {
            setPreviewUrl(null);
        }
    }, [logo]);

    const handleReplaceClick = () => {
        if (!enabled) return;
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onLogoUpload(file);
        }
        // Reset the input value so the same file can be selected again
        if (e.target) {
            e.target.value = '';
        }
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
            <div className="mt-auto pt-2 pointer-events-auto">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    className="hidden"
                />
                {previewUrl ? (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between p-2 bg-accent/10 rounded-md">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <a
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm truncate max-w-[150px] hover:underline text-primary"
                                >
                                    {typeof logo === 'string' ? logo.split('/').pop() : (logo instanceof File ? logo.name : 'Selected file')}
                                </a>
                            </div>
                            
                            <button
                                type="button"
                                disabled={!enabled}
                                onClick={onLogoRemove}
                                className="p-1 rounded-full hover:bg-accent/20 transition-colors"
                                aria-label="Remove file"
                            >
                                <X className="h-4 w-4 text-destructive" aria-hidden="true" />
                            </button>
                        </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full text-xs h-8 gap-2 border-dashed border-primary/50 text-primary hover:bg-primary/5"
                            onClick={handleReplaceClick}
                            disabled={!enabled}
                        >
                            <RefreshCw className="h-3 w-3" />
                            Replace Logo
                        </Button>
                    </div>
                ) : helperText ? (
                    <div className="flex flex-col gap-2">
                        <div className="text-center">
                            {helperText}
                        </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full text-xs h-8 gap-2 border-dashed border-primary/50 text-primary hover:bg-primary/5"
                            onClick={handleReplaceClick}
                            disabled={!enabled}
                        >
                            <RefreshCw className="h-3 w-3" />
                            Replace Logo
                        </Button>
                    </div>
                ) : (
                    <CustomAttachment
                        selectedFile={logo as File | null}
                        onFileSelect={(file) => {
                            if (file) {
                                onLogoUpload(file);
                            } else {
                                onLogoRemove();
                            }
                        }}
                        disabled={!enabled}
                        acceptedTypes="image/*"
                        label="Upload Logo"
                    />
                )}
            </div>
            
        </div>
    );
};

import React, { useState } from 'react';
import { 
    Building2, 
    User, 
    HardHat, 
    PencilRuler, 
    Briefcase,
    Settings2 
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RoleCard } from './RoleCard';

interface SetupTDSRepositoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: TDSRepositoryData) => void;
    initialData?: Partial<TDSRepositoryData>;
    isLoading?: boolean;
}

export interface TDSRepositoryData {
    client: RoleData;
    projectManager: RoleData;
    architect: RoleData;
    consultant: RoleData;
    gcContractor: RoleData;
    mepContractor: RoleData;
}

export interface RoleData {
    name: string;
    logo: File | string | null;
}

export const SetupTDSRepositoryDialog: React.FC<SetupTDSRepositoryDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    initialData,
    isLoading = false
}) => {
    const [formData, setFormData] = useState<TDSRepositoryData>({
        client: { name: initialData?.client?.name || '', logo: initialData?.client?.logo || null },
        projectManager: { name: initialData?.projectManager?.name || '', logo: initialData?.projectManager?.logo || null },
        architect: { name: initialData?.architect?.name || '', logo: initialData?.architect?.logo || null },
        consultant: { name: initialData?.consultant?.name || '', logo: initialData?.consultant?.logo || null },
        gcContractor: { name: initialData?.gcContractor?.name || '', logo: initialData?.gcContractor?.logo || null },
        mepContractor: { name: initialData?.mepContractor?.name || '', logo: initialData?.mepContractor?.logo || null }
    });

    const [errors, setErrors] = useState<Partial<Record<keyof TDSRepositoryData, string>>>({});

    const handleUpdate = (role: keyof TDSRepositoryData, field: keyof RoleData, value: any) => {
        setFormData(prev => ({
            ...prev,
            [role]: { ...prev[role], [field]: value }
        }));
        
        // Clear error when user types
        if (field === 'name' && errors[role]) {
            setErrors(prev => ({ ...prev, [role]: undefined }));
        }
    };

    const validate = (): boolean => {
        const newErrors: Partial<Record<keyof TDSRepositoryData, string>> = {};
        let isValid = true;

        (Object.keys(formData) as Array<keyof TDSRepositoryData>).forEach(key => {
            if (!formData[key].name.trim()) {
                newErrors[key] = "Name is required";
                isValid = false;
            }
        });

        setErrors(newErrors);
        return isValid;
    };

    const handleConfirm = () => {
        if (validate()) {
            onConfirm(formData);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !isLoading && onClose()}>
            <DialogContent className="max-w-[1000px] bg-[#F8F9FB] p-0 gap-0 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 bg-white border-b border-gray-100">
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                            <Settings2 className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                            <DialogTitle className="text-xl font-semibold text-gray-900">
                                Set up TDS Repository
                            </DialogTitle>
                            <DialogDescription className="text-sm text-gray-500">
                                These details will appear for all TDS submissions for this project
                            </DialogDescription>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto max-h-[70vh]">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <RoleCard
                            label="Client"
                            placeholder="Enter Client Name"
                            icon={<Building2 className="w-5 h-5" />}
                            value={formData.client.name}
                            onChange={(val) => handleUpdate('client', 'name', val)}
                            logo={formData.client.logo}
                            onLogoUpload={(file) => handleUpdate('client', 'logo', file)}
                            onLogoRemove={() => handleUpdate('client', 'logo', null)}
                            error={errors.client}
                        />

                        <RoleCard
                            label="Project Manager"
                            placeholder="Enter Project Manager Name"
                            icon={<User className="w-5 h-5" />}
                            value={formData.projectManager.name}
                            onChange={(val) => handleUpdate('projectManager', 'name', val)}
                            logo={formData.projectManager.logo}
                            onLogoUpload={(file) => handleUpdate('projectManager', 'logo', file)}
                            onLogoRemove={() => handleUpdate('projectManager', 'logo', null)}
                            error={errors.projectManager}
                        />

                        <RoleCard
                            label="Architect"
                            placeholder="Enter Architect Name"
                            icon={<PencilRuler className="w-5 h-5" />}
                            value={formData.architect.name}
                            onChange={(val) => handleUpdate('architect', 'name', val)}
                            logo={formData.architect.logo}
                            onLogoUpload={(file) => handleUpdate('architect', 'logo', file)}
                            onLogoRemove={() => handleUpdate('architect', 'logo', null)}
                            error={errors.architect}
                        />

                        <RoleCard
                            label="Consultant"
                            placeholder="Enter Consultant Name"
                            icon={<Briefcase className="w-5 h-5" />}
                            value={formData.consultant.name}
                            onChange={(val) => handleUpdate('consultant', 'name', val)}
                            logo={formData.consultant.logo}
                            onLogoUpload={(file) => handleUpdate('consultant', 'logo', file)}
                            onLogoRemove={() => handleUpdate('consultant', 'logo', null)}
                            error={errors.consultant}
                        />

                        <RoleCard
                            label="GC Contractor"
                            placeholder="Enter GC Contractor Name"
                            icon={<Building2 className="w-5 h-5" />}
                            value={formData.gcContractor.name}
                            onChange={(val) => handleUpdate('gcContractor', 'name', val)}
                            logo={formData.gcContractor.logo}
                            onLogoUpload={(file) => handleUpdate('gcContractor', 'logo', file)}
                            onLogoRemove={() => handleUpdate('gcContractor', 'logo', null)}
                            error={errors.gcContractor}
                        />

                        <RoleCard
                            label="MEP Contractor"
                            placeholder="Enter MEP Contractor Name"
                            icon={<HardHat className="w-5 h-5" />}
                            value={formData.mepContractor.name}
                            onChange={(val) => handleUpdate('mepContractor', 'name', val)}
                            logo={formData.mepContractor.logo}
                            onLogoUpload={(file) => handleUpdate('mepContractor', 'logo', file)}
                            onLogoRemove={() => handleUpdate('mepContractor', 'logo', null)}
                            error={errors.mepContractor}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-white border-t border-gray-100 flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose} disabled={isLoading} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleConfirm}
                        disabled={isLoading}
                        className="bg-red-600 hover:bg-red-700 text-white min-w-[100px]"
                    >
                        {isLoading ? "Saving..." : "Confirm"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

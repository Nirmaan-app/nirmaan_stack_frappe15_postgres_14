import React, { useState, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Package, CheckCircle2 } from "lucide-react";

interface POItem {
    name: string;
    items_count: number;
    creation: string;
    status?: string;
    work_package?: string;
    items?: any[];
    is_critical?: boolean;
}

interface AllPOsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selectedPOs: POItem[]) => void;
    pos: POItem[];
    associatedPOs?: string[]; // POs that are Critical POs for the selected task
    isLoading?: boolean;
}

export const AllPOsModal: React.FC<AllPOsModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    pos,
    associatedPOs = [],
    isLoading = false,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedPOIds, setSelectedPOIds] = useState<Set<string>>(new Set());

    // Filter POs based on search query
    const filteredPOs = useMemo(() => {
        if (!searchQuery.trim()) return pos;
        const query = searchQuery.toLowerCase();
        return pos.filter(
            (po) =>
                po.name.toLowerCase().includes(query) ||
                po.work_package?.toLowerCase().includes(query)
        );
    }, [pos, searchQuery]);

    // Check if a PO is a Critical PO (either locally associated or globally flagged)
    const isCriticalPO = (po: POItem) => {
        return po.is_critical || associatedPOs.some(id => id.trim() === po.name.trim());
    };

    // Toggle PO selection
    const togglePO = (poName: string) => {
        const newSelected = new Set(selectedPOIds);
        if (newSelected.has(poName)) {
            newSelected.delete(poName);
        } else {
            newSelected.add(poName);
        }
        setSelectedPOIds(newSelected);
    };

    // Select all visible POs
    const selectAll = () => {
        const newSelected = new Set(selectedPOIds);
        filteredPOs.forEach((po) => newSelected.add(po.name));
        setSelectedPOIds(newSelected);
    };

    // Clear all selections
    const clearAll = () => {
        setSelectedPOIds(new Set());
    };

    // Handle confirm
    const handleConfirm = () => {
        const selectedPOsList = pos.filter((po) => selectedPOIds.has(po.name));
        onConfirm(selectedPOsList);
        setSelectedPOIds(new Set());
        setSearchQuery("");
    };

    // Handle close
    const handleClose = () => {
        setSelectedPOIds(new Set());
        setSearchQuery("");
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        Select POs from Project
                    </DialogTitle>
                </DialogHeader>

                {/* Search Input */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search POs by ID or Work Package..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>

                {/* Selection actions */}
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                        {selectedPOIds.size} of {pos.length} selected
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={selectAll}
                            disabled={filteredPOs.length === 0}
                        >
                            Select All
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearAll}
                            disabled={selectedPOIds.size === 0}
                        >
                            Clear
                        </Button>
                    </div>
                </div>

                {/* PO List */}
                <ScrollArea className="h-[300px] border rounded-md">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                    ) : filteredPOs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <Package className="h-12 w-12 mb-2 opacity-50" />
                            <p>No POs found</p>
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {filteredPOs.map((po) => (
                                <div
                                    key={po.name}
                                    className={`flex items-center gap-3 p-3 rounded-md cursor-pointer hover:bg-accent transition-colors ${
                                        selectedPOIds.has(po.name)
                                            ? "bg-accent"
                                            : ""
                                    }`}
                                    onClick={() => togglePO(po.name)}
                                >
                                    <Checkbox
                                        checked={selectedPOIds.has(po.name)}
                                        onCheckedChange={() => togglePO(po.name)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium truncate">
                                                {po.name}
                                            </span>
                                            {isCriticalPO(po) && (
                                                <Badge
                                                    variant="default"
                                                    className="bg-blue-500 text-xs"
                                                >
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                    Critical
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                            <span>{po.items_count} items</span>
                                            {po.work_package && (
                                                <span>• {po.work_package}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={selectedPOIds.size === 0}
                    >
                        Confirm ({selectedPOIds.size} selected)
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AllPOsModal;

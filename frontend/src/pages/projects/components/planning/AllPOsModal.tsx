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
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Search, Package, CheckCircle2 } from "lucide-react";

interface POItemDetail {
    name: string;
    item_name?: string;
    quantity?: number;
    unit?: string;
    uom?: string;
    [key: string]: any;
}

interface POItem {
    name: string;
    items_count: number;
    creation: string;
    status?: string;
    work_package?: string;
    items?: POItemDetail[];
    is_critical?: boolean;
    associated_tasks?: { task_name: string; item_name: string; category: string }[];
}

interface AllPOsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selectedPOs: POItem[], selectedItems: Record<string, Set<string>>) => void;
    pos: POItem[];
    associatedPOs?: string[];
    isLoading?: boolean;
    currentCategory?: string;
    currentTask?: string;
}

export const AllPOsModal: React.FC<AllPOsModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    pos,
    associatedPOs = [],
    isLoading = false,
    currentCategory,
    currentTask,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedPOIds, setSelectedPOIds] = useState<Set<string>>(new Set());
    const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>({});
    const [expandedPO, setExpandedPO] = useState<string>("");

    // Unified search: filter POs by name/work_package OR by items
    const { filteredPOs, itemMatchedPOs } = useMemo(() => {
        if (!searchQuery.trim()) {
            return { filteredPOs: pos, itemMatchedPOs: new Set<string>() };
        }
        
        const query = searchQuery.toLowerCase();
        const matchedByItem = new Set<string>();
        
        const filtered = pos.filter((po) => {
            // Check if PO name or work package matches
            const poMatches = po.name.toLowerCase().includes(query) ||
                po.work_package?.toLowerCase().includes(query);
            
            if (poMatches) return true;
            
            // Check if any item in this PO matches
            const items = po.items || [];
            const hasMatchingItem = items.some((item) =>
                item.item_name?.toLowerCase().includes(query) ||
                item.name?.toLowerCase().includes(query)
            );
            
            if (hasMatchingItem) {
                matchedByItem.add(po.name);
                return true;
            }
            
            return false;
        });
        
        return { filteredPOs: filtered, itemMatchedPOs: matchedByItem };
    }, [pos, searchQuery]);

    // Check if a PO is a Critical PO
    const isCriticalPO = (po: POItem) => {
        return po.is_critical || associatedPOs.some(id => id.trim() === po.name.trim());
    };

    // Get all items for a PO (search only filters POs, not items inside)
    const getAllItems = (po: POItem) => {
        return po.items || [];
    };

    // Toggle PO selection
    const togglePO = (poName: string) => {
        const newSelected = new Set(selectedPOIds);
        if (newSelected.has(poName)) {
            newSelected.delete(poName);
            // Also clear item selections for this PO
            const newItems = { ...selectedItems };
            delete newItems[poName];
            setSelectedItems(newItems);
        } else {
            newSelected.add(poName);
            // Auto-select all items when PO is selected
            const po = pos.find(p => p.name === poName);
            if (po?.items) {
                const newItems = { ...selectedItems };
                newItems[poName] = new Set(po.items.map(i => i.name));
                setSelectedItems(newItems);
            }
        }
        setSelectedPOIds(newSelected);
    };

    // Toggle item selection within a PO
    const toggleItem = (poName: string, itemName: string) => {
        const newItems = { ...selectedItems };
        if (!newItems[poName]) {
            newItems[poName] = new Set();
        }
        
        if (newItems[poName].has(itemName)) {
            newItems[poName].delete(itemName);
            // If no items selected, deselect the PO
            if (newItems[poName].size === 0) {
                const newSelected = new Set(selectedPOIds);
                newSelected.delete(poName);
                setSelectedPOIds(newSelected);
                delete newItems[poName];
            }
        } else {
            newItems[poName].add(itemName);
            // Auto-select the PO if not already selected
            if (!selectedPOIds.has(poName)) {
                const newSelected = new Set(selectedPOIds);
                newSelected.add(poName);
                setSelectedPOIds(newSelected);
            }
        }
        setSelectedItems(newItems);
    };

    // Select all items in a PO
    const selectAllItems = (poName: string) => {
        const po = pos.find(p => p.name === poName);
        if (po?.items) {
            const newItems = { ...selectedItems };
            newItems[poName] = new Set(po.items.map(i => i.name));
            setSelectedItems(newItems);
            
            if (!selectedPOIds.has(poName)) {
                const newSelected = new Set(selectedPOIds);
                newSelected.add(poName);
                setSelectedPOIds(newSelected);
            }
        }
    };

    // Clear all items in a PO
    const clearAllItems = (poName: string) => {
        const newItems = { ...selectedItems };
        delete newItems[poName];
        setSelectedItems(newItems);
        
        const newSelected = new Set(selectedPOIds);
        newSelected.delete(poName);
        setSelectedPOIds(newSelected);
    };

    // Select all visible POs
    const selectAll = () => {
        const newSelected = new Set(selectedPOIds);
        const newItems = { ...selectedItems };
        filteredPOs.forEach((po) => {
            newSelected.add(po.name);
            if (po.items) {
                newItems[po.name] = new Set(po.items.map(i => i.name));
            }
        });
        setSelectedPOIds(newSelected);
        setSelectedItems(newItems);
    };

    // Clear all selections
    const clearAll = () => {
        setSelectedPOIds(new Set());
        setSelectedItems({});
    };

    // Get total selected items count
    const totalSelectedItems = useMemo(() => {
        let count = 0;
        Object.values(selectedItems).forEach(set => count += set.size);
        return count;
    }, [selectedItems]);

    // Handle confirm
    const handleConfirm = () => {
        const selectedPOsList = pos.filter((po) => selectedPOIds.has(po.name));
        onConfirm(selectedPOsList, selectedItems);
        setSelectedPOIds(new Set());
        setSelectedItems({});
        setSearchQuery("");
    };

    // Handle close
    const handleClose = () => {
        setSelectedPOIds(new Set());
        setSelectedItems({});
        setSearchQuery("");
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-[700px] max-h-[85vh]">
                <DialogHeader>
                    <DialogTitle className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <Package className="h-5 w-5" />
                            Select POs and Items
                        </div>
                        {currentCategory && currentTask && (
                             <div className="text-xs font-normal text-muted-foreground flex items-center gap-2">
                                <span>Assigning to:</span>
                                <Badge variant="outline" className="text-[10px] h-5 gap-1 font-normal">
                                    {currentCategory} <span className="text-muted-foreground">/</span> {currentTask}
                                </Badge>
                             </div>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {/* Search Input - Unified */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search POs or items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>

                {/* Selection Summary */}
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                        {selectedPOIds.size} POs, {totalSelectedItems} items selected
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

                {/* PO List with Accordion */}
                <ScrollArea className="h-[350px] border rounded-md">
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
                        <Accordion
                            type="single"
                            collapsible
                            value={expandedPO}
                            onValueChange={setExpandedPO}
                            className="p-2"
                        >
                            {filteredPOs.map((po) => {
                                const allItems = getAllItems(po);
                                const poSelectedItems = selectedItems[po.name] || new Set();
                                const isItemMatched = itemMatchedPOs.has(po.name);
                                
                                // Determine background color: selected > item-matched > default
                                let bgClass = "hover:bg-accent/50";
                                if (selectedPOIds.has(po.name)) {
                                    bgClass = "bg-accent";
                                } else if (isItemMatched) {
                                    bgClass = "bg-red-50 border border-red-200";
                                }
                                
                                return (
                                    <AccordionItem key={po.name} value={po.name} className="border-b-0 mb-1">
                                        <div className={`flex items-center gap-2 p-2 rounded-md ${bgClass}`}>
                                            <Checkbox
                                                checked={selectedPOIds.has(po.name)}
                                                onCheckedChange={() => togglePO(po.name)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <AccordionTrigger className="flex-1 hover:no-underline py-0">
                                                <div className="flex items-center gap-2 flex-1">
                                                    <span className="font-medium text-sm truncate">
                                                        {po.name}
                                                    </span>
                                                    {isCriticalPO(po) && (
                                                        <Badge variant="default" className="bg-blue-500 text-xs">
                                                            <CheckCircle2 className="h-3 w-3 mr-1" />
                                                            Critical
                                                        </Badge>
                                                    )}
                                                    <span className="text-xs text-muted-foreground ml-auto mr-2">
                                                        {poSelectedItems.size}/{po.items?.length || 0} items
                                                    </span>
                                                </div>
                                            </AccordionTrigger>
                                        </div>
                                        <AccordionContent className="pt-0 pb-2">
                                            <div className="ml-6 border-l-2 border-gray-200 pl-4">
                                                {/* Item Actions */}
                                                <div className="flex items-center justify-between mb-2 text-xs">
                                                    <span className="text-muted-foreground">
                                                        {allItems.length} items
                                                    </span>
                                                    <div className="flex gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 text-xs"
                                                            onClick={() => selectAllItems(po.name)}
                                                        >
                                                            All
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 text-xs"
                                                            onClick={() => clearAllItems(po.name)}
                                                        >
                                                            None
                                                        </Button>
                                                    </div>
                                                </div>
                                                
                                                {/* Items List */}
                                                <div className="space-y-1 max-h-[150px] overflow-y-auto">
                                                    {allItems.length === 0 ? (
                                                        <p className="text-xs text-muted-foreground py-2">No items match search</p>
                                                    ) : (
                                                        allItems.map((item) => (
                                                            <div
                                                                key={item.name}
                                                                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm ${
                                                                    poSelectedItems.has(item.name) ? "bg-blue-50" : "hover:bg-gray-50"
                                                                }`}
                                                                onClick={() => toggleItem(po.name, item.name)}
                                                            >
                                                                <Checkbox
                                                                    checked={poSelectedItems.has(item.name)}
                                                                    onCheckedChange={() => toggleItem(po.name, item.name)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                                <span className="flex-1 truncate text-xs">
                                                                    {item.item_name || item.name}
                                                                </span>
                                                                {item.quantity && (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        {item.quantity} {item.unit || item.uom}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                );
                            })}
                        </Accordion>
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
                        Confirm ({selectedPOIds.size} POs, {totalSelectedItems} items)
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AllPOsModal;

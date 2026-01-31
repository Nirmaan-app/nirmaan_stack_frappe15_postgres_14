import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useFrappePostCall } from "frappe-react-sdk";
import { useState, useEffect, useMemo } from "react";
import { Search } from "lucide-react";
import { formatCurrency } from "@/utils/formatters"; // Assuming utility exists, else will define simple one

interface GenericWO {
    name: string;
    vendor: string;
    vendor_name: string;
    grand_total: number;
    total_paid: number;
    items?: any[];
}

interface SelectWOModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    onConfirm: (selectedWOs: GenericWO[]) => void;
    existingPlanIds?: string[]; // To maybe disable already selected ones?
}

export const SelectWOModal = ({ isOpen, onClose, projectId, onConfirm, existingPlanIds = [] }: SelectWOModalProps) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedWOs, setSelectedWOs] = useState<Set<string>>(new Set());

    const { call: fetchWOs, result: woResult, loading } = useFrappePostCall<{ wos: GenericWO[] }>(
        "nirmaan_stack.api.seven_days_planning.cashflow_plan_api.get_all_project_wos"
    );

    useEffect(() => {
        if (isOpen && projectId) {
            fetchWOs({ project: projectId });
            setSelectedWOs(new Set());
            setSearchQuery("");
        }
    }, [isOpen, projectId]);

    const allWOs = woResult?.message?.wos || [];

    const filteredWOs = useMemo(() => {
        return allWOs.filter(wo => 
            wo.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
            wo.vendor_name?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [allWOs, searchQuery]);

    const toggleSelection = (woId: string) => {
        const next = new Set(selectedWOs);
        if (next.has(woId)) {
            next.delete(woId);
        } else {
            next.add(woId);
        }
        setSelectedWOs(next);
    };

    const handleConfirm = () => {
        const selectedObjects = allWOs.filter(wo => selectedWOs.has(wo.name));
        onConfirm(selectedObjects);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 md:p-6 border-b">
                    <DialogTitle>Select Work Orders</DialogTitle>
                    <p className="text-sm text-gray-500 mt-1">
                        Choose one or multiple work orders to create plan
                    </p>
                </DialogHeader>

                <div className="p-4 md:p-6 flex-1 overflow-hidden flex flex-col gap-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search by WO ID"
                            className="pl-9 bg-gray-50/50"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Table */}
                    <div className="border rounded-lg flex-1 overflow-auto">
                        <Table>
                            <TableHeader className="bg-gray-100 sticky top-0">
                                <TableRow>
                                    <TableHead className="w-[50px]">Select</TableHead>
                                    <TableHead>WO ID</TableHead>
                                    <TableHead>Vendor Name</TableHead>
                                    <TableHead className="text-right">Total (Incl.GST)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                                            Loading Work Orders...
                                        </TableCell>
                                    </TableRow>
                                ) : filteredWOs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                                            No Work Orders found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredWOs.map((wo) => (
                                        <TableRow key={wo.name} className="hover:bg-gray-50">
                                            <TableCell>
                                                <Checkbox
                                                    checked={selectedWOs.has(wo.name)}
                                                    onCheckedChange={() => toggleSelection(wo.name)}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium text-gray-900">{wo.name}</TableCell>
                                            <TableCell className="text-gray-600">{wo.vendor_name}</TableCell>
                                            <TableCell className="text-right font-medium">
                                                ₹ {wo.grand_total?.toLocaleString() ?? 0}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <DialogFooter className="p-4 border-t bg-gray-50">
                    <div className="flex w-full justify-end gap-2">
                        <Button variant="outline" onClick={onClose} className="bg-white">
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleConfirm}
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={selectedWOs.size === 0}
                        >
                            Confirm Selection
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

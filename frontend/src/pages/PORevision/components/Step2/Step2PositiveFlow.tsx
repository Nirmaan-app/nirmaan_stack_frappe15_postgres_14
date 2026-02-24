import React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Wallet, Trash2, CheckCircle2, Plus, Info } from "lucide-react";
import formatToIndianRupee from "@/utils/FormatPrice";
import { PaymentTerm, DifferenceData } from "../../types";

interface Step2PositiveFlowProps {
  paymentTerms: PaymentTerm[];
  setPaymentTerms: (terms: PaymentTerm[]) => void;
  difference: DifferenceData;
  poName: string;
}

export const Step2PositiveFlow: React.FC<Step2PositiveFlowProps> = ({
  paymentTerms,
  setPaymentTerms,
  difference,
  poName,
}) => {
  const totalAllocated = paymentTerms.reduce((s, t) => s + t.amount, 0);
  const remainingToAllocate = Math.abs(difference.inclGst) - totalAllocated;
  const isFullyAllocated = Math.abs(remainingToAllocate) < 1;

  return (
    <div className="space-y-6">
        {/* Main Amount Banner */}
        <div className="bg-blue-50/50 p-6 rounded-xl border border-blue-100 flex items-center justify-between relative overflow-hidden">
            <div className="flex items-center gap-6">
                <div className="h-14 w-14 rounded-2xl bg-white shadow-sm border border-blue-100 flex items-center justify-center">
                    <Wallet className="h-7 w-7 text-blue-600" />
                </div>
                <div>
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">ADDITIONAL PAYABLE AMOUNT</p>
                    <p className="text-3xl font-black text-gray-900 tracking-tight">
                        {formatToIndianRupee(Math.abs(difference.inclGst))}
                    </p>
                </div>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tight">{poName}</p>
                <Badge variant="secondary" className="bg-blue-100/50 text-blue-600 border-none font-bold text-[10px] px-3 py-1">
                    Awaiting Allocation
                </Badge>
            </div>
        </div>

        {/* Remaining Balance Banner */}
        <div className="bg-amber-50/80 p-4 rounded-xl border border-amber-100 flex items-center justify-between">
            <div className="flex items-center gap-3 pl-2">
                <div className="h-5 w-5 rounded-full bg-amber-100 flex items-center justify-center">
                    <Info className="h-3 w-3 text-amber-600" />
                </div>
                <p className="text-sm font-bold text-amber-800 tracking-tight">Remaining Balance to Allocate</p>
            </div>
            <p className="text-xl font-black text-amber-700 pr-4">
                {formatToIndianRupee(remainingToAllocate)}
            </p>
        </div>

        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-[14px] text-gray-800">Payment Rectification</h3>
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPaymentTerms([...paymentTerms, { id: Math.random().toString(), term: "", amount: 0 }])} 
                    className="text-blue-600 border-blue-200 hover:bg-blue-50 h-8 text-[11px] font-bold gap-2"
                >
                    <Plus className="h-3 w-3" /> Add Payment Term
                </Button>
            </div>
            
            <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                <Table>
                    <TableHeader className="bg-slate-50/50">
                        <TableRow className="h-10 hover:bg-transparent border-b border-slate-100">
                            <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-6">PAYMENT TERM DESCRIPTION</TableHead>
                            <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-[200px]">AMOUNT</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paymentTerms.map((term, index) => (
                            <TableRow key={term.id} className="h-14 border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">
                                <TableCell className="pl-6">
                                    <Input
                                        value={term.term}
                                        onChange={(e) => {
                                            const newTerms = [...paymentTerms];
                                            newTerms[index].term = e.target.value;
                                            setPaymentTerms(newTerms);
                                        }}
                                        placeholder="e.g., Final Milestone Payment"
                                        className="h-9 bg-white border-slate-100 text-xs font-semibold text-slate-700 rounded-lg px-4 focus:ring-blue-100 focus:border-blue-200"
                                    />
                                </TableCell>
                                <TableCell>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">₹</span>
                                        <Input
                                            type="number"
                                            value={term.amount || ""}
                                            onChange={(e) => {
                                                const newTerms = [...paymentTerms];
                                                newTerms[index].amount = parseFloat(e.target.value) || 0;
                                                setPaymentTerms(newTerms);
                                            }}
                                            className="h-9 pl-6 bg-white border-slate-100 text-xs font-bold text-slate-900 rounded-lg focus:ring-blue-100 focus:border-blue-200"
                                        />
                                    </div>
                                </TableCell>
                                <TableCell className="pr-4">
                                    {paymentTerms.length > 1 && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setPaymentTerms(paymentTerms.filter((t) => t.id !== term.id))}
                                            className="h-8 w-8 text-slate-300 hover:text-red-500 hover:bg-red-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                        <TableRow className="h-12 bg-slate-50/80">
                            <TableCell className="pl-6 font-black text-[10px] text-slate-400 uppercase tracking-widest">Total Allocated</TableCell>
                            <TableCell className="font-bold text-sm text-slate-900">
                                <div className="flex items-center justify-between pr-4">
                                    <span>{formatToIndianRupee(totalAllocated)}</span>
                                    {isFullyAllocated && (
                                        <Badge className="bg-green-100 text-green-700 border-none text-[10px] font-bold gap-1 px-2 py-1">
                                            <CheckCircle2 className="h-3 w-3" /> Fully Allocated
                                        </Badge>
                                    )}
                                </div>
                            </TableCell>
                            <TableCell />
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </div>
    </div>
  );
};

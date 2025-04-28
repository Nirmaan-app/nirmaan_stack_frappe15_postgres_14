import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ListChecks, MessageCircleMore, Trash } from 'lucide-react';
import { PRItem } from '../types';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"


interface RequestedItemTableProps {
    items: PRItem[];
    onAction: (item: PRItem) => void; // Opens the detailed action dialog
    onDelete: (item: PRItem) => void; // Directly rejects/deletes the request
    category: string
}

export const RequestedItemTable: React.FC<RequestedItemTableProps> = ({ items, onAction, onDelete, category }) => {
    return (
        <Table className="table-fixed">
            <TableHeader>
                <TableRow className="bg-yellow-100 hover:bg-yellow-100">
                    <TableHead className="w-[55%] text-xs h-8">{category}</TableHead>
                    <TableHead className="w-[15%] text-xs text-center h-8">Unit</TableHead>
                    <TableHead className="w-[15%] text-xs text-center h-8">Quantity</TableHead>
                    <TableHead className="w-[15%] text-xs text-center h-8">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.map((item) => (
                    <TableRow key={item.name} className="hover:bg-yellow-100/50">
                        <TableCell className="text-sm py-2 align-top">
                            {item.item}
                            {item.comment && (
                                <div className="flex items-start gap-1 mt-1 border border-gray-200 rounded p-1 text-xs text-muted-foreground max-w-md">
                                    <MessageCircleMore className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                    <span>{item.comment}</span>
                                </div>
                            )}
                            <p className="text-xs"><strong>make: {" "}</strong>{item?.make || "--"}</p>
                        </TableCell>
                        <TableCell className="text-sm text-center py-2 align-top">{item.unit}</TableCell>
                        <TableCell className="text-sm text-center py-2 align-top">{item.quantity}</TableCell>
                        <TableCell className="text-sm text-center py-2 align-top">
                            <div className='flex items-center justify-center gap-1'>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => onAction(item)}>
                                    <ListChecks className="w-4 h-4" />
                                    <span className="sr-only">Review/Approve Request</span>
                                </Button>

                                <AlertDialog>
                                     <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700">
                                             <Trash className="w-4 h-4" />
                                             <span className="sr-only">Reject Request</span>
                                         </Button>
                                     </AlertDialogTrigger>
                                     <AlertDialogContent>
                                         <AlertDialogHeader>
                                             <AlertDialogTitle>Reject Requested Product?</AlertDialogTitle>
                                             <AlertDialogDescription>
                                                 Are you sure you want to reject the request for product "{item.item}"? This will remove it from the PR permanently.
                                             </AlertDialogDescription>
                                         </AlertDialogHeader>
                                         <AlertDialogFooter>
                                             <AlertDialogCancel>Cancel</AlertDialogCancel>
                                             {/* Pass the specific item to onDelete */}
                                             <AlertDialogAction onClick={() => onDelete(item)} className='bg-destructive hover:bg-destructive/90'>
                                                 Confirm Rejection
                                             </AlertDialogAction>
                                         </AlertDialogFooter>
                                     </AlertDialogContent>
                                 </AlertDialog>

                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};
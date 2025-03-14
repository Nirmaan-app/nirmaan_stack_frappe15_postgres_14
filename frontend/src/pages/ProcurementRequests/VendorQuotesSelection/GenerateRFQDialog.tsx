import redlogo from "@/assets/red-logo.png";
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Category, ProcurementItem, ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';
import { Projects } from '@/types/NirmaanStack/Projects';
import { formatDate } from '@/utils/FormatDate';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { FolderPlus, MessageCircleMore } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';

interface GenerateRFQDialogProps {
    orderData: ProcurementRequest | undefined;
}

const GenerateRFQDialog: React.FC<GenerateRFQDialogProps> = ({ orderData }) => {
    const [open, setOpen] = useState(false);
    const [selectedItems, setSelectedItems] = useState<{ [category: string]: string[] }>({});
    const componentRef = useRef<HTMLDivElement>(null);

    const {data : procurement_project} = useFrappeGetDoc("Projects", orderData?.project)

    const handlePrint = useReactToPrint({
        content: () => componentRef.current,
        documentTitle: `RFQ_Preview`,
    });

    const handleItemSelection = (categoryName: string, itemName: string) => {
        setSelectedItems((prevSelected) => {
            const categoryItems = prevSelected[categoryName] || [];
            if (categoryItems.includes(itemName)) {
                return {
                    ...prevSelected,
                    [categoryName]: categoryItems.filter((item) => item !== itemName),
                };
            } else {
                return {
                    ...prevSelected,
                    [categoryName]: [...categoryItems, itemName],
                };
            }
        });
    };

    const handleCategorySelection = (categoryName: string, items: ProcurementItem[]) => {
        setSelectedItems((prevSelected) => {
            const categoryItemNames = items.map((item) => item.name);
            const categoryItems = prevSelected[categoryName] || [];
            const allSelected = categoryItemNames.every((itemName) => categoryItems.includes(itemName));

            if (allSelected) {
                return {
                    ...prevSelected,
                    [categoryName]: categoryItems.filter((itemName) => !categoryItemNames.includes(itemName)),
                };
            } else {
                return {
                    ...prevSelected,
                    [categoryName]: [...categoryItemNames],
                };
            }
        });
    };

    const handleSelectAll = () => {
        setSelectedItems((prevSelected) => {
            if (orderData?.category_list?.list) {
                const allSelected: { [category: string]: string[] } = {};
                orderData.category_list.list.forEach((category: Category) => {
                    const categoryItems = orderData?.procurement_list?.list?.filter((item) => item?.category === category.name);
                    allSelected[category.name] = categoryItems.map((item) => item.name);
                });
                const isAllSelected = Object.keys(prevSelected).length === Object.keys(allSelected).length &&
                    Object.keys(prevSelected).every(category =>
                        prevSelected[category].length === allSelected[category].length);
                if(isAllSelected){
                    return {};
                }
                return allSelected;
            }
            return {};
        });
    };

    const isItemSelected = (categoryName: string, itemName: string) => {
        return selectedItems[categoryName]?.includes(itemName) || false;
    };

    const isCategorySelected = (categoryName: string, items: ProcurementItem[]) => {
        return items.every((item) => isItemSelected(categoryName, item.name));
    };

    const getSelectedItemsArray = () => {
        return Object.values(selectedItems).flat();
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={"outline"} className="text-primary border-primary flex gap-1">
                    <FolderPlus className="w-4 h-4" />
                    Generate RFQ
                </Button>
            </DialogTrigger>
            <DialogContent className="overflow-auto">
                <DialogHeader>
                    <DialogTitle className='text-center text-primary'>Generate RFQ</DialogTitle>
                </DialogHeader>
                <DialogDescription>
                    Select items for generating the list.
                </DialogDescription>
                {orderData && (
                    <div className='space-y-6'>
                      <div className="flex items-center mb-4 pb-2">
                            <Checkbox
                                id={`select-all`}
                                checked={getSelectedItemsArray().length === orderData?.procurement_list?.list?.length}
                                onCheckedChange={handleSelectAll}
                            />
                            <Label htmlFor={`select-all`} className="ml-2 font-semibold">
                                {getSelectedItemsArray().length === orderData?.procurement_list?.list?.length ? 'Deselect All' : 'Select All'}
                            </Label>
                        </div>
                        {orderData?.category_list?.list?.map((category: Category) => {
                            const categoryItems = orderData?.procurement_list?.list?.filter((item) => item?.category === category.name);
                            return (
                                <div key={category.name}>
                                    <div className="flex items-center mb-4 border-b-2 pb-2">
                                        <Checkbox
                                            id={`category-${category.name}`}
                                            checked={isCategorySelected(category.name, categoryItems)}
                                            onCheckedChange={() => handleCategorySelection(category.name, categoryItems)}
                                        />
                                        <Label htmlFor={`category-${category.name}`} className="ml-2 font-semibold">
                                            {category.name}
                                        </Label>
                                    </div>
                                    <ul className="ml-4 space-y-2">
                                        {categoryItems.map((item: ProcurementItem) => (
                                            <li key={item.name} className="flex items-center border-b pb-2">
                                                <Checkbox
                                                    id={`item-${item.name}`}
                                                    checked={isItemSelected(category.name, item.name)}
                                                    onCheckedChange={() => handleItemSelection(category.name, item.name)}
                                                />
                                                <Label htmlFor={`item-${item.name}`} className="ml-2 font-light">
                                                    {item.item} ({item.quantity} {item.unit})
                                                </Label>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                        <div className='flex items-end justify-end gap-2'>
                          <DialogClose asChild>
                            <Button>Cancel</Button>
                          </DialogClose>
                        <Button onClick={handlePrint} disabled={getSelectedItemsArray().length === 0}>
                            Print RFQ
                        </Button>
                        </div>
                        <RFQPDf componentRef={componentRef} selectedItems={selectedItems} orderData={orderData} procurement_project={procurement_project} />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};


interface RFQPdfProps {
    componentRef: React.RefObject<HTMLDivElement>;
    selectedItems: { [category: string]: string[] };
    orderData: ProcurementRequest | undefined;
    procurement_project: Projects | undefined;
}

const RFQPDf : React.FC<RFQPdfProps> = ({ componentRef, selectedItems, orderData, procurement_project }) => {
    const [itemList, setItemList] = useState<ProcurementItem[] | null>(null);

    useEffect(() => {
        if (orderData) {
          const items : ProcurementItem[] = []
          Object.keys(selectedItems).forEach((category) => {
            const categoryItems = selectedItems[category];
            const categoryItemsForRFQ = orderData?.procurement_list?.list?.filter((item) => categoryItems.includes(item.name));
            items.push(...categoryItemsForRFQ);
          });
          setItemList(items);
        }
    }, [orderData, selectedItems]);
  return (
    <div className='hidden'>
    <div ref={componentRef} className="px-4 pb-4">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="w-full border-b border-black">
                                <tr>
                                    <th colSpan={5} className="p-0">
                                        <div className="mt-6 flex justify-between">
                                            <div>
                                                <img className="w-44" src={redlogo} alt="Nirmaan" />
                                                <div className="pt-2 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                            </div>
                                        </div>
                                    </th>
                                </tr>
                                <tr>
                                    <th colSpan={5} className="p-0">
                                        <div className="py-2 border-b-2 border-gray-600 pb-3 mb-3">
                                            <div className="flex justify-between">
                                                <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                                                <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                            </div>
                                        </div>
                                    </th>
                                </tr>
                                <tr>
                                    <th colSpan={5} className="p-0">
                                        <div className="grid grid-cols-2 justify-between border border-gray-100 rounded-lg p-4">
                                            <div className="border-0 flex flex-col">
                                                <p className="text-left py-1 font-medium text-xs text-gray-500">Date</p>
                                                <p className="text-left font-bold py-1 font-semibold text-sm text-black">{formatDate(procurement_project?.creation?.split(" ")[0])}</p>
                                            </div>
                                            <div className="border-0 flex flex-col ml-10">
                                                <p className="text-left py-1 font-medium text-xs text-gray-500">Project ID</p>
                                                <p className="text-left font-bold py-1 font-semibold text-sm text-black">{procurement_project?.name}</p>
                                            </div>
                                        </div>
                                    </th>
                                </tr>
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left font-bold text-gray-800 tracking-wider pr-32">Item</th>
                                    <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Category</th>
                                    <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Unit</th>
                                    <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Quantity</th>
                                    <th scope="col" className="px-2 py-1 text-left font-bold text-gray-800 tracking-wider">Rate</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {itemList?.map((i) => {
                                    return (
                                        <tr className="">
                                        <td className="px-6 py-2 text-sm">
                                            {i.item}
                                            {(i.comment) &&
                                                <div className="flex gap-1 items-start block p-1">
                                                    <MessageCircleMore className="w-4 h-4 flex-shrink-0" />
                                                    <div className="text-xs text-gray-400">{i.comment}</div>
                                                </div>
                                            }
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">
                                            {i.category}
                                        </td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{i.unit}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{i.quantity}</td>
                                        <td className="px-2 py-2 text-sm whitespace-nowrap">{ }</td>
                                    </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        <div className="pt-24">
                            <p className="text-md font-bold text-red-700 underline">Note</p>
                            <p className="text-xs">Please share the quotes as soon as possible</p>
                        </div>
                    </div>
      </div>
      </div>
  )
}

export default GenerateRFQDialog;
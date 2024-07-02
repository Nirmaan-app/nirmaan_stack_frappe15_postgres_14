import { useState } from "react";
import { Input } from "../ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "../ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "../ui/dialog";
import { Button } from "../ui/button";

interface CreateItemProps {
    handleAddItem: any,
}

export default function CreateItem({ handleAddItem }: CreateItemProps) {
    const [curItem, setCurItem] = useState<string>('')
    const [unit, setUnit] = useState<string>('')

    return (
        <>
            <div className="mb-4">
                <label htmlFor="itemName" className="block text-sm font-medium text-gray-700">Item Name</label>
                <Input
                    type="text"
                    id="itemName"
                    value={curItem}
                    onChange={(e) => setCurItem(e.target.value)}
                    className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>
            <div className="mb-4">
                <label htmlFor="itemUnit" className="block text-sm font-medium text-gray-700">Item Unit</label>
                <Select onValueChange={(value) => setUnit(value)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue className="text-gray-200" placeholder="Select Unit" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="PCS">PCS</SelectItem>
                        <SelectItem value="BOX">BOX</SelectItem>
                        <SelectItem value="ROLL">ROLL</SelectItem>
                        <SelectItem value="PKT">PKT</SelectItem>
                        <SelectItem value="MTR">MTR</SelectItem>
                        <SelectItem value="NOS">NOS</SelectItem>
                        <SelectItem value="KGS">KGS</SelectItem>
                        <SelectItem value="PAIRS">PAIRS</SelectItem>
                        <SelectItem value="PACKS">PACKS</SelectItem>
                        <SelectItem value="DRUM">DRUM</SelectItem>
                        <SelectItem value="COIL">COIL</SelectItem>
                        <SelectItem value="SQMTR">SQMTR</SelectItem>
                        <SelectItem value="LTR">LTR</SelectItem>
                        <SelectItem value="PAC">PAC</SelectItem>
                        <SelectItem value="BAG">BAG</SelectItem>
                        <SelectItem value="BUNDLE">BUNDLE</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <Dialog>
                <DialogTrigger asChild>
                    {(curItem && unit) ?
                        <Button className="fixed bottom-2 h-8 left-2 right-2 md:w-full bg-red-700 rounded-md text-sm text-white">Confirm and Submit</Button>
                        :
                        <Button disabled={true} variant="secondary" className="fixed bottom-2 h-8 left-2 right-2 md:w-full rounded-md text-sm">Confirm and Submit</Button>
                    }

                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Are you Sure</DialogTitle>
                        <DialogDescription>
                            Click on Confirm to create new Item.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogClose>
                        <Button variant="secondary" onClick={() => handleAddItem(curItem, unit)}>Confirm</Button>
                    </DialogClose>
                </DialogContent>
            </Dialog>
        </>
    )
}
import { useEffect, useState } from "react";
// import ItemSelect from "../custom-select/item-select";
import { Button } from "../ui/button";
// import useLowestQuote from "@/hooks/useLowestQuote";
import { useFrappeGetDocList } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { CirclePlus } from "lucide-react";

interface SelectOptions {
    value: string,
    label: string
}

interface AddItemProps {
    curCategory: string,
    // TS-RESOLVE
    handleCreateItem: any,
    handleAdd: any
}

export default function AddItem({ curCategory, handleCreateItem, handleAdd }: AddItemProps) {
    const [curItem, setCurItem] = useState<string | undefined>();
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');

    const { data: data, isLoading: loading, error: error } = useFrappeGetDocList("Items", {
        fields: ["name", "item_name", "category", "unit_name"],
        filters: [["category", "=", curCategory]]
    })

    const [options, setOptions] = useState<SelectOptions[]>([])

    useEffect(() => {
        if (data) {
            console.log("From Effect if data received", data)
            let currOptions = data?.map((item) => {
                console.log("From Loop:", item)
                return ({ value: item.name, label: item.item_name })
            })
            setOptions(currOptions);
            console.log(currOptions)
        }
        console.log(options)
    }, [data, curCategory])


    console.log("Fron Add Item:", curCategory)




    const handleAddItem = () => {
        if (curItem && quantity) {
            const newItem = {
                item: curItem,
                name: data?.find((item) => item.item_name === curItem).name,
                quantity: Number(quantity),
                unit: unit
            };
            handleAdd(newItem);
            setUnit('');
            setQuantity('');
        }
    };
    // TS-RESOLVE
    const handleChangeItem = (selectedItem: any) => {
        console.log('Selected item:', selectedItem);
        setCurItem(selectedItem.label)
        data?.map((item) => {
            if (item.item_name === selectedItem.label) {
                setUnit(item.unit_name)
            }
        })
    }

    if (loading) return <h1>Loading</h1>
    if (error) return <h1>{error.message}</h1>
    return (
        <>
            <h3 className="font-bold">{curCategory}</h3>
            <div className="flex space-x-2">
                <div className="w-1/2 md:w-2/3">
                    <h5 className="text-xs text-gray-400">Items</h5>
                    {/* <DropdownMenu items={item_lists} onSelect={handleSelect} /> */}
                    <ReactSelect options={options} onChange={handleChangeItem} ></ReactSelect>
                </div>
                <div className="flex-1">
                    <h5 className="text-xs text-gray-400">UOM</h5>
                    <input className="h-[37px] w-full" type="text" placeholder={unit || "Unit"} value={unit} />
                </div>
                <div className="flex-1">
                    <h5 className="text-xs text-gray-400">Qty</h5>
                    <input className="h-[37px] w-full border rounded-lg" onChange={(e) => setQuantity(e.target.value)} value={quantity} type="number" />
                </div>
            </div>
            <div className="flex justify-between  md:space-x-0 mt-2">
                <div><button className="text-sm py-2 md:text-lg text-blue-400 flex " onClick={() => handleCreateItem()}><CirclePlus className="w-5 h-5 mt- pr-1" />Create new item</button></div>
                {(curItem && quantity) ?
                    <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAddItem()}>Add</Button>
                    :
                    <Button disabled={true} variant="secondary" className="left-0 border rounded-lg py-1 border-red-500 px-8" >Add</Button>}
                {/* <Button variant="outline" className="left-0 border rounded-lg py-1 border-red-500 px-8" onClick={() => handleAdd()}>Add</Button> */}
            </div>
        </>
    )
}
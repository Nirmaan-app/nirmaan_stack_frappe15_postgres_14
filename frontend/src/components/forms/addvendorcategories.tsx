import {  useFrappeGetDocList, useFrappeUpdateDoc, useFrappeDocTypeEventListener, useSWRConfig, useFrappeGetDoc } from "frappe-react-sdk"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ButtonLoading } from "@/components/ui/button-loading"
import ReactSelect from 'react-select';
import { useEffect, useState } from "react"
import { SheetClose } from "../ui/sheet";
import { useToast } from "../ui/use-toast";
import { ListChecks } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

interface SelectOption {
    label: string;
    value: string;
}

export const AddVendorCategories = ({vendor_id, isSheet = false}) => {

    const {data, mutate: vendorMutate} = useFrappeGetDoc("Vendors", vendor_id)

    const service_categories = ["Electrical Services", "HVAC Services", "Data & Networking Services", "Fire Fighting Services", "FA Services", "PA Services", "Access Control Services", "CCTV Services", "Painting Services", "Carpentry Services", "POP Services"]

    const { data: vendor_category_list, isLoading: vendor_category_list_loading, mutate: vendor_category_mutate } = useFrappeGetDocList("Vendor Category",
        {
            fields: ["*"],
            filters: [["vendor", "=", vendor_id], ["category", "not in", service_categories]],
            limit: 1000
    });

    useFrappeDocTypeEventListener("Vendor Category", async () => {
        await vendor_category_mutate()
    })


    const {mutate} = useSWRConfig()
    const {toast} = useToast()
    const { data: category_list, isLoading: category_list_loading } = useFrappeGetDocList("Category",
        {
            fields: ['category_name', 'work_package'],
            filters:[["work_package", "!=", "Services"]],
            orderBy: { field: 'work_package', order: 'asc' },
            limit: 10000
        });

    const { updateDoc: updateDoc, loading: loading } = useFrappeUpdateDoc()

    async function onSubmit() {
        try {
            
            const selectedCategories = categories?.map(item => item.value) || []

            let category_json = selectedCategories

            if(data?.vendor_type === "Material & Service") {
                category_json = [...selectedCategories, ...service_categories]
            }
            
            await updateDoc('Vendors', `${data?.name}`, {
                vendor_category: { "categories": category_json },
            });
    
            toast({
                title: "Success",
                description: `Category(s) updated successfully`,
                variant: "success",
            });
    
            await vendorMutate();
            await vendor_category_mutate();
            await mutate("Material Vendors");
            await mutate("Vendor Category");
    
            document.getElementById("sheetCloseButton")?.click();
        } catch (error) {
            console.error(error);
    
            toast({
                title: "Failed",
                description: `Unable to update Categories, Please try again later!`,
                variant: "destructive",
            });
        }
    }
    

    const category_options: SelectOption[] = category_list
        ?.map(item => ({
            label: `${item.category_name}-(${item.work_package})`,
            value: item.category_name
        })) || [];

    const default_options: SelectOption[] = vendor_category_list
        ?.map(item => ({
            label: item.category,
            value: item.category
        })) || null;

    const [categories, setCategories] = useState(default_options)

    const handleChange = (selectedOptions) => {
        setCategories(selectedOptions)
        // console.log(categories)
    }

    if (
        vendor_category_list_loading ||
        category_list_loading
      )
        return (
          <div className="flex items-center h-[90vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
          </div>
        );

    return (
            <div className="p-4 flex flex-col gap-2">
                <div className="space-y-0.5">
                    <div className="flex space-x-2 items-center">
                        <h2 className="text-2xl font-bold tracking-tight">Edit Vendor Categories</h2>
                    </div>
                </div>
                        <Separator className="my-3" />
                        <div className="flex flex-col gap-2">
                            <label>Add Categories</label>
                            {(category_options.length > 0 && default_options) && <ReactSelect options={category_options} defaultValue={default_options ? default_options : []} onChange={handleChange} isMulti />}
                        </div>
                        <div className="flex justify-end w-full">
                        {(loading) ? (<ButtonLoading />) : (<Button onClick={onSubmit} className="flex items-center gap-1">
                            <ListChecks className="h-4 w-4" />
                            Update</Button>)}
                        </div>
                        {
                            isSheet && ( <SheetClose><button className="hidden" id="sheetCloseButton">close</button></SheetClose>)
                        }
            </div>
    )
}
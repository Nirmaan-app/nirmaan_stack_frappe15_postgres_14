import AddMakeComponent from "@/components/procurement-packages"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist"
import { Makelist } from "@/types/NirmaanStack/Makelist"
import { ProcurementItem, ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests"
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { ListChecks } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import ReactSelect, { components, StylesConfig, GroupBase, MenuListProps } from "react-select"

interface MakesSelectionProps {
  vendor: Vendor
  item: ProcurementItem
  formData: RFQData
  orderData: ProcurementRequest | SentBackCategory
  setFormData: React.Dispatch<React.SetStateAction<RFQData>>
  defaultMake?: string
}


export const MakesSelection : React.FC<MakesSelectionProps> = ({defaultMake, vendor, item, formData, orderData, setFormData }) => {

  const [showAlert, setShowAlert] = useState(false);
  const toggleShowAlert = () => {
    setShowAlert((prevState) => !prevState);
  };

//   const [makeOptions, setMakeOptions] = useState<{
//     label: string;
//     value: string;
// }[]>([]);

  // const [newSelectedMakes, setNewSelectedMakes] = useState([]);

  const { data: categoryMakeList, mutate: categoryMakeListMutate } = useFrappeGetDocList<CategoryMakelist>("Category Makelist", {
    fields: ["*"],
    filters: [["category", "=", item?.category]],
    limit: 100000,
  },
  item?.category ? `Category Makelist_${item?.category}` : null
)

  const { data: makeList, isLoading: makeListLoading, mutate: makeListMutate } = useFrappeGetDocList<Makelist>("Makelist", {
      fields: ["*"],
      limit: 100000,
    })

  const makeOptions: {label: string, value: string }[] = useMemo(() => categoryMakeList?.map((i) => ({ label: i?.make, value: i?.make })) || [], [categoryMakeList, item])

  // useEffect(() => {
  //   if ((categoryMakeList || [])?.length > 0) {
  //     const categoryMakes = categoryMakeList?.filter((i) => i?.category === item?.category);
  //     const makeOptionsList = categoryMakes?.map((i) => ({ label: i?.make, value: i?.make })) || [];
  //     // const filteredOptions = makeOptionsList?.filter(i => !formData?.details?.[item?.name]?.makes?.some(j => j === i?.value))
  //     // setMakeOptions(filteredOptions)
  //     setMakeOptions(makeOptionsList)
  //   }

  // }, [categoryMakeList, item, formData, orderData])

  // const editMakeOptions = formData?.details?.[item?.name]?.makes?.map((i) => ({
  //   value: i,
  //   label: i,
  // }));

  // const selectedMake = quotationData?.list
  //   ?.find((j) => j?.qr_id === q?.name)
  //   ?.makes?.find((m) => m?.enabled === "true");

  const selectedMakeName = useMemo(() => formData?.details?.[item?.name]?.vendorQuotes?.[vendor?.value]?.make || defaultMake, [item, vendor, formData, defaultMake]);

  const selectedVendorMake = useMemo(() => ({ value: selectedMakeName, label: selectedMakeName }), [selectedMakeName])
  // const selectedMakeValue = selectedMake
  //   ? { value: selectedMake?.make, label: selectedMake?.make }
  //   : selectedMakefromq
  //   ? { value: selectedMakefromq?.make, label: selectedMakefromq?.make }
  //   : null;

  const handleMakeChange = (make: {label: string, value: string}) => {
    setFormData((prev) => ({
      ...prev,
      details: {
        ...prev.details,
        [item?.name]: {
          ...prev.details[item?.name],
          vendorQuotes: {
            ...prev.details[item?.name].vendorQuotes,
            [vendor?.value]: { ...(prev.details[item?.name].vendorQuotes[vendor?.value] || {}), make: make.value },
          },
        },
      },
    }));
  }

  // const handleAddNewMakes = () => {
  //   const newMakes = newSelectedMakes?.map(i => i?.value)
  //   setFormData((prev) => ({
  //     ...prev,
  //     details: {
  //       ...prev.details,
  //       [item?.name]: {
  //         ...prev.details[item?.name],
  //        makes : [...prev.details[item?.name].makes, ...newMakes]
  //       },
  //     },
  //   }));

  //   setNewSelectedMakes([])
  //   toggleShowAlert()
  // }

  // Define the styles for the portal menu
const portalStyles: StylesConfig<any, false, GroupBase<any>> = { // Use appropriate types for your options
  menuPortal: base => ({
    ...base,
    zIndex: 9999 // A high z-index to ensure it's on top
  }),
  // You might need to style the menu itself if its default appearance changes slightly outside the original context
  menu: base => ({
    ...base,
    // Add any specific menu styling overrides if needed
  }),
  // Add other style overrides if necessary
};

  const CustomMenu = (props : MenuListProps) => {
    const { MenuList } = components;

    return (
      <MenuList {...props}>
        {props.children}
        <div
          className="p-2 bg-gray-100 hover:bg-gray-200 text-center cursor-pointer"
          onClick={() => toggleShowAlert()}
        >
          <strong>Create New Make</strong>
        </div>
      </MenuList>
    );
  };

  return (
    <>
    <div className="w-full">
      <ReactSelect
        className="w-full"
        placeholder="Select Make..."
        value={selectedVendorMake}
        // options={editMakeOptions}
        isLoading={makeListLoading}
        options={makeOptions}
        onChange={handleMakeChange}
        components={{ MenuList: CustomMenu }}
        menuPortalTarget={document.body}
        styles={portalStyles}
        menuPosition="fixed"
      />
    </div>

    <Dialog open={showAlert} onOpenChange={toggleShowAlert}>
      <DialogContent className="text-start">
        <DialogHeader>
          <DialogTitle>Add New Makes</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          <AddMakeComponent category={item?.category} categoryMakeListMutate={categoryMakeListMutate} makeList={makeList} makeListMutate={makeListMutate}
            handleMakeChange={handleMakeChange}
            toggleShowAlert={toggleShowAlert}
           />
        {/* <div className="flex gap-1 flex-wrap mb-4">
          {editMakeOptions?.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold">Existing Makes for this item:</h2>
              <div className="flex gap-1 flex-wrap">
              {editMakeOptions?.map((i) => (
                <Badge key={i?.value}>{i?.value}</Badge>
              ))}
              </div>
            </div>
          )}
        </div>
        <div className="mb-4">
          <Label>
            Select New Make
          </Label>
          {categoryMakeList && (
            <ReactSelect options={makeOptions} value={newSelectedMakes} isMulti onChange={(selectedOptions) => setNewSelectedMakes(selectedOptions)} />
          )}
        </div>
        <div className="flex justify-end gap-2 items-center">
            <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={handleAddNewMakes} disabled={!newSelectedMakes?.length} className="flex items-center gap-1">
            <ListChecks className="h-4 w-4" />
            Confirm
          </Button>
        </div> */}
        </DialogDescription>
      </DialogContent>
    </Dialog>
    </>
  );
};
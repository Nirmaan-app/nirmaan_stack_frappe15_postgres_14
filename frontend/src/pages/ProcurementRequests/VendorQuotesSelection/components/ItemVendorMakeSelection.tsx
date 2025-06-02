import AddMakeComponent from "@/components/procurement-packages"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist"
import { Makelist } from "@/types/NirmaanStack/Makelist"
import { ProcurementItem, RFQData } from "@/types/NirmaanStack/ProcurementRequests"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { useEffect, useMemo, useState } from "react"
import ReactSelect, { components, StylesConfig, GroupBase, MenuListProps } from "react-select"

interface MakesSelectionProps {
  vendor: Vendor
  item: ProcurementItem
  formData: RFQData
  setFormData: React.Dispatch<React.SetStateAction<RFQData>>
  defaultMake?: string
}


export const MakesSelection: React.FC<MakesSelectionProps> = ({ defaultMake, vendor, item, formData, setFormData }) => {

  const [showAlert, setShowAlert] = useState(false);
  const toggleShowAlert = () => {
    setShowAlert((prevState) => !prevState);
  };


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

  const makeOptions: { label: string, value: string }[] = useMemo(() => categoryMakeList?.map((i) => ({ label: i?.make, value: i?.make })) || [], [categoryMakeList, item])


  const selectedMakeName = useMemo(() => formData?.details?.[item?.name]?.vendorQuotes?.[vendor?.value]?.make || defaultMake, [item, vendor, formData, defaultMake]);

  const selectedVendorMake = useMemo(() => ({ value: selectedMakeName, label: selectedMakeName }), [selectedMakeName])

  const handleMakeChange = (make: { label: string, value: string }) => {
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

  useEffect(() => {
    if (defaultMake && !formData?.details?.[item?.name]?.vendorQuotes?.[vendor?.value]?.make) {
      handleMakeChange({ label: defaultMake, value: defaultMake });
    }
  }, [defaultMake, formData, item?.name, vendor?.value]);


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

  const CustomMenu = (props: MenuListProps) => {
    const { MenuList } = components;

    return (
      <MenuList {...props}>
        {props.children}
        <div
          // data-cy="create-new-make"
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
          data-cy="vendor-quote-make-selection"
        />
      </div>

      <Dialog open={showAlert} onOpenChange={toggleShowAlert}>
        <DialogContent className="text-start" data-cy="add-make-dialog">
          <DialogHeader>
            <DialogTitle data-cy="add-make-title">Add New Makes</DialogTitle>
          </DialogHeader>
          <DialogDescription data-cy="add-make-input">
            <AddMakeComponent category={item?.category} categoryMakeListMutate={categoryMakeListMutate} makeList={makeList} makeListMutate={makeListMutate}
              handleMakeChange={handleMakeChange}
              toggleShowAlert={toggleShowAlert}
            />
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
};
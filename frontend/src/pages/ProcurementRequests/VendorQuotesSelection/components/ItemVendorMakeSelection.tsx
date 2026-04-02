import AddMakeComponent from "@/components/procurement-packages"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useMakeOptions } from "@/hooks/useMakeOptions"
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"
import { Makelist } from "@/types/NirmaanStack/Makelist"
import { RFQData } from "@/types/NirmaanStack/ProcurementRequests"
import { ProjectWPCategoryMake } from "@/types/NirmaanStack/Projects"
import { useEffect, useMemo, useState } from "react"
import ReactSelect, { components, StylesConfig, GroupBase, MenuListProps } from "react-select"
import { ProgressItem } from "../types"

interface MakesSelectionProps {
  vendor: Vendor
  item: ProgressItem
  formData: RFQData
  setFormData: React.Dispatch<React.SetStateAction<RFQData>>
  defaultMake?: string
  projectWpCategoryMakes?: ProjectWPCategoryMake[]
  relevantPackages?: string[]
}


export const MakesSelection: React.FC<MakesSelectionProps> = ({ defaultMake, vendor, item, formData, setFormData, projectWpCategoryMakes, relevantPackages }) => {

  const [showAlert, setShowAlert] = useState(false);
  const toggleShowAlert = () => {
    setShowAlert((prevState) => !prevState);
  };

  const { makeOptions, isLoading, allMakeOptions, makeListMutate, categoryMakeListMutate } = useMakeOptions({
    categoryName: item?.category,
    projectWpCategoryMakes,
    relevantPackages: relevantPackages ?? [],
  });

  // Convert allMakeOptions to Makelist[] format for AddMakeComponent's duplicate check
  const makeListForAddComponent = useMemo<Makelist[]>(
    () => allMakeOptions.map((opt) => ({ name: opt.value } as Makelist)),
    [allMakeOptions]
  );

  const selectedMakeName = useMemo(() => formData?.details?.[item?.item_id]?.vendorQuotes?.[vendor?.value]?.make || defaultMake, [item, vendor, formData, defaultMake]);

  const selectedVendorMake = useMemo(() => {
    if (!selectedMakeName) return null;
    // Find the matching option to preserve its label (may include "(Project Makelist)" suffix)
    const matchingOption = makeOptions.find((opt) => opt.value === selectedMakeName);
    return matchingOption ?? { value: selectedMakeName, label: selectedMakeName };
  }, [selectedMakeName, makeOptions]);

  const handleMakeChange = (make: { label: string, value: string }) => {
    setFormData((prev) => ({
      ...prev,
      details: {
        ...prev.details,
        [item?.item_id]: {
          ...prev.details[item?.item_id],
          vendorQuotes: {
            ...prev.details[item?.item_id].vendorQuotes,
            [vendor?.value]: { ...(prev.details[item?.item_id].vendorQuotes[vendor?.value] || {}), make: make.value },
          },
        },
      },
    }));
  }

  useEffect(() => {
    if (defaultMake && !formData?.details?.[item?.item_id]?.vendorQuotes?.[vendor?.value]?.make) {
      handleMakeChange({ label: defaultMake, value: defaultMake });
    }
  }, [defaultMake, formData, item?.item_id, vendor?.value]);


  // Define the styles for the portal menu
  const portalStyles: StylesConfig<any, false, GroupBase<any>> = {
    menuPortal: base => ({
      ...base,
      zIndex: 9999
    }),
    menu: base => ({
      ...base,
    }),
  };

  const CustomMenu = (props: MenuListProps) => {
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
          isLoading={isLoading}
          options={makeOptions}
          onChange={(val: any) => val && handleMakeChange(val)}
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
            <AddMakeComponent category={item?.category} categoryMakeListMutate={categoryMakeListMutate} makeList={makeListForAddComponent} makeListMutate={makeListMutate}
              handleMakeChange={handleMakeChange}
              toggleShowAlert={toggleShowAlert}
            />
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
};

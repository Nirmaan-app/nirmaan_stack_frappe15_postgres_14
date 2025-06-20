import { useUserData } from "@/hooks/useUserData";
import WorkPackageSelect from "@/components/custom-select/work-package-select";//genral custom selecter
import CategorySelect from "@/components/custom-select/category-select";//genral custom selecter
import { useState, useEffect } from "react"; // 1. Import useEffect
import { App } from "antd";
import ApprovedQuotationsTable from "../ApprovedQuotationsFlow/ApprovedQuotationsTable";

export default function VendorsAQ2() {
  const userData = useUserData(); // Not used yet, but fine to have
  const [selectedWP, setSelectedWP] = useState<string | undefined>();
  const [selectedCat, setSelectedCat] = useState<string | undefined>();

  //  useEffect(() => {
  //     setSelectedWP(sessionStorage.getItem("selectedWP")||"");

  //   setSelectedCat(sessionStorage.getItem("selectedCat")||"");
  // }, []);

  // This effect ensures the category is cleared when the work package changes
  useEffect(() => {
    setSelectedCat(undefined);
    sessionStorage.removeItem("selectedCat");
  }, [selectedWP]); // Dependency: runs only when selectedWP changes

  const handleChangeWP = (selectedItem: { label: string; value: string } | null) => {
    const value = selectedItem ? selectedItem.value : undefined;
    setSelectedWP(value);

    if (value) {
      // Storing the raw string is simpler than stringifying it
        
      sessionStorage.setItem("selectedWP", JSON.stringify(value));
    } else {
      sessionStorage.removeItem("selectedWP");
    }
  };

  const handleCategoryClick = (selectedItem: { label: string; value: string } | null) => {
    // 2. CRITICAL FIX: Use setSelectedCat
    const value = selectedItem ? selectedItem.value : undefined;
    setSelectedCat(value);

    if (value) {
      sessionStorage.setItem("selectedCat", JSON.stringify(value));
    } else {
      sessionStorage.removeItem("selectedCat");
    }
  };

  return (
    <div className="flex-1 space-y-4 min-h-[50vh]">
      {/* // VendorsAQ2.tsx - Responsive Version */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 border border-gray-200 rounded-lg p-4">
        {/* On small screens, it spans all columns. On large screens (lg) and up, it spans 4. */}
        <div className="col-span-1 lg:col-span-4">
          <WorkPackageSelect onChange={handleChangeWP} />
        </div>

        <div className="col-span-1 lg:col-span-4">
          <CategorySelect
            key={selectedWP || 'no-wp'}
            workPackageFilter={selectedWP}
            onCategoryChange={handleCategoryClick}
          />
        </div>
      </div>

       <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 border border-gray-200 rounded-lg p-4 bg-gray-100">
        {/* On small screens, it spans all columns. On large screens (lg) and up, it spans 4. */}
        <div className="col-span-1 lg:col-span-4">
          <span>Selected Work Package: {selectedWP || "None"}</span>
        </div>

        <div className="col-span-1 lg:col-span-4">
         <span>Selected Category: {selectedCat || "None"}</span>
      </div>

      {/* You can add this for debugging to see the state */}
      </div>
      {/* {selectedWP&&(<ApprovedQuotationsTable  />)} */}
    </div>
  );
}
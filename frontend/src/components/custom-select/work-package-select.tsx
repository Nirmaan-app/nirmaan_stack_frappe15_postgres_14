
import { WorkPackages } from "@/types/NirmaanStack/WorkPackages";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import imageUrl from "@/assets/user-icon.jpeg"
import { useEffect, useMemo, useState } from "react";
import ReactSelect from "react-select";
//import useProcurementRequest from "@/states/procurement-request-state";
// import { useEffect, useState } from "react";
interface SelectOptions {
    value: string,
    label: string
}
interface WorkPackageSelectProps {
    // TS-RESOLVE
    universal?: boolean
    all?: boolean
    onChange: (selectedOption: SelectOptions | null) => void
}

export default function WorkPackageSelect({ onChange, universal = true, all = false }: WorkPackageSelectProps) {

    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList<WorkPackages>("Work Packages", {
        fields: ['work_package_name', "work_package_image"],
        orderBy: { field: 'work_package_name', order: 'asc' },
        limit: 1000
    });

    const [workPackage, setWorkPackage] = useState<SelectOptions | null>(null);

    useEffect(() => {
        if (wp_list && universal) {
            let currOptions = wp_list.map((item) => {
                return ({ value: item.work_package_name, label: item.work_package_name })
            })
            // Set initial selected option from sessionStorage
            const savedWorkPackage = sessionStorage.getItem('selectedWP');
            if (savedWorkPackage) {
                const initialOption = currOptions.find(option => option.value === savedWorkPackage);
                setWorkPackage(initialOption || null);
                if (initialOption) {
                    onChange(initialOption);
                }
            }
        }
    }, [wp_list, universal]);

    const handleChange = (workPackage: SelectOptions | null) => {
        setWorkPackage(workPackage);
        onChange(workPackage);
    };

    const options = useMemo(() => wp_list?.map((item) => ({
        value: item.work_package_name,
        label: item.work_package_name,
    })) || [], [wp_list]);


    if (wp_list_loading) return <h1>Loading</h1>;
    if (wp_list_error) return <h1>{wp_list_error.message}</h1>;
    return (
        <>
            <ReactSelect
                options={options}
                isLoading={wp_list_loading}
                value={workPackage}
                onChange={handleChange}
                placeholder="Select Work Package"
                isClearable
                onMenuOpen={() => handleChange(null)}
            ></ReactSelect>
            {/* {wp_list?.map((item) => (
                <Card key={item.name} className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center" onClick={() => { onChange(item.work_package_name, 'categorylist') }}>
                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.work_package_image === null ? imageUrl : item.work_package_image} alt="Project" />
                            <span>{item.work_package_name}</span>
                        </CardTitle>
                    </CardHeader>
                </Card>
            ))} */}
            {/* {console.log("ZUSTAND INITIAL:", orderDataZ.project)} */}
        </>
    )
}


// import { WorkPackages } from "@/types/NirmaanStack/WorkPackages";
// import { useFrappeGetDocList } from "frappe-react-sdk";
// import { Card, CardHeader, CardTitle } from "@/components/ui/card";
// import imageUrl from "@/assets/user-icon.jpeg"
// //import useProcurementRequest from "@/states/procurement-request-state";
// // import { useEffect, useState } from "react";

// interface WorkPackageSelectProps {
//     // TS-RESOLVE
//     handleWPClick: any
// }

// export default function WorkPackageSelect({ handleWPClick }: WorkPackageSelectProps) {

//     const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList<WorkPackages>("Work Packages", {
//         fields: ['work_package_name', "work_package_image"],
//         orderBy: { field: 'work_package_name', order: 'asc' },
//         limit: 1000
//     });

//     // const orderDataZ = useProcurementRequest(store => store);

//     // const [workPackage, setWorkPackage] = useState<string | undefined>();

//     // useEffect(() => {
//     //     if (workPackage) {
//     //         // TS-RESOLVE

//     //     }
//     // }, [workPackage])

//     if (wp_list_loading) return <h1>Loading</h1>;
//     if (wp_list_error) return <h1>{wp_list_error.message}</h1>;
//     return (
//         <>
//             {wp_list?.map((item) => (
//                 <Card key={item.name} className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center" onClick={() => { handleWPClick(item.work_package_name, 'categorylist') }}>
//                     <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
//                         <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
//                             <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.work_package_image === null ? imageUrl : item.work_package_image} alt="Project" />
//                             <span>{item.work_package_name}</span>
//                         </CardTitle>
//                     </CardHeader>
//                 </Card>
//             ))}
//             {/* {console.log("ZUSTAND INITIAL:", orderDataZ.project)} */}
//         </>
//     )
// }
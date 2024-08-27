// import { buildQueryString } from "@/utils/buildQueryString";
import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { useContext } from "react";

// const URL = "http://localhost:8000"
// const URL1 = "https://test.nirmaan.app"

// interface FetchDocListOptons {
//   doctype: string;
//   fields?: string[],
//   filters?: any[];
//   limit?: number;
// }

// export const fetchDocList = async ({doctype, fields = [], filters = [], limit = 1000} : FetchDocListOptons) => {

//     const queryParams = buildQueryString({
//         fields: JSON.stringify(fields.length > 0 ? fields : ["*"]),
//         filters: JSON.stringify(filters),
//         order_by: '',
//         limit,
//         as_dict: 'true'
//     });

//     const response = await fetch(`${URL}/api/resource/${doctype}?${queryParams}`, {
//       method: 'GET',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       credentials: 'include',
//     });
  
//     if (!response.ok) {
//       throw new Error('Network response was not ok');
//     }
  
//     const data = await response.json();
//     return data;
// };


// export const fetchDocCount = async (doctype: string) => {
//     const data = await fetchDocList({doctype});
//     return data.data?.length || 0;
// };


// interface FetchDocOptions {
//   doctype : string;
//   name: string | undefined;
// }

// export const fetchDoc = async ({doctype, name} : FetchDocOptions) => {
//   const response = await fetch(`${URL}/api/resource/${doctype}/${name}`, {
//     method: 'GET',
//     headers: {
//       'Content-Type': 'application/json',
//     },
//     credentials: 'include',
//   });

//   if (!response.ok) {
//     throw new Error('Network response was not ok');
//   }

//   const data = await response.json();
//   return data; 
// }


// export const exampleFunction = async (doctype : string, fields = ["*"], limit = 1000) => { 
//         const {db} = useContext(FrappeContext) as FrappeConfig
//         try {
//             const exampleData = await db.getDocList(doctype, {fields: fields, limit: limit});
//             return exampleData
//         } catch (error) {
//             console.error("Error fetching data:", error);
//         }
// };

// hooks/useExampleFunction.ts


const useCustomFetchHook = () => {
  
    const { db } = useContext(FrappeContext) as FrappeConfig;

    const fetchDocList = async (doctype: string, fields = ["*"], limit = 1000) => {
        try {
            const data = await db.getDocList(doctype, { fields: fields, limit: limit });
            return data;
        } catch (error) {
            console.error("Error fetching data:", error);
            throw error;
        }
    };


    const fetchDoc = async (doctype : string, name : string) => {
        try {
            const data = await db.getDoc(doctype, name);
            return data;
        } catch (error) {
            console.error("Error fetching doc: ", error)
            throw error;
        }
    }

    const fetchDocCount = async (doctype :string, filters = [], cache = true) => {
        try {
            const data = await db.getCount(doctype, filters, cache);
            return data;
        } catch (error) {
            console.error("Error fetching doc: ", error)
            throw error;
        }
    }

    return {fetchDocList, fetchDoc, fetchDocCount};
};

export default useCustomFetchHook;









  

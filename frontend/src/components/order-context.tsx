import React, { createContext, useState } from 'react';

interface OrderData {
    username: string;
    itemslist: [],
    projects: string;
    category: string;
    subcategory: string;
    createdAt: string;
}

interface OrderContextType {
    orderData: OrderData;
    addProject: (projectName: string) => void;
}
  
export const OrderContext = createContext<OrderContextType>({
  orderData: {
    username:'',
    itemslist:[],
    projects: '',
    category: '',
    subcategory: '',
    createdAt: ''
  },
  addProject: (project: string) => {},
  addCategory: (category: string) => {},
  addSubcategory: (subcategory: string) => {},
});

// const OrderContextProvider = ({ children }) => {
//   const [orderData, setOrderData] = useState<OrderData>({
//     projects: '',
//     category: '',
//     subcategory: ''
//   });

//   const addProject = (projectName: string) => {
//     setOrderData(prevData => ({
//       ...prevData,
//       projects: projectName
//     }));
//   };

//   return (
//   );
// };

export const useOrder = () => {
  return useContext(OrderContext)
}
export const OrderContextProvider = OrderContext.Provider

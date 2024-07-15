import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeCreateDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import React, { useState, useEffect } from "react";
import { MainLayout } from '@/components/layout/main-layout';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetClose
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose
} from "@/components/ui/dialog"
import { TrendingDown, CheckCheck, TrendingUp } from 'lucide-react';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Table as ReactTable } from "@/components/ui/table";
import { Space, Switch, Table, ConfigProvider } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { ItemComponent } from './items';

type TableRowSelection<T> = TableProps<T>['rowSelection'];

interface DataType {
    key: React.ReactNode;
    category: string;
    item: string;
    unit: string;
    quantity: number;
    rate: number;
    selectedVendor: string;
    amount: number;
    lowest2: string;
    lowest3: string;
    children?: DataType[];
}

const columns: TableColumnsType<DataType> = [
    {
        title: 'Items',
        dataIndex: 'item',
        key: 'item'
    },
    {
        title: 'Unit',
        dataIndex: 'unit',
        key: 'unit',
        width: '7%',
    },
    {
        title: 'Quantity',
        dataIndex: 'quantity',
        width: '7%',
        key: 'quantity',
    },
    {
        title: 'Rate',
        dataIndex: 'rate',
        width: '7%',
        key: 'rate',
    },
    {
        title: 'Selected Vendor',
        dataIndex: 'selectedVendor',
        width: '15%',
        key: 'selectedVendor',
    },
    {
        title: 'Amount',
        dataIndex: 'amount',
        width: '9%',
        key: 'amount',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text}
            </span>
        ),
    },
    {
        title: 'Lowest Quoted Amount',
        dataIndex: 'lowest2',
        width: '10%',
        key: 'lowest2',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text}
            </span>
        ),
    },
    {
        title: '3 months Lowest Amount',
        dataIndex: 'lowest3',
        width: '10%',
        key: 'lowest3',
        render: (text, record) => (
            <span style={{ fontWeight: record.unit === null ? 'bold' : 'normal' }}>
                {text}
            </span>
        ),
    },
];


export const ApproveVendor = () => {
    const { orderId } = useParams<{ orderId: string }>()
    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'category_list', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'creation'],
            filters: [['name', '=', orderId]],
            limit: 100
        });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Items",
        {
            fields: ['name', 'item_name', 'unit_name'],
            limit: 1000
        });
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList("Vendors",
        {
            fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst'],
            limit: 1000
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name', 'project_address', 'procurement_lead']
        });
    const { data: quotation_request_list, isLoading: quotation_request_list_loading, error: quotation_request_list_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time', 'quantity'],
            filters: [["status", "=", "Selected"], ["procurement_task", "=", orderId]],
            limit: 1000
        });
    const { data: quotation_request_list2, isLoading: quotation_request_list2_loading, error: quotation_request_list2_error } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['name', 'item', 'category', 'vendor', 'procurement_task', 'quote', 'lead_time', 'quantity'],
            filters: [["procurement_task", "=", orderId]],
            limit: 1000
        });
    const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
        {
            fields: ['item', 'quote'],
            limit: 1000
        });

    const [page, setPage] = useState<string>('approvequotation')
    const [orderData, setOrderData] = useState({
        project: '',
        work_package: '',
        procurement_list: {
            list: []
        },
        category_list: {
            list: []
        }
    })

    const [data, setData] = useState<DataType>([])
    const [checkStrictly, setCheckStrictly] = useState(false);

    useEffect(() => {
        const foundItem = procurement_request_list?.find(item => item.name === orderId);
        if (foundItem && !orderData.project) {
            setOrderData(foundItem)
        }
    }, [procurement_request_list]);

    const [selectedVendors, setSelectedVendors] = useState({})
    const [comment, setComment] = useState('')
    const [selectedItem, setSelectedItem] = useState({
        list: []
    })
    const [selectAll, setSelectAll] = useState(false);
    const total_categories = procurement_request_list?.find(item => item.name === orderId)?.category_list.list.length;

    const getVendorName = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_name;
    }
    const getVendorAddress = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_address;
    }
    const getVendorGST = (vendorName: string) => {
        return vendor_list?.find(vendor => vendor.name === vendorName)?.vendor_gst;
    }
    const getProjectName = (projectName: string) => {
        return project_list?.find(project => project.name === projectName)?.project_name;
    }
    const getProjectAddress = (projectName: string) => {
        return project_list?.find(project => project.name === projectName)?.project_address;
    }
    const getItem = (item: string) => {
        const item_name = item_list?.find(value => value.name === item)?.item_name;
        return item_name
    }
    const getUnit = (item: string) => {
        const item_unit = item_list?.find(value => value.name === item)?.unit_name;
        return item_unit
    }

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()
    const handleCheckboxChange = (id: string) => {
        const isSelected = selectedItem.list.some(item => item.name === id);
        const updatedSelectedList = isSelected
            ? selectedItem.list.filter(item => item.name !== id)
            : [...selectedItem.list, orderData.procurement_list?.list.find(item => item.name === id)];

        setSelectedItem({ list: updatedSelectedList });
    };

    const handleSelectAllChange = () => {
        const newSelectAll = !selectAll;
        setSelectAll(newSelectAll);

        const updatedSelectedList = newSelectAll
            ? orderData.procurement_list?.list.filter(item => selectedVendors[item.name])
            : [];
        setSelectedItem({ list: updatedSelectedList });
        console.log("selectedItem", updatedSelectedList)
    };

    const handleTrigger = () => {
        setSelectAll(false);
        setSelectedItem({ list: [] });
        setComment('');
    }
    const [approvedItems, setApprovedItems] = useState({
        list: []
    })

    useEffect(() => {
        const newCategories = [];
        orderData.procurement_list.list.map((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({ name: item.category })
            }
        })
        setOrderData((prevState) => ({
            ...prevState,
            category_list: {
                list: newCategories
            },
        }));
    }, [orderData.procurement_list]);

    useEffect(() => {

        if (orderData.project && Object.keys(selectedVendors).length > 0) {
            let allChecked = true;
            orderData.procurement_list?.list.forEach((item) => {
                if(selectedVendors[item.name]){
                    allChecked=false;
                }
            })
            if(allChecked){

                updateDoc('Procurement Requests', orderId, {
                    workflow_state: "Vendor Approved",
                })
                    .then(() => {
                        console.log("item", orderId)
                        navigate("/")
                    }).catch(() => {
                        console.log("update_submit_error", update_submit_error)
                    })
            }
        }
    }, [orderData, selectedVendors]);

    useEffect(() => {
        if (orderData.project) {
            const newData: DataType[] = [];
            orderData.category_list?.list.forEach((cat) => {
                const items: DataType[] = [];

                orderData.procurement_list?.list.forEach((item) => {
                    if (item.category === cat.name) {
                        if (selectedVendors[item.name]) {
                            const price = Number(getPrice(selectedVendors[item.name], item.name))
                            const quotesForItem = quote_data
                                ?.filter(value => value.item === item.name && value.quote)
                                ?.map(value => value.quote);
                            let minQuote;
                            if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                            minQuote = (minQuote ? parseFloat(minQuote) * item.quantity : 0)

                            items.push({
                                item: <ItemComponent item_id={item.name} />,
                                key: item.name,
                                unit: item.unit,
                                quantity: item.quantity,
                                category: item.category,
                                rate: price,
                                amount: price * item.quantity,
                                selectedVendor: getVendorName(selectedVendors[item.name]),
                                lowest2: getLowest2(item.name) * item.quantity,
                                lowest3: minQuote ? minQuote : "N/A",
                            });
                        }
                    }
                });
                // console.log("items",items)

                if (items.length) {
                    const node: DataType = {
                        item: cat.name,
                        key: cat.name,
                        unit: null,
                        quantity: null,
                        amount: getTotal(cat.name),
                        lowest2: getLowest(cat.name).quote,
                        lowest3: getLowest3(cat.name),
                        children: items,
                    };
                    newData.push(node);
                }
            });
            setData(newData)
        }
    }, [orderData, selectedVendors, vendor_list, quote_data, quotation_request_list2]);

    const [selectedItems, setSelectedItems] = useState()

    const rowSelection: TableRowSelection<DataType> = {
        onChange: (selectedRowKeys, selectedRows) => {
            console.log("onChange")
            console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
            setSelectedItems(selectedRows)
        },
        onSelect: (record, selected, selectedRows) => {
            console.log(record, selected, selectedRows);
        },
        onSelectAll: (selected, selectedRows, changeRows) => {
            console.log(selected, selectedRows, changeRows);
        },
    };

    const newHandleApprove = () => {

        // TODO: Add Quotation request state change to approved 

        const filteredData = selectedItems?.filter(item => {
            return item.unit !== null && item.quantity !== null
        });

        const vendorItems = {};
        filteredData?.forEach((item) => {
            if (selectedVendors[item.key]) {
                if (!vendorItems[selectedVendors[item.key]]) {
                    vendorItems[selectedVendors[item.key]] = [];
                }
                const price = Number(getPrice(selectedVendors[item.key], item.key))
                vendorItems[selectedVendors[item.key]].push({
                    name: item.key,
                    quote: price,
                    quantity: item.quantity,
                    unit: item.unit,
                    item: item.item
                });
            }

        })

        const createDocPromises = [];

        Object.entries(vendorItems).forEach(([key, value]) => {

            const newProcurementOrder = {
                procurement_request: orderId,
                project: orderData.project,
                project_name: getProjectName(orderData.project),
                project_address: getProjectAddress(orderData.project),
                vendor: key,
                vendor_name: getVendorName(key),
                vendor_address: getVendorAddress(key),
                vendor_gst: getVendorGST(key),
                order_list: {
                    list: value
                }
            };

            if (value?.length > 0) {
                const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                    .then(() => {
                        console.log(newProcurementOrder);
                    })
                    .catch((error) => {
                        console.log("submit_error", error);
                    });

                createDocPromises.push(createDocPromise);
            }

        });

        const filteredList = orderData.procurement_list?.list.filter(procItem =>
            !filteredData.some(selItem => selItem.key === procItem.name)
        );

        setOrderData(prevOrderData => ({
            ...prevOrderData,
            procurement_list: {
                list: filteredList
            }
        }));
    }

    const newHandleSentBack = () => {
        const filteredData = selectedItems?.filter(item => {
            return item.unit !== null && item.quantity !== null
        });

        const itemlist = [];
        filteredData.map((value) => {
            const price = getPrice(selectedVendors[value.key], value.key);
            itemlist.push({
                name: value.key,
                item: value.item,
                quantity: value.quantity,
                quote: price,
                unit: value.unit,
                category: value.category
            })
        })

        const newCategories = [];
        itemlist.forEach((item) => {
            const isDuplicate = newCategories.some(category => category.name === item.category);
            if (!isDuplicate) {
                newCategories.push({ name: item.category })
            }
        })

        const newSendBack = {
            procurement_request: orderId,
            project: orderData.project,
            category_list: {
                list: newCategories
            },
            item_list: {
                list: itemlist
            },
            comments: comment,
            type: "Rejected"
        }
        if (itemlist.length > 0) {
            createDoc('Sent Back Category', newSendBack)
                .then(() => {
                    console.log(newSendBack);
                    setComment('')
                })
                .catch(() => {
                    console.log("submit_error", submit_error);
                })
        }

        const filteredList = orderData.procurement_list?.list.filter(procItem =>
            !filteredData.some(selItem => selItem.key === procItem.name)
        );

        setOrderData(prevOrderData => ({
            ...prevOrderData,
            procurement_list: {
                list: filteredList
            }
        }));
    }

    const handleSendBack = (cat: string) => {
        const itemlist = [];
        selectedItem.list.map((value) => {
            if (value.category === cat) {
                const price = getPrice(selectedVendors[value.name], value.name);
                itemlist.push({
                    name: value.name,
                    item: value.item,
                    quantity: value.quantity,
                    quote: price,
                    unit: value.unit
                })
            }
        })
        const delivery_time = quotation_request_list?.find(item => item.category === cat)?.lead_time;
        const newSendBack = {
            procurement_request: orderId,
            project_name: orderData.project,
            category: cat,
            item_list: {
                list: itemlist
            },
            lead_time: delivery_time,
            comments: comment,
            type: "Rejected"
        }
        if (itemlist.length > 0) {
            createDoc('Sent Back Category', newSendBack)
                .then(() => {
                    console.log(newSendBack);
                    setComment('')
                })
                .catch(() => {
                    console.log("submit_error", submit_error);
                })
        }
        updateDoc('Procurement Requests', orderId, {
            workflow_state: "Partially Approved"
        })
            .then(() => {
                console.log("item", orderId)
                setOrderData((prevState) => {
                    const newCategoryList = prevState.category_list.list.filter(
                        (category) => category.name !== cat
                    );
                    return {
                        ...prevState,
                        category_list: {
                            ...prevState.category_list,
                            list: newCategoryList
                        }
                    };
                });
            }).catch(() => {
                console.log("update_submit_error", update_submit_error)
            })

        const newItems = approvedItems.list;
        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat) {
                const isPresent = selectedItem.list.find(value => value.name === item.name)
                if (!isPresent && selectedVendors[item.name]) {

                    const price = getPrice(selectedVendors[item.name], item.name);
                    newItems.push({
                        item: item.item,
                        name: item.name,
                        quote: price,
                        quantity: item.quantity,
                        unit: item.unit
                    })
                }
            }
        })
        setApprovedItems({
            list: newItems
        })
    }


    const handleRejectAll = () => {
        const createDocPromises = [];

        orderData.category_list.list.forEach((cat) => {
            const itemlist = [];
            const curCategory = cat.name;

            orderData.procurement_list.list.forEach((value) => {
                if (value.category === curCategory && selectedVendors[value.name]) {
                    const price = getPrice(selectedVendors[curCategory], value.name);
                    itemlist.push({
                        name: value.name,
                        item: value.item,
                        quantity: value.quantity,
                        quote: price,
                        unit: value.unit
                    });
                }
            });

            const delivery_time = quotation_request_list?.find(item => item.category === curCategory)?.lead_time;
            const newSendBack = {
                procurement_request: orderId,
                project_name: orderData.project,
                category: curCategory,
                vendor: selectedVendors[curCategory],
                item_list: {
                    list: itemlist
                },
                lead_time: delivery_time,
                comments: comment
            };

            const createDocPromise = createDoc('Sent Back Category', newSendBack)
                .then(() => {
                    console.log(newSendBack);
                    setComment('');
                })
                .catch((error) => {
                    console.log("submit_error", error);
                });

            createDocPromises.push(createDocPromise);

            setOrderData((prevState) => {
                const newCategoryList = prevState.category_list.list.filter(
                    (category) => category.name !== curCategory
                );
                return {
                    ...prevState,
                    category_list: {
                        ...prevState.category_list,
                        list: newCategoryList
                    }
                };
            });
        });

        Promise.all(createDocPromises)
            .then(() => {
                return updateDoc('Procurement Requests', orderId, {
                    workflow_state: "Partially Approved"
                });
            })
            .then(() => {
                console.log("item", orderId);
                navigate("/");
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    };


    const handleApproveAll = () => {

        const vendorItems = {};
        orderData.procurement_list?.list.map((item) => {
            if (selectedVendors[item.name]) {
                if (!vendorItems[selectedVendors[item.name]]) {
                    vendorItems[selectedVendors[item.name]] = [];
                }
                const price = Number(getPrice(selectedVendors[item.name], item.name))
                vendorItems[selectedVendors[item.name]].push({
                    name: item.name,
                    quote: price,
                    quantity: item.quantity,
                    unit: item.unit,
                    item: item.item
                });
            }

        })

        const createDocPromises = [];

        Object.entries(vendorItems).forEach(([key, value]) => {

            const newProcurementOrder = {
                procurement_request: orderId,
                project: orderData.project,
                project_name: getProjectName(orderData.project),
                project_address: getProjectAddress(orderData.project),
                vendor: key,
                vendor_name: getVendorName(key),
                vendor_address: getVendorAddress(key),
                vendor_gst: getVendorGST(key),
                order_list: {
                    list: value
                }
            };

            if (value?.length > 0) {
                const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                    .then(() => {
                        console.log(newProcurementOrder);
                    })
                    .catch((error) => {
                        console.log("submit_error", error);
                    });

                createDocPromises.push(createDocPromise);
            }
        });

        Promise.all(createDocPromises)
            .then(() => {
                return updateDoc('Procurement Requests', orderId, {
                    workflow_state: "Vendor Approved"
                });
            })
            .then(() => {
                console.log("item", orderId);
                navigate("/");
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    };


    const handleApprove = (cat: string) => {
        const newItems = approvedItems.list;
        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat) {
                if (selectedVendors[item.name]) {
                    const price = getPrice(selectedVendors[item.name], item.name);
                    newItems.push({
                        item: item.item,
                        name: item.name,
                        quote: price,
                        quantity: item.quantity,
                        unit: item.unit
                    })
                }
            }
        })
        setApprovedItems({
            list: newItems
        })

        setOrderData((prevState) => {
            const newCategoryList = prevState.category_list.list.filter(
                (category) => category.name !== cat
            );
            return {
                ...prevState,
                category_list: {
                    ...prevState.category_list,
                    list: newCategoryList
                }
            };
        });
    }

    const handleDone = () => {
        const vendorItems = {};
        approvedItems.list.map((item) => {
            if (selectedVendors[item.name]) {
                if (!vendorItems[selectedVendors[item.name]]) {
                    vendorItems[selectedVendors[item.name]] = [];
                }
                const price = Number(getPrice(selectedVendors[item.name], item.name))
                vendorItems[selectedVendors[item.name]].push({
                    name: item.name,
                    quote: price,
                    quantity: item.quantity,
                    unit: item.unit,
                    item: item.item
                });
            }

        })

        const createDocPromises = [];

        Object.entries(vendorItems).forEach(([key, value]) => {

            const newProcurementOrder = {
                procurement_request: orderId,
                project: orderData.project,
                project_name: getProjectName(orderData.project),
                project_address: getProjectAddress(orderData.project),
                vendor: key,
                vendor_name: getVendorName(key),
                vendor_address: getVendorAddress(key),
                vendor_gst: getVendorGST(key),
                order_list: {
                    list: value
                }
            };

            if (value?.length > 0) {
                const createDocPromise = createDoc('Procurement Orders', newProcurementOrder)
                    .then(() => {
                        console.log(newProcurementOrder);
                    })
                    .catch((error) => {
                        console.log("submit_error", error);
                    });

                createDocPromises.push(createDocPromise);
            }
        });

        Promise.all(createDocPromises)
            .then(() => {
                return updateDoc('Procurement Requests', orderId, {
                    workflow_state: "Partially Approved"
                });
            })
            .then(() => {
                console.log("item", orderId);
                navigate("/");
            })
            .catch((error) => {
                console.log("update_submit_error", error);
            });
    }

    const generateVendorItemKey = (vendor: string, item: string): string => {
        return `${vendor}-${item}`;
    };
    const [priceMap, setPriceMap] = useState(new Map<string, string>());

    const getPrice = (vendor: string, item: string): string | undefined => {
        const key = generateVendorItemKey(vendor, item);
        return priceMap.get(key);
    };
    useEffect(() => {
        const newPriceMap = new Map<string, string>();
        quotation_request_list?.forEach((item) => {
            const key = generateVendorItemKey(item.vendor, item.item);
            newPriceMap.set(key, item.quote);
        });
        setPriceMap(newPriceMap);
    }, [quotation_request_list]);
    useEffect(() => {
        let updatedVendors = { ...selectedVendors };
        quotation_request_list?.forEach((item) => {
            const curVendor = item.vendor;
            updatedVendors[item.item] = curVendor;
        });
        setSelectedVendors(updatedVendors);
    }, [quotation_request_list]);
    const getTotal = (cat: string) => {
        let total: number = 0;
        orderData?.procurement_list.list.map((item) => {
            if (item.category === cat) {
                const price = getPrice(selectedVendors[item.name], item.name);
                total += (price ? parseFloat(price) : 0) * item.quantity;
            }
        })
        return total
    }

    const [selectedCategories, setSelectedCategories] = useState({})

    useEffect(() => {
        const updatedCategories = { ...selectedCategories };
        orderData?.category_list.list.map((cat) => {
            const newVendorsSet = new Set();
            const curCategory = cat.name
            quotation_request_list2?.forEach((item) => {
                if (item.category === cat.name) {
                    if (!Array.isArray(updatedCategories[curCategory])) {
                        updatedCategories[curCategory] = [];
                    }
                    newVendorsSet.add(item.vendor);
                }
            });
            const newVendors = Array.from(newVendorsSet);
            updatedCategories[curCategory] = newVendors;
        })
        setSelectedCategories(updatedCategories);
    }, [quotation_request_list2, orderData]);

    const getLowest = (cat: string) => {
        let price: number = 0;
        let vendor: string = 'vendor';

        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat && selectedVendors[item.name]) {
                const quotesForItem = quotation_request_list2
                    ?.filter(value => value.item === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                price += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })

        return { quote: price, vendor: vendor }
    }

    const getLowest2 = (item: string) => {
        const quotesForItem = quotation_request_list2
            ?.filter(value => value.item === item && value.quote)
            ?.map(value => value.quote);
        let minQuote;
        if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
        return minQuote;
    }

    const getLowest3 = (cat: string) => {
        let total: number = 0;
        orderData.procurement_list?.list.map((item) => {
            if (item.category === cat && selectedVendors[item.name]) {
                const quotesForItem = quote_data
                    ?.filter(value => value.item === item.name && value.quote)
                    ?.map(value => value.quote);
                let minQuote;
                if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
                total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
            }
        })
        return total;
    }

    const isDelayed = (cat: string) => {
        let isPresent = false;
        orderData.procurement_list?.list.forEach((item)=>{
            if(item.category === cat){
                if(!selectedVendors[item.name]){
                    isPresent = true;
                } 
            }
        })
        return isPresent
    }

    const getPercentdiff = (a: number, b: number) => {
        if (a === 0 && b === 0) {
            return 0;
        }
        const difference: number = Math.abs(a - b);
        const percentDiff: number = (difference / a) * 100;

        return percentDiff.toFixed(2);
    }

    return (
        <MainLayout>
            {page == 'approvequotation' && <div className="flex" >
                <div className="flex-1 space-x-2 md:space-y-4 p-2 md:p-6 pt-6">
                    <div className="flex items-center pt-1  pb-4">
                        <ArrowLeft onClick={() => navigate("/approve-vendor")} />
                        <h2 className="text-base pl-2 font-bold tracking-tight">Comparison</h2>
                    </div>
                    <Card className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Date</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.creation?.split(" ")[0]}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Project</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.project}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Package</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.work_package}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">Project Lead</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.owner}</p>
                        </div>
                        <div className="border-0 flex flex-col items-center justify-center">
                            <p className="text-left py-1 font-semibold text-sm text-gray-300">PR Number</p>
                            <p className="text-left font-bold py-1 font-bold text-base text-black">{orderData?.name?.slice(-4)}</p>
                        </div>
                    </Card>
                    {(orderData.project && orderData.category_list?.list.length === 0) && <div className="text-red-500 text-center text-2xl font-bold">All Done !!!</div>}
                    {/* {orderData?.category_list?.list.map((cat) => {
                        const curCategory = cat.name
                        const lowest = getLowest(cat.name);
                        let total: number = 0;
                        let count: number = 0;
                        return <div className="grid grid-cols-2 gap-4 w-full">
                            <div className="col-span-2 font-bold text-xl py-2">{cat.name} </div>
                            <Card className="flex w-full shadow-none border border-grey-500" >
                                <CardHeader className="w-full">
                                    <CardTitle>
                                        <div className="flex justify-between border-b">
                                            <div className="font-bold text-lg py-2 border-gray-200">Total</div>
                                            <div className="font-bold text-2xl text-red-500 py-2 border-gray-200">{getTotal(curCategory)}</div>
                                        </div>
                                    </CardTitle>
                                    {orderData?.procurement_list.list.map((item) => {
                                        const price = getPrice(selectedVendors[item.name], item.name);
                                        total += (price ? parseFloat(price) : 0) * (parseFloat(item.quantity));

                                        if (item.category === curCategory) {
                                            if (count >= 2) {
                                                return
                                            }
                                            count++;
                                            return <div className="flex justify-between py-2">
                                                <div className="text-sm">{item.item}</div>
                                                <div className="text-sm">{price ? price * (item.quantity) : "Delayed"}</div>
                                            </div>
                                        }
                                    })}
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <div className="text-sm text-blue-500 cursor-pointer">View All</div>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-[425px] md:max-w-[825px]">
                                            <DialogHeader>
                                                <DialogTitle>Items List</DialogTitle>
                                                <DialogDescription>
                                                    <div className="grid grid-cols-12 font-medium text-black justify-between">
                                                        <div className="text-sm col-span-2 border p-2">Items</div>
                                                        <div className="text-sm border p-2">Unit</div>
                                                        <div className="text-sm border p-2">Qty</div>
                                                        <div className="text-sm border p-2">Rate</div>
                                                        <div className="text-sm border p-2">Amount</div>
                                                        <div className="text-sm col-span-2 border p-2">Selected Vendor</div>
                                                        <div className="text-sm col-span-2 border p-2">Lowest Quoted Vendor</div>
                                                        <div className="text-sm col-span-2 border p-2">3 months Lowest Amount</div>
                                                    </div>
                                                    {orderData?.procurement_list.list.map((item) => {

                                                        if (item.category === curCategory) {
                                                            const price = getPrice(selectedVendors[item.name], item.name);
                                                            total += (price ? parseFloat(price) : 0) * (item.quantity);

                                                            const lowest2 = getLowest2(item.name)

                                                            const quotesForItem = quote_data
                                                                ?.filter(value => value.item === item.name && value.quote)
                                                                ?.map(value => value.quote);
                                                            let minQuote;
                                                            if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                            return <div className="grid grid-cols-12">
                                                                <div className="text-sm col-span-2 border p-2">{item.item}</div>
                                                                <div className="text-sm border p-2">{item.unit}</div>
                                                                <div className="text-sm border p-2">{item.quantity}</div>
                                                                <div className="text-sm border p-2">{price ? price : "Delayed"}</div>
                                                                <div className="text-sm border p-2">{price ? price * item.quantity : "Delayed"}</div>
                                                                <div className="text-sm col-span-2 border p-2">{selectedVendors[item.name] ? getVendorName(selectedVendors[item.name]) : "Delayed"}</div>
                                                                <div className="text-sm col-span-2 border p-2">{lowest2 ? lowest2 * item.quantity : "N/A"}</div>
                                                                <div className="text-sm col-span-2 border p-2">{minQuote ? minQuote * item.quantity : "N/A"}</div>
                                                            </div>
                                                        }
                                                    })}
                                                </DialogDescription>
                                            </DialogHeader>
                                        </DialogContent>
                                    </Dialog>
                                </CardHeader>
                            </Card>
                            <div>
                                <div className="h-[45%] p-5 rounded-lg border border-grey-500">
                                    <div className="flex justify-between">
                                        <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                        <div className="font-bold text-2xl text-gray-500 border-gray-200">{lowest?.quote}
                                            <div className='flex'>
                                                {
                                                    (lowest?.quote < getTotal(curCategory)) ?
                                                        <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />
                                                }
                                                <span className={`pl-2 text-base font-medium ${(lowest?.quote < getTotal(curCategory)) ? "text-red-500" : "text-blue-500"}`}>{getPercentdiff(lowest?.quote, getTotal(curCategory))}%</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-medium text-gray-700 text-sm">
                                        {getVendorName(lowest?.vendor)}
                                    </div>
                                </div>
                                <div className="mt-2 h-[50%] p-5 rounded-lg border border-grey-500">
                                    <div className="flex justify-between">
                                        <div className="text-sm font-medium text-gray-400">Lowest Quoted Vendor</div>
                                        <div className="font-bold text-2xl text-gray-500 border-gray-200">{getLowest3(curCategory)}
                                            <div className='flex'>
                                                {
                                                    (getLowest3(curCategory) > getTotal(curCategory)) ?
                                                        <TrendingUp className="text-green-500" /> : ((getLowest3(curCategory) < getTotal(curCategory)) ? <TrendingDown className="text-red-500" /> : <CheckCheck className="text-blue-500" />)
                                                }
                                                <span className={`pl-2 text-base font-medium ${(getLowest3(curCategory) < getTotal(curCategory)) ? "text-red-500" : ((getLowest3(curCategory) > getTotal(curCategory)) ? "text-green-500" : "text-blue-500")}`}>{getPercentdiff(getTotal(curCategory), getLowest3(curCategory))}%</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-medium text-gray-700 text-sm">
                                        Last 3 months Lowest Amount
                                    </div>
                                </div>
                            </div>
                            <div className="col-span-2 py-4 flex space-x-2">
                                <Sheet>
                                    <SheetTrigger className="border border-red-500 text-red-500 bg-white font-normal px-4 py-1 rounded-lg" onClick={() => handleTrigger()}>Add Comment and Send Back</SheetTrigger>
                                    <SheetContent>
                                        <SheetHeader>
                                            <ScrollArea className="h-[90%] w-[600px] rounded-md border p-4">
                                                <SheetTitle>Enter Price</SheetTitle>
                                                <SheetDescription>
                                                    Add Comments and Send Back
                                                    <div className="flex justify-between py-2">
                                                        <div className="text-sm w-[45%]">Added Items</div>
                                                        <div className="text-sm">Qty</div>
                                                        <div className="text-sm">UOM</div>
                                                        <div className="text-sm">Rate</div>
                                                        <div className="text-sm w-[15%]">3 months Lowest Rate</div>
                                                    </div>
                                                    <label className="text-black">
                                                        <input
                                                            className="botton-0 mr-2 w-4 h-4"
                                                            type="checkbox"
                                                            checked={selectAll}
                                                            onChange={handleSelectAllChange}
                                                        />
                                                        Select All
                                                    </label>
                                                    {orderData?.procurement_list.list.map((item) => {
                                                        if (item.category === curCategory) {
                                                            const price = getPrice(selectedVendors[item.name], item.name);
                                                            total += price ? parseFloat(price) : 0;

                                                            const quotesForItem = quote_data
                                                                ?.filter(value => value.item === item.name && value.quote)
                                                                ?.map(value => value.quote);
                                                            let minQuote;
                                                            if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);

                                                            return <div className="flex justify-between py-2">
                                                                <div className="text-sm w-[45%] text-black font-semibold">{1 ? <input disabled={!selectedVendors[item.name] ? true : false} className="botton-0 mr-2 w-4 h-4" type="checkbox" checked={selectedItem.list.some(selected => selected.name === item.name)} onChange={() => handleCheckboxChange(item.name)} /> : " "}{item.item}</div>
                                                                <div className="text-sm text-black font-semibold">{item.quantity}</div>
                                                                <div className="text-sm text-black font-semibold">{item.unit}</div>
                                                                <div className="text-sm text-black font-semibold">{price ? price : "Delayed"}</div>
                                                                <div className="text-sm text-black font-semibold w-[15%]">{minQuote ? minQuote : "N/A"}</div>
                                                            </div>
                                                        }
                                                    })}
                                                    <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                                    <textarea
                                                        id="textarea"
                                                        className="w-full border rounded-lg p-2"
                                                        value={comment}
                                                        placeholder="Type your comments here"
                                                        onChange={(e) => setComment(e.target.value)}
                                                    />
                                                    <div className="flex flex-col justify-end items-end bottom-4 right-4 pt-10">
                                                        {comment ?
                                                            <SheetClose><Button onClick={() => handleSendBack(curCategory)}>Submit</Button></SheetClose>
                                                            :
                                                            <Button disabled={true} >Submit</Button>
                                                        }

                                                    </div>
                                                </SheetDescription>
                                            </ScrollArea>
                                        </SheetHeader>
                                    </SheetContent>
                                </Sheet>
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button>
                                            Approve
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-[425px]">
                                        <DialogHeader>
                                            <DialogTitle>Are you Sure</DialogTitle>
                                            <DialogDescription>
                                                Click on Confirm to Approve.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <DialogClose><Button variant="secondary" onClick={() => handleApprove(curCategory)}>Confirm</Button></DialogClose>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    })} */}
                    {/* {orderData.category_list?.list.length === total_categories ? <div className="flex space-x-2 justify-end items-end bottom-4 right-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="border border-red-500 bg-white text-red-500 hover:text-white" >
                                    Reject All
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Are you Sure</DialogTitle>
                                    <DialogDescription>
                                        Click on Confirm to Reject All.
                                    </DialogDescription>
                                </DialogHeader>
                                <Button variant="secondary" onClick={() => handleRejectAll()}>Confirm</Button>
                            </DialogContent>
                        </Dialog>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button>
                                    Approve All
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Are you Sure</DialogTitle>
                                    <DialogDescription>
                                        Click on Confirm to Approve.
                                    </DialogDescription>
                                </DialogHeader>
                                <Button variant="secondary" onClick={() => handleApproveAll()}>Confirm</Button>
                            </DialogContent>
                        </Dialog>
                    </div> :
                        ((orderData.project && orderData.category_list.list.length === 0) && <div className="flex space-x-2 justify-center items-center bottom-4 right-4">
                            {(update_loading || loading) ? <div>Loading...</div> : <Button onClick={() => handleDone()}>
                                Done
                            </Button>}
                        </div>)
                    } */}
                </div>
            </div>}
            <Space className="hidden" align="center" style={{ marginBottom: 16 }}>
                CheckStrictly: <Switch checked={checkStrictly} onChange={setCheckStrictly} />
            </Space>
            <ConfigProvider
                theme={{
                    token: {
                        // Seed Token
                        colorPrimary: '#FF2828',
                        borderRadius: 4,

                        // Alias Token
                        colorBgContainer: '#FFFFFF',
                    },
                }}
            >
                {data.length > 0 && <Table
                    rowSelection={{ ...rowSelection,checkStrictly }}
                    dataSource={data}
                    expandable={{ defaultExpandAllRows: true }}
                    columns={columns}
                />}
            </ConfigProvider>
            {selectedItems?.length > 0 && <div className="text-right space-x-2">
                <Dialog>
                    <DialogTrigger asChild>
                        <Button className="text-red-500 bg-white border border-red-500 hover:text-white">
                            Send Back
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                Add Comments and Send Back the Selected Items.
                                <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                <textarea
                                    id="textarea"
                                    className="w-full border rounded-lg p-2"
                                    value={comment}
                                    placeholder="Type your comments here"
                                    onChange={(e) => setComment(e.target.value)}
                                />
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            <Button className="text-white bg-red-500" onClick={() => newHandleSentBack()}>Send Back</Button>
                        </DialogClose>
                    </DialogContent>
                </Dialog>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button>
                            Approve
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Are you Sure</DialogTitle>
                            <DialogDescription>
                                Click on Confirm to Approve the Selected Items.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogClose>
                            <Button className="text-white bg-red-500" onClick={() => newHandleApprove()}>Approve</Button>
                        </DialogClose>
                    </DialogContent>
                </Dialog>
            </div>}
            <div className="flex items-center pt-1  pb-4">
                <h2 className="text-base pl-2 font-bold tracking-tight">Delayed Items</h2>
            </div>
            <div className="overflow-x-auto">

                <div className="min-w-full inline-block align-middle">
                    {orderData.category_list?.list.map((cat) => {
                        if(isDelayed(cat.name)){return <div className="p-5">
                            <ReactTable>
                                <TableHeader>
                                    <TableRow className="bg-red-100">
                                        <TableHead className="w-[60%]"><span className="text-red-700 pr-1 font-extrabold">{cat.name}</span>Items</TableHead>
                                        <TableHead className="w-[25%]">UOM</TableHead>
                                        <TableHead className="w-[15%]">Qty</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {orderData.procurement_list?.list.map((item) => {
                                        if (item.category === cat.name) {
                                            if(!selectedVendors[item.name]){return (
                                                <TableRow key={item.item}>
                                                    <TableCell>{<ItemComponent item_id={item.name} />}</TableCell>
                                                    <TableCell>{item.unit}</TableCell>
                                                    <TableCell>{item.quantity}</TableCell>
                                                </TableRow>
                                            )}
                                        }
                                    })}
                                </TableBody>
                            </ReactTable>
                        </div>}
                    })}
                </div>
            </div>

            <div className="py-10"></div>
        </MainLayout>
    )
}
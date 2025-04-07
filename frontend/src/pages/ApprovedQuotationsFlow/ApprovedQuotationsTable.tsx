import { useFrappeGetDocList } from "frappe-react-sdk";
// import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
// import {
//     ChartToolPanelsDef,
//   type ColDef,
//   type GetRowIdFunc,
//   type GetRowIdParams,
//   type ValueFormatterFunc,
//   type ValueGetterParams,
// } from "@ag-grid-community/core";
// import { ModuleRegistry } from "@ag-grid-community/core";
// import { AgGridReact } from "@ag-grid-community/react";
// import "@ag-grid-community/styles/ag-grid.css";
// import "@ag-grid-community/styles/ag-theme-material.css";
// import { AdvancedFilterModule } from "@ag-grid-enterprise/advanced-filter";
// import { GridChartsModule } from "@ag-grid-enterprise/charts-enterprise";
// import { ColumnsToolPanelModule } from "@ag-grid-enterprise/column-tool-panel";
// import { ExcelExportModule } from "@ag-grid-enterprise/excel-export";
// import { FiltersToolPanelModule } from "@ag-grid-enterprise/filter-tool-panel";
// import { MenuModule } from "@ag-grid-enterprise/menu";
// import { RangeSelectionModule } from "@ag-grid-enterprise/range-selection";
// import { RichSelectModule } from "@ag-grid-enterprise/rich-select";
// import { RowGroupingModule } from "@ag-grid-enterprise/row-grouping";
// import { SetFilterModule } from "@ag-grid-enterprise/set-filter";
// import { SparklinesModule } from "@ag-grid-enterprise/sparklines";
// import { StatusBarModule } from "@ag-grid-enterprise/status-bar";
import React, {
    useMemo
} from "react";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import memoize from "lodash/memoize";
import { Link } from "react-router-dom";
// import { CsvExportModule } from "@ag-grid-community/csv-export";

interface Props {
    gridTheme?: string;
    isDarkMode?: boolean;
  }

  // ModuleRegistry.registerModules([
  //   ClientSideRowModelModule,
  //   CsvExportModule
  //   // AdvancedFilterModule,
  //   // ColumnsToolPanelModule,
  //   // ExcelExportModule,
  //   // FiltersToolPanelModule,
  //   // GridChartsModule,
  //   // MenuModule,
  //   // RangeSelectionModule,
  //   // RowGroupingModule,
  //   // SetFilterModule,
  //   // RichSelectModule,
  //   // StatusBarModule,
  //   // SparklinesModule,
  // ]);
  

export const ApprovedQuotationsTable: React.FC<Props> = ({
    gridTheme = "ag-theme-material",
    isDarkMode = false,
  }) => {

    // const [itemIds, setItemIds] = useState([])

    const {data : approvedQuotations, isLoading: approvedQuotationsLoading} = useFrappeGetDocList("Approved Quotations", {
        fields: ["*"],
        limit: 100000
    })

    const {data: vendorsList} = useFrappeGetDocList("Vendors", {
        fields: ["*"],
        limit: 10000
    })

  //   const {data : approvedItems} = useFrappeGetDocList("Items", {
  //     fields: ["*"],
  //     filters: [["name", "not in", itemIds]],
  //     limit: 10000
  //   },
  //   itemIds?.length ? undefined : null
  // )

    // useEffect(() => {
    //   if(approvedQuotations) {
    //     const itemIds = approvedQuotations?.map((ap) => ap?.item_id)
    //     setItemIds(itemIds)
    //   }
    // }, [approvedQuotations])

    // console.log("itemIds", itemIds)
    // console.log("approvedItems", approvedItems)

    const  findVendorName = useMemo(() => memoize((id: string | undefined) => {
        if(vendorsList) {
            return vendorsList?.find((i) => i?.name === id)?.vendor_name || ""
        }
    }, (id: string | undefined) =>  id),[vendorsList])

    // const findItemId = (name) => {
    //     if(approvedQuotations) {
    //         return approvedQuotations?.find((i) => i?.name === name)?.item_id
    //     }
    // }

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })), [vendorsList])

    const getItemOptions = useMemo(() => {
        const options: Set<string>  = new Set()
        const itemOptions: {label: string, value: string}[] = []
        if(approvedQuotations) {
            approvedQuotations?.forEach((aq) => {
                if(!options?.has(aq.item_name)){
                    const op = ({ label: aq.item_name, value: aq.item_name })
                    itemOptions.push(op)
                    options.add(aq.item_name)
                }
            })
        }

        return itemOptions
    }, [approvedQuotations])

    const columns: ColumnDef<ApprovedQuotations>[]  = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Quote ID" />
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date Created" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatDate(row.getValue("creation"))}
                        </div>
                    )
                }
            }, 
            {
                accessorKey : "item_name",
                header: ({column}) => {
                    return (
                            <DataTableColumnHeader column={column} title="Item" />
                    )
                },
                cell: ({ row }) => {
                    // const itemId = findItemId(row.getValue("name"))
                    return (
                        // <Link className="underline hover:underline-offset-2" to={`/items/${itemId}`}>
                        //     {row.getValue("item_name")}
                        // </Link>
                        <div className="font-medium">
                            {row.getValue("item_name")}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey : "unit",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Unit" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("unit")}
                        </div>
                    )
                }
            },
            {
                accessorKey : "quote",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Quote" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(row.getValue("quote"))}
                        </div>
                    )
                }
            },
            {
                accessorKey : "make",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Make" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("make") || "--"} 
                        </div>
                    )
                }
            },
            {
                accessorKey : "vendor",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor" />
                    )
                },
                cell: ({ row }) => {
                    const vendorName = findVendorName(row.getValue("vendor"))
                    return (
                        <div className="font-medium">
                            {vendorName}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey : "procurement_order",
                header: ({column}) => {
                    return (
                        <DataTableColumnHeader column={column} title="#PO" />
                    )
                },
                cell: ({ row }) => {
                    const poId: string = row.getValue("procurement_order")
                    return (
                        <Link className="underline hover:underline-offset-2" to={poId?.replaceAll("/", "&=")}>
                            {poId}
                        </Link>
                    )
                }
            }

        ],
        [approvedQuotations, vendorsList]
    )


    // AG GRID CONFIGURATION STARTS FROM HERE

  // const [rowData, setRowData] = useState([]);

  // const [rowData2, setRowData2] = useState([]);

  // const gridRef = useRef<AgGridReact>(null);

  // const gridRef2 = useRef<AgGridReact>(null)

  // const navigate = useNavigate()

  // useEffect(() => {
  //   if(approvedQuotations) {
  //       setRowData(approvedQuotations)
  //   }
  // }, [approvedQuotations])

  // useEffect(() => {
  //   if(approvedItems) {
  //       setRowData2(approvedItems)
  //   }
  // }, [approvedItems])


  // const colDefs = useMemo<ColDef[]>(
  //   () => [
  //     {
  //       field: "name",
  //       headerName: "Quote ID",
  //       chartDataType: "category",
  //       minWidth: 100,
  //       editable: true,
  //       // cellEditor: "agSelectCellEditor",
  //       // cellEditorParams: {
  //       //     values: ['Tesla', 'Ford', 'Toyota'],
  //       // },
  //       // cellRenderer: "agGroupCellRenderer"
  //     },
  //     {
  //       headerName: "Creation",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       valueGetter: ({data} : ValueGetterParams) => data && formatDate(data?.creation), 
  //       minWidth: 120,
  //     },
  //     {
  //       field: "item_name",
  //       chartDataType: "category",
  //       headerName: "Item",
  //       cellDataType: "text",
  //       minWidth: 300,
  //       onCellClicked: ({data}) =>  navigate(`/items/${data?.item_id}`),
  //       cellClass: "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer"
  //     },
  //   {
  //       field: "unit",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       // type: "rightAligned",
  //       minWidth: 100,
  //     },
  //     {
  //       field: "quote",
  //       chartDataType: "series",
  //       // type: "rightAligned",
  //       minWidth: 100,
  //       valueGetter: ({data} : ValueGetterParams) => data && parseFloat(data?.quote),
  //       valueFormatter: params => "₹" + params?.value?.toLocaleString(),
  //     },
  //     {
  //       headerName: "Vendor",
  //       // type: "rightAligned",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       valueGetter: ({data} : ValueGetterParams) => data && findVendorName(data?.vendor),
  //       minWidth: 200,
  //       // filter: true,
  //       // floatingFilter: true
  //     },
  //     {
  //       headerName: "PO",
  //       chartDataType: "category",
  //       field: "procurement_order",
  //       cellDataType: "text",
  //       // type: "rightAligned",
  //       minWidth: 120,
  //       onCellClicked: ({data}) =>  navigate(`${data?.procurement_order?.replaceAll("/", "&=")}`),
  //       valueGetter: ({data} : ValueGetterParams) => data && data?.procurement_order?.slice(3, 12),
  //       cellClass: "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer",
  //     },
  //   ],
  //   [vendorsList, approvedQuotations]
  // );

  // const colDefs2 = useMemo<ColDef[]>(
  //   () => [
  //     {
  //       field: "name",
  //       headerName: "Item ID",
  //       chartDataType: "category",
  //       minWidth: 100,
  //       editable: true,
  //     },
  //     {
  //       headerName: "Creation",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       valueGetter: ({data} : ValueGetterParams) => data && formatDate(data?.creation), 
  //       minWidth: 120,
  //     },
  //     {
  //       field: "item_name",
  //       chartDataType: "category",
  //       headerName: "Item",
  //       cellDataType: "text",
  //       minWidth: 300,
  //       onCellClicked: ({data}) =>  navigate(`/items/${data?.item_id}`),
  //       cellClass: "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer"
  //     },
  //   {
  //       field: "unit_name",
  //       headerName: "Unit",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       // type: "rightAligned",
  //       minWidth: 100,
  //     },
  //     {
  //       field: "make_name",
  //       headerName: "Make Name",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       // type: "rightAligned",
  //       minWidth: 100,
  //     },
  //     {
  //       field: "category",
  //       chartDataType: "category",
  //       cellDataType: "text",
  //       // type: "rightAligned",
  //       minWidth: 100,
  //     }
  //   ],
  //   [approvedItems, itemIds]
  // );

  // const defaultColDef: ColDef = useMemo(
  //   () => ({
  //     flex: 1,
  //     filter: true,
  //   //   enableRowGroup: true,
  //   //   enableValue: true,
  //   }),
  //   []
  // );

  // const chartToolPanelsDef = useMemo<ChartToolPanelsDef>(() => {
  //   return {
  //     defaultToolPanel: "settings",
  //   };
  // }, []);

  // const getRowId = useCallback<GetRowIdFunc>(
  //   ({ data: { name } }: GetRowIdParams) => name,
  //   []
  // );

  // const statusBar = useMemo(
  //   () => ({
  //     statusPanels: [
  //       { statusPanel: "agTotalAndFilteredRowCountComponent" },
  //       { statusPanel: "agTotalRowCountComponent" },
  //       { statusPanel: "agFilteredRowCountComponent" },
  //       { statusPanel: "agSelectedRowCountComponent" },
  //       { statusPanel: "agAggregationComponent" },
  //     ],
  //   }),
  //   []
  // );

//     const pagination = true;
//     const paginationPageSize = 50;
//     const paginationPageSizeSelector = [50, 100, 500];

//   const rowSelection = useMemo(() => { 
// 	return {
//       mode: 'multiRow',
//     };
// }, []);

// const onBtnExport = useCallback(() => {
//     gridRef.current!.api.exportDataAsCsv();
// }, []);

// const onBtnExport2 = useCallback(() => {
//   gridRef2.current!.api.exportDataAsCsv();
// }, []);

//   const themeClass = `${gridTheme}${isDarkMode ? "-dark" : ""}`;

  return (
    <div className="flex-1 space-y-4">
        {/* <div className="flex items-center justify-between space-y-2">
               <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Approved Quotations</h2>
         </div> */}

        <div>
            {/* <h2 className="font-semibold text-lg text-primary">Tanstack Table</h2> */}
            {approvedQuotationsLoading ? (<TableSkeleton />) : (
                   <DataTable columns={columns} data={approvedQuotations || []} approvedQuotesVendors={vendorOptions} itemOptions={getItemOptions} />
            )}
        </div>
        {/* <Separator className="my-6" />
    <div className={styles.wrapper}>
    <h2 className="font-semibold text-lg py-4 text-primary">AG Grid Table (inc. Enterprise, Recommended for flexible, dynamic and robust interface)</h2>
    <Button onClick={onBtnExport}>Download CSV export file</Button>
      <div className={styles.container}>
        <div className={`${themeClass} ${styles.grid}`}>
          <AgGridReact
            ref={gridRef}
            getRowId={getRowId}
            rowData={rowData}
            columnDefs={colDefs}
            defaultColDef={defaultColDef}
            cellSelection = {true}
            enableCharts={true}
            chartToolPanelsDef={chartToolPanelsDef}
            rowSelection={rowSelection}
            rowGroupPanelShow={"always"}
            suppressAggFuncInHeader
            groupDefaultExpanded={-1}
            statusBar={statusBar}
            pagination={pagination}
            paginationPageSize={paginationPageSize}
            paginationPageSizeSelector={paginationPageSizeSelector}
            onCellValueChanged={(e) => console.log("New Cell Value: ", e)} // when editing a column value, we can track that using this event
            // masterDetail
          />
        </div>
      </div>
    </div>

    <div className={styles.wrapper}>
    <h2 className="font-semibold text-lg py-4 text-primary">AG Grid Table (inc. Enterprise, Recommended for flexible, dynamic and robust interface)</h2>
    <Button onClick={onBtnExport2}>Download CSV export file</Button>
      <div className={styles.container}>
        <div className={`${themeClass} ${styles.grid}`}>
          <AgGridReact
            ref={gridRef2}
            getRowId={getRowId}
            rowData={rowData2}
            columnDefs={colDefs2}
            defaultColDef={defaultColDef}
            // cellSelection = {true}
            // enableCharts={true}
            chartToolPanelsDef={chartToolPanelsDef}
            rowSelection={rowSelection}
            rowGroupPanelShow={"always"}
            suppressAggFuncInHeader
            groupDefaultExpanded={-1}
            statusBar={statusBar}
            pagination={pagination}
            paginationPageSize={paginationPageSize}
            paginationPageSizeSelector={paginationPageSizeSelector}
            onCellValueChanged={(e) => console.log("New Cell Value: ", e)} // when editing a column value, we can track that using this event
            // masterDetail
          />
        </div>
      </div>
    </div> */}
    </div>
  );
}
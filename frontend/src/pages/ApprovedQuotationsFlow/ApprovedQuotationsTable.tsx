import { useFrappeGetDocList } from "frappe-react-sdk"
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import {
  type ColDef,
  type GetRowIdFunc,
  type GetRowIdParams,
  type ValueFormatterFunc,
  type ValueGetterParams,
} from "@ag-grid-community/core";
import { ModuleRegistry } from "@ag-grid-community/core";
import { AgGridReact } from "@ag-grid-community/react";
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-quartz.css";
import { AdvancedFilterModule } from "@ag-grid-enterprise/advanced-filter";
import { GridChartsModule } from "@ag-grid-enterprise/charts-enterprise";
import { ColumnsToolPanelModule } from "@ag-grid-enterprise/column-tool-panel";
import { ExcelExportModule } from "@ag-grid-enterprise/excel-export";
import { FiltersToolPanelModule } from "@ag-grid-enterprise/filter-tool-panel";
import { MenuModule } from "@ag-grid-enterprise/menu";
import { RangeSelectionModule } from "@ag-grid-enterprise/range-selection";
import { RichSelectModule } from "@ag-grid-enterprise/rich-select";
import { RowGroupingModule } from "@ag-grid-enterprise/row-grouping";
import { SetFilterModule } from "@ag-grid-enterprise/set-filter";
import { SparklinesModule } from "@ag-grid-enterprise/sparklines";
import { StatusBarModule } from "@ag-grid-enterprise/status-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./FinanceExample.module.css";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Link, useNavigate } from "react-router-dom";
import { DataTable } from "@/components/data-table/data-table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Separator } from "@/components/ui/separator";

interface Props {
    gridTheme?: string;
    isDarkMode?: boolean;
  }

  ModuleRegistry.registerModules([
    ClientSideRowModelModule,
    AdvancedFilterModule,
    ColumnsToolPanelModule,
    ExcelExportModule,
    FiltersToolPanelModule,
    GridChartsModule,
    MenuModule,
    RangeSelectionModule,
    RowGroupingModule,
    SetFilterModule,
    RichSelectModule,
    StatusBarModule,
    SparklinesModule,
  ]);
  

export const ApprovedQuotationsTable: React.FC<Props> = ({
    gridTheme = "ag-theme-quartz",
    isDarkMode = false,
  }) => {

    const {data : approvedQuotations, isLoading: approvedQuotationsLoading, mutate: approvedQuotationsMutate} = useFrappeGetDocList("Approved Quotations", {
        fields: ["*"],
        limit: 10000
    })

    const {data: vendorsList} = useFrappeGetDocList("Vendors", {
        fields: ["*"],
        limit: 1000
    })

    const  findVendorName = (id) => {
        if(vendorsList) {
            return vendorsList?.find((i) => i?.name === id)?.vendor_name
        }
    }

    const findItemId = (name) => {
        if(approvedQuotations) {
            return approvedQuotations?.find((i) => i?.name === name)?.item_id
        }
    }

    const vendorOptions = vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name }))

    const getItemOptions = useMemo(() => {
        const options = []
        const itemOptions = []
        if(approvedQuotations) {
            approvedQuotations?.forEach((aq) => {
                if(!options?.includes(aq.item_name)){
                    const op = ({ label: aq.item_name, value: aq.item_name })
                    itemOptions.push(op)
                    options.push(aq.item_name)
                }
            })
        }

        return itemOptions
    }, [approvedQuotations])

    const columns = useMemo(
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
                        <DataTableColumnHeader column={column} title="Creation" />
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
                    const itemId = findItemId(row.getValue("name"))
                    return (
                        <Link className="underline hover:underline-offset-2" to={`/items/${itemId}`}>
                            {row.getValue("item_name")}
                        </Link>
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
                        <DataTableColumnHeader column={column} title="Associated PO" />
                    )
                },
                cell: ({ row }) => {
                    const poId = row.getValue("procurement_order")
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

  const [rowData, setRowData] = useState([]);
  const gridRef = useRef<AgGridReact>(null);

  const navigate = useNavigate()

  useEffect(() => {
    if(approvedQuotations) {
        setRowData(approvedQuotations)
    }
  }, [approvedQuotations])


  const colDefs = useMemo<ColDef[]>(
    () => [
      {
        field: "name",
        headerName: "Quote ID",
        minWidth: 100,
      },
      {
        headerName: "Creation",
        cellDataType: "text",
        valueGetter: ({data} : ValueGetterParams) => data && formatDate(data?.creation), 
        minWidth: 120,
      },
      {
        field: "item_name",
        headerName: "Item",
        cellDataType: "text",
        minWidth: 300,
        onCellClicked: ({data}) =>  navigate(`/items/${data?.item_id}`),
        cellClass: "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer"
      },
    {
        field: "unit",
        cellDataType: "text",
        // type: "rightAligned",
        minWidth: 100,
      },
      {
        field: "quote",
        cellDataType: "text",
        // type: "rightAligned",
        minWidth: 100,
        // valueGetter: ({data} : ValueGetterParams) => data && formatToIndianRupee(data?.quote)
      },
      {
        headerName: "Vendor",
        // type: "rightAligned",
        cellDataType: "text",
        valueGetter: ({data} : ValueGetterParams) => data && findVendorName(data?.vendor),
        minWidth: 200
      },
      {
        headerName: "PO",
        field: "procurement_order",
        cellDataType: "text",
        // type: "rightAligned",
        minWidth: 120,
        onCellClicked: ({data}) =>  navigate(`${data?.procurement_order?.replaceAll("/", "&=")}`),
        valueGetter: ({data} : ValueGetterParams) => data && data?.procurement_order?.slice(3, 12),
        cellClass: "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer",
      },
    ],
    [vendorsList, approvedQuotations]
  );

  const defaultColDef: ColDef = useMemo(
    () => ({
      flex: 1,
      filter: true,
      enableRowGroup: true,
      enableValue: true,
    }),
    []
  );

  const getRowId = useCallback<GetRowIdFunc>(
    ({ data: { name } }: GetRowIdParams) => name,
    []
  );

  const statusBar = useMemo(
    () => ({
      statusPanels: [
        { statusPanel: "agTotalAndFilteredRowCountComponent" },
        { statusPanel: "agTotalRowCountComponent" },
        { statusPanel: "agFilteredRowCountComponent" },
        { statusPanel: "agSelectedRowCountComponent" },
        { statusPanel: "agAggregationComponent" },
      ],
    }),
    []
  );

  const themeClass = `${gridTheme}${isDarkMode ? "-dark" : ""}`;

  return (
    <div className="flex-1 md:space-y-4">
        <div className="flex items-center justify-between space-y-2">
               <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Approved Quotations</h2>
         </div>

        <div className="pt-4">
            <h2 className="font-semibold text-lg text-primary">Tanstack Table</h2>
            {approvedQuotationsLoading ? (<TableSkeleton />) : (
                   <DataTable columns={columns} data={approvedQuotations || []} approvedQuotesVendors={vendorOptions} itemOptions={getItemOptions} />
            )}
        </div>
        <Separator className="my-6" />
    <div className={styles.wrapper}>
    <h2 className="font-semibold text-lg py-4 text-primary">AG Grid Table (inc. Enterprise, Recommended for flexible, dynamic and robust interface)</h2>
      <div className={styles.container}>
        <div className={`${themeClass} ${styles.grid}`}>
          <AgGridReact
            ref={gridRef}
            getRowId={getRowId}
            rowData={rowData}
            columnDefs={colDefs}
            defaultColDef={defaultColDef}
            cellSelection = {true}
            enableCharts
            rowSelection={"multiple"}
            rowGroupPanelShow={"always"}
            suppressAggFuncInHeader
            groupDefaultExpanded={-1}
            statusBar={statusBar}
          />
        </div>
      </div>
    </div>
    </div>
  );
}
import {
  useFrappeDocTypeEventListener,
  useFrappeGetDocList,
} from "frappe-react-sdk";
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import {
  ChartToolPanelsDef,
  type ColDef,
  type GetRowIdFunc,
  type GetRowIdParams,
  type ValueFormatterFunc,
  type ValueGetterParams,
} from "@ag-grid-community/core";
import { ModuleRegistry } from "@ag-grid-community/core";
import { AgGridReact } from "@ag-grid-community/react";
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-material.css";
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./LivePRTracking.module.css";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Link, useNavigate } from "react-router-dom";
import { CsvExportModule } from "@ag-grid-community/csv-export";
import { Button } from "@/components/ui/button";

interface Props {
  gridTheme?: string;
  isDarkMode?: boolean;
}

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CsvExportModule,
  // AdvancedFilterModule,
  // ColumnsToolPanelModule,
  // ExcelExportModule,
  // FiltersToolPanelModule,
  // GridChartsModule,
  // MenuModule,
  // RangeSelectionModule,
  // RowGroupingModule,
  // SetFilterModule,
  // RichSelectModule,
  // StatusBarModule,
  // SparklinesModule,
]);

export const LivePRTrackingTable: React.FC<Props> = ({
  gridTheme = "ag-theme-material",
  isDarkMode = false,
}) => {
  const {
    data: prList,
    isLoading: prListLoading,
    mutate: prListMutate,
  } = useFrappeGetDocList("Procurement Requests", {
    fields: ["*"],
    orderBy: { field: "modified", order: "desc" },
    limit: 10000,
  });

  useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
    await prListMutate();
  });

  //   console.log("prList", prList);

  const { data: projects } = useFrappeGetDocList("Projects", {
    fields: ["*"],
    limit: 1000,
  });

  const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
  });

  const getUserFullName = (id) => {
    if (id === "Administrator") return id;
    if (usersList) {
      return usersList?.find((user) => user?.name === id)?.full_name;
    }
  };

  const getProjectName = (id) => {
    if (projects) {
      return projects?.find((i) => i?.name === id)?.project_name;
    }
  };

  // AG GRID CONFIGURATION STARTS FROM HERE

  const [rowData, setRowData] = useState([]);
  const gridRef = useRef<AgGridReact>(null);

  const navigate = useNavigate();

  useEffect(() => {
    if (prList) {
      setRowData(prList);
    }
  }, [prList]);

  const colDefs = useMemo<ColDef[]>(
    () => [
      {
        field: "name", // PR ID
        headerName: "PR ID",
        // chartDataType: "category",
        minWidth: 170,
        editable: true,

        // onCellClicked: ({ data }) =>
        //   navigate(`/prs&milestones/procurement-requests/${data?.name}`),
        // cellEditor: "agSelectCellEditor",
        // cellEditorParams: {
        //     values: ['Tesla', 'Ford', 'Toyota'],
        // },
        // cellRenderer: "agGroupCellRenderer"
        cellRenderer: ({ value, data }) => {
          return (
            <Link
              to={`/prs&milestones/procurement-requests/${data?.name}`}
              className="text-blue-500 underline hover:text-blue-700"
            >
              {value}
            </Link>
          );
        },
      },
      {
        field: "project",
        headerName: "Project",
        // chartDataType: "category",
        // type: "rightAligned",
        minWidth: 200,
        // valueGetter: ({ data }: ValueGetterParams) =>
        //   data && parseFloat(data?.quote),
        // valueFormatter: (params) => "₹" + params?.value?.toLocaleString(),
        valueFormatter: (params) => getProjectName(params?.value),
      },
      {
        field: "creation",
        headerName: "Creation",
        // chartDataType: "time",
        valueFormatter: (params) => formatDate(params?.value),
        minWidth: 130,
      },
      {
        // chartDataType: "category",
        headerName: "Created By",
        // cellDataType: "text",
        minWidth: 150,
        valueGetter: ({ data }: ValueGetterParams) =>
          data && getUserFullName(data?.owner),
        // onCellClicked: ({ data }) => navigate(`/items/${data?.item_id}`),
        // cellClass:
        //   "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer",
      },
      {
        field: "modified",
        headerName: "Last Modified",
        // chartDataType: "time",
        // type: "rightAligned",
        minWidth: 130,
        // valueGetter: ({ data }: ValueGetterParams) =>
        //   data && parseFloat(data?.quote),
        // valueFormatter: (params) => "₹" + params?.value?.toLocaleString(),
        valueFormatter: (params) => formatDate(params?.value),
      },
      {
        // field: "modified_by",
        headerName: "Last Modified By",
        // chartDataType: "category",
        // cellDataType: "text",
        // type: "rightAligned",
        minWidth: 150,
        valueGetter: ({ data }: ValueGetterParams) =>
          data && getUserFullName(data?.modified_by),
      },
      {
        field: "workflow_state",
        headerName: "Status",
        // type: "rightAligned",
        // chartDataType: "category",
        // cellDataType: "text",
        // valueGetter: ({ data }: ValueGetterParams) =>
        //   data && findVendorName(data?.vendor),
        minWidth: 160,
        // filter: true,
        // floatingFilter: true
      },
      {
        headerName: "Procurement Package",
        // chartDataType: "category",
        field: "work_package",
        // cellDataType: "text",
        // type: "rightAligned",
        minWidth: 200,
        // onCellClicked: ({ data }) =>
        //   navigate(`${data?.procurement_order?.replaceAll("/", "&=")}`),
        // valueGetter: ({ data }: ValueGetterParams) =>
        //   data && data?.procurement_order?.slice(3, 12),
        // cellClass:
        //   "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer",
      },
    ],
    [prList, usersList, projects]
  );

  const defaultColDef: ColDef = useMemo(
    () => ({
      flex: 1,
      filter: true,
      //   enableRowGroup: true,
      //   enableValue: true,
    }),
    []
  );

  const chartToolPanelsDef = useMemo<ChartToolPanelsDef>(() => {
    return {
      defaultToolPanel: "settings",
    };
  }, []);

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

  const pagination = true;
  const paginationPageSize = 50;
  const paginationPageSizeSelector = [50, 100, 500];

  const rowSelection = useMemo(() => {
    return {
      mode: "multiRow",
    };
  }, []);

  const onBtnExport = useCallback(() => {
    gridRef.current!.api.exportDataAsCsv();
  }, []);

  const themeClass = `${gridTheme}${isDarkMode ? "-dark" : ""}`;

  return (
    <div className="flex-1 space-y-4">
      <div className={styles.wrapper}>
        <Button onClick={onBtnExport}>Download CSV export file</Button>
        <div className={styles.container}>
          <div className={`${themeClass} ${styles.grid}`}>
            <AgGridReact
              ref={gridRef}
              getRowId={getRowId}
              rowData={rowData}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              // cellSelection = {true}
              // enableCharts={true}
              chartToolPanelsDef={chartToolPanelsDef}
              rowSelection={rowSelection}
              rowGroupPanelShow={"always"}
              suppressAggFuncInHeader
              groupDefaultExpanded={-1}
              // statusBar={statusBar}
              pagination={pagination}
              paginationPageSize={paginationPageSize}
              paginationPageSizeSelector={paginationPageSizeSelector}
              onCellValueChanged={(e) => console.log("New Cell Value: ", e)} // when editing a column value, we can track that using this event
              // masterDetail
            />
          </div>
        </div>
      </div>
    </div>
  );
};

import { CategoryData, DataItem } from "@/pages/ProcurementRequests/VendorQuotesSelection/VendorsSelectionSummary";
import { columns, innerColumns } from "@/pages/Sent Back Requests/SBQuotesSelectionReview";
import { ConfigProvider, Table, TableProps } from "antd";
import React from "react";
import { v4 as uuidv4 } from "uuid";

interface ApproveVendorQuotesPRorSBAntDTableProps {
  dataSource : {
    key: string;
    totalAmount: string | number | undefined;
    category: string;
    items: DataItem[];
}[]
selectionMap: Map<any, any>
setSelectionMap: React.Dispatch<React.SetStateAction<Map<any, any>>>
}

export const ApproveVendorQuotesPRorSBAntDTable : React.FC<ApproveVendorQuotesPRorSBAntDTableProps> = ({dataSource, selectionMap, setSelectionMap}) => {

  const parentRowSelection: TableProps<any>['rowSelection'] = {
    selectedRowKeys: Array.from(selectionMap.keys()).filter(key => selectionMap.get(key)?.all),
    onChange: (selectedCategoryKeys) => {
        setSelectionMap(prevMap => {
            const newMap = new Map(prevMap);
            const selectedKeysSet = new Set(selectedCategoryKeys);

            dataSource.forEach(category => {
                const categoryKey = category.key;
                const categoryItems = new Set(category.items.map(item => item.name));

                if (selectedKeysSet.has(categoryKey)) {
                    // Category selected
                    newMap.set(categoryKey, { all: true, items: categoryItems });
                } else {
                    // Category deselected
                    if (newMap.has(categoryKey) && newMap.get(categoryKey).all) {
                        // If it was all selected, remove it completely
                        newMap.delete(categoryKey);
                    }
                    // If some items were selected, it should stay.
                }
            });

            return newMap;
        });
    },
    onSelectAll: (selected) => {
      setSelectionMap(prevMap => {
          const newMap = new Map(prevMap);

          if (selected) {
              dataSource.forEach(category => {
                  const categoryKey = category.key;
                  const categoryItems = new Set(category.items.map(item => item.name));
                  newMap.set(categoryKey, { all: true, items: categoryItems });
              });
          } else {
              newMap.clear();
          }

          return newMap;
      });
  },
    getCheckboxProps: (record) => ({
        indeterminate: selectionMap.has(record.key) && !selectionMap.get(record.key)?.all,
    }),
};

const getChildRowSelection = (category: CategoryData): TableProps<DataItem>['rowSelection'] => ({
  selectedRowKeys: Array.from(selectionMap.get(category.key)?.items || new Set()),
  onChange: (selectedItemKeys) => {
      setSelectionMap(prevMap => {
          const newMap = new Map(prevMap);
          const categoryItems = new Set(category.items.map(item => item.name));
          const selectedItems = new Set(selectedItemKeys);

          const allSelected = selectedItems.size === categoryItems.size;
          const noneSelected = selectedItems.size === 0;

          if (allSelected) {
              newMap.set(category.key, { all: true, items: categoryItems });
          } else if (noneSelected) {
              newMap.delete(category.key);
          } else {
              newMap.set(category.key, { all: false, items: selectedItems });
          }

          return newMap;
      });
  },
  hideSelectAll: true,
});
  return (
           <div className="overflow-x-auto">
              <ConfigProvider
              
              >
                <Table
                  dataSource={dataSource}
                  rowClassName={(record) => !record?.totalAmount ? "bg-red-100" : ""}
                  columns={columns}
                  rowSelection={parentRowSelection}
                  pagination={false}
                  expandable={{
                    defaultExpandAllRows : true,
                    expandedRowRender: (record) => (
                      <Table
                        rowSelection={getChildRowSelection(record)}
                        rowClassName={(record) => !record?.amount ? "bg-red-50" : ""}
                        dataSource={record.items}
                        columns={innerColumns}
                        pagination={false}
                        rowKey={(item) => item.name || uuidv4()}
                      />
                    ),
                  }}
                  rowKey="key"
                />
              </ConfigProvider>
            </div>
  )
}
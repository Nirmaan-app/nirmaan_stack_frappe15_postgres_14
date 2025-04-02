// import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
// import { Category, ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
// import { Vendors } from "@/types/NirmaanStack/Vendors";

// interface ProcurementTreeType {
//   pr: {
//     id: string;
//     project: string;
//     workflowState: string;
//     items: Map<string, ProcurementItem>;
//     categories: Map<string, Category>;
//     vendors: Map<string, Vendors>;
//     pos: Map<string, ProcurementOrder>;
//   };
//   // Indexes for fast lookups
//   indexes: {
//     itemsByCategory: Map<string, string[]>;
//     vendorsByItem: Map<string, string[]>;
//     posByVendor: Map<string, string[]>;
//   };
// }

// class ProcurementTree {
//   private prId: string;
//   private data: ProcurementTreeType;
//   private cache: Map<string, any> = new Map();

//   constructor(prId: string) {
//     this.prId = prId;
//     this.data = this.createEmptyStructure();
//   }

//   private createEmptyStructure(): ProcurementTreeType {
//     return {
//       pr: {
//         id: this.prId,
//         project: '',
//         workflowState: '',
//         items: new Map(),
//         categories: new Map(),
//         vendors: new Map(),
//         pos: new Map()
//       },
//       indexes: {
//         itemsByCategory: new Map(),
//         vendorsByItem: new Map(),
//         posByVendor: new Map()
//       }
//     };
//   }

//   async build() {
//     const [prDoc, poDocs] = await Promise.all([
//       this.fetchPRDoc(),
//       this.fetchPODocs()
//     ]);
    
//     this.parsePRData(prDoc);
//     this.processPOs(poDocs);
//     this.buildIndexes();
//   }

//   private parsePRData(prDoc: any) {
//     // Parse JSON fields and populate data structure
//     const procurementList = JSON.parse(prDoc.procurement_list);
//     const rfqData = JSON.parse(prDoc.rfq_data);
//     const categoryList = JSON.parse(prDoc.category_list);

//     // Process items
//     procurementList.list.forEach(item => {
//       this.data.pr.items.set(item.name, {
//         ...item,
//         quotes: rfqData.details[item.name]?.vendorQuotes || {}
//       });
//     });

//     // Process categories
//     categoryList.list.forEach(category => {
//       this.data.pr.categories.set(category.name, category);
//     });

//     // Process vendors
//     rfqData.selectedVendors.forEach(vendor => {
//       this.data.pr.vendors.set(vendor.value, vendor);
//     });
//   }

//   private buildIndexes() {
//     // Items by Category
//     this.data.pr.items.forEach(item => {
//       const categoryItems = this.data.indexes.itemsByCategory.get(item.category) || [];
//       this.data.indexes.itemsByCategory.set(item.category, [...categoryItems, item.id]);
//     });
  
//     // Vendors by Item
//     this.data.pr.items.forEach(item => {
//       this.data.indexes.vendorsByItem.set(item.id, Object.keys(item.quotes));
//     });
//   }

// getItem(id: string): ProcurementItem | undefined {
//   if (this.cache.has(`item-${id}`)) {
//     return this.cache.get(`item-${id}`);
//   }
//   const item = this.data.pr.items.get(id);
//   this.cache.set(`item-${id}`, item);
//   return item;
// }

// getPosForItem(itemId: string): ProcurementOrder[] {
//   const item = this.getItem(itemId);
//   return item ? Array.from(this.data.pr.pos.values())
//     .filter(po => po.items.some(i => i.id === itemId)) : [];
// }

//   // Add other necessary methods...
// }




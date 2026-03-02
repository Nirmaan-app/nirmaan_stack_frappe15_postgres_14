export interface DeliveryNoteItem {
  name?: string;
  item_id: string;
  item_name: string;
  make?: string;
  unit: string;
  category?: string;
  procurement_package?: string;
  delivered_quantity: number;
}

export interface DeliveryNote {
  name: string;
  procurement_order: string;
  project: string;
  vendor?: string;
  note_no: number;
  delivery_date: string;
  updated_by_user?: string;
  nirmaan_attachment?: string;
  notes?: string;
  items: DeliveryNoteItem[];
  is_stub: 0 | 1;
  creation: string;
  modified: string;
}

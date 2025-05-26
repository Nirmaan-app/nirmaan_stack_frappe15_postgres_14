export interface Address {
  name: string
  creation: string
  modified: string
  owner: string
  modified_by: string
  docstatus: 0 | 1 | 2
  parent?: string
  parentfield?: string
  parenttype?: string
  idx?: number
  address_title?: string
  address_type: string
  address_line1: string
  address_line2?: string
  city: string
  state?: string
  country: string
  pincode?: string
  email_id?: string
  phone?: string
}
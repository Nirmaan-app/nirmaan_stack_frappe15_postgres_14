import React from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";

interface AddressViewProps {
  id: string; // The ID of the address document to fetch
  className?: string; // Optional className to apply to the rendered element
}

/**
 * A React component to fetch and display an address from Frappe.
 * Handles loading and error states internally.
 */
export const AddressView: React.FC<AddressViewProps> = ({ id, className }) => {
  const { data: doc, isLoading, error } = useFrappeGetDoc("Address", id);

  if (isLoading) {
    return <p>Loading address...</p>;
  }

  if (error) {
    return <p>Error fetching address: {error.message}</p>;
  }

  if (!doc) {
    return <p>No address found.</p>;
  }

  // Format the address as required
  const address = `${doc.address_line1}, ${doc.address_line2}, ${doc.city}, ${doc.state}-${doc.pincode}`;

  return <span className={className}>{address}</span>;
};